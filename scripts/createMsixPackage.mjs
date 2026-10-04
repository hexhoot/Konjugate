// Copyright © 2026 Zenin Easa Panthakkalakath

// Wraps the already-packaged Windows app folder (out/package/Konjugate-win32-<arch>, the same one
// installer.nsi wraps) into an .msix, for the Microsoft Store. Windows-only in practice: makeappx
// ships with the Windows SDK.
//
// Usage: node scripts/createMsixPackage.mjs <packagedAppDirectory> <outputMsixPath> <x64|arm64|ia32>
//
// This is a spike -- see docs/packageManagerDistribution.md's "Microsoft Store" section for what
// it does and doesn't prove. The output is UNSIGNED: Windows refuses to sideload an unsigned
// MSIX (use packaging/windows/msix/signForTesting.ps1 for local testing), while the Store signs
// the package itself on ingestion, so a Store submission uploads it as-is.
//
// Identity: a Store submission must use the Identity Name and Publisher that Partner Center
// assigns to the reserved app name (MSIX_IDENTITY_NAME / MSIX_PUBLISHER, plus MSIX_PUBLISHER_DISPLAY_NAME
// if it differs). The defaults below are placeholders that are only good for local sideload tests.

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { rootDirectory } from './developmentEnvironment.mjs';

const [packagedDirectoryArgument, outputArgument, electronArchitecture] = process.argv.slice(2);
if (!packagedDirectoryArgument || !outputArgument || !electronArchitecture) {
    console.error('Usage: node scripts/createMsixPackage.mjs <packagedAppDirectory> <outputMsixPath> <x64|arm64|ia32>');
    process.exit(64);
}
const packagedDirectory = resolve(packagedDirectoryArgument);
const outputPath = resolve(outputArgument);

const appPackage = JSON.parse(await readFile(join(rootDirectory, 'package.json'), 'utf8'));
const metadata = load(await readFile(join(rootDirectory, 'packaging', 'appMetadata.yml'), 'utf8'));

const identityName = process.env.MSIX_IDENTITY_NAME ?? 'Konjugate.LocalTest';
const publisher = process.env.MSIX_PUBLISHER ?? 'CN=Konjugate Local Test';
const publisherDisplayName = process.env.MSIX_PUBLISHER_DISPLAY_NAME ?? metadata.developerName;
if (!process.env.MSIX_IDENTITY_NAME || !process.env.MSIX_PUBLISHER) {
    console.warn('MSIX_IDENTITY_NAME / MSIX_PUBLISHER not set: using local-test placeholders. The Store rejects these -- use the values from Partner Center.');
}

// MSIX versions are four-part and the Store reserves the last part (it must be 0).
const version = `${appPackage.version.split('-')[0]}.0`;
if (!/^\d+\.\d+\.\d+\.0$/.test(version)) throw new Error(`package.json version ${appPackage.version} can't be turned into a x.y.z.0 MSIX version.`);

// Electron's arch names on the left (what the Makefile's hostArch holds), MSIX's on the right.
const architecture = { x64: 'x64', arm64: 'arm64', ia32: 'x86' }[electronArchitecture];
if (!architecture) throw new Error(`Unsupported architecture "${electronArchitecture}" -- expected x64, arm64 or ia32.`);

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Minimum Windows 10 1809: the oldest release the Store still supports for MSIX with full trust.
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 desktop rescap">
  <Identity Name="${escapeXml(identityName)}" Publisher="${escapeXml(publisher)}" Version="${version}" ProcessorArchitecture="${architecture}" />
  <Properties>
    <DisplayName>${escapeXml(metadata.name)}</DisplayName>
    <PublisherDisplayName>${escapeXml(publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22631.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="Konjugate" Executable="${escapeXml(metadata.name)}.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${escapeXml(metadata.name)}"
        Description="${escapeXml(metadata.summary)}"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png" />
      <Extensions>
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="kjt">
            <uap:SupportedFileTypes>
              <uap:FileType>.kjt</uap:FileType>
            </uap:SupportedFileTypes>
            <uap:DisplayName>Konjugate Project</uap:DisplayName>
          </uap:FileTypeAssociation>
        </uap:Extension>
        <uap3:Extension Category="windows.appExecutionAlias" Executable="${escapeXml(metadata.name)}.exe" EntryPoint="Windows.FullTrustApplication">
          <uap3:AppExecutionAlias>
            <desktop:ExecutionAlias Alias="konjugate.exe" />
          </uap3:AppExecutionAlias>
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;

function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
}

async function findMakeappx() {
    if (spawnSync('makeappx', ['/?'], { stdio: 'ignore' }).status !== null) return 'makeappx';
    const kitsRoot = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
    const versions = (await readdir(kitsRoot).catch(() => [])).filter((entry) => /^\d/.test(entry)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
    for (const sdkVersion of versions) {
        const candidate = join(kitsRoot, sdkVersion, architecture === 'arm64' ? 'arm64' : 'x64', 'makeappx.exe');
        if (spawnSync(candidate, ['/?'], { stdio: 'ignore' }).status !== null) return candidate;
    }
    throw new Error('makeappx.exe not found -- install the Windows 10/11 SDK (it is preinstalled on GitHub\'s windows runners).');
}

const stagingDirectory = join(rootDirectory, 'out', 'msix', 'staging');
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(join(stagingDirectory, 'Assets'), { recursive: true });
await cp(packagedDirectory, stagingDirectory, { recursive: true });

// Required tile/store logos, rendered from the same SVG the rest of the icon set comes from.
const logoSizes = { 'StoreLogo.png': 50, 'Square44x44Logo.png': 44, 'Square150x150Logo.png': 150 };
for (const [fileName, size] of Object.entries(logoSizes)) {
    run('rsvg-convert', ['--width', String(size), '--height', String(size), join(rootDirectory, 'assets', 'icon.svg'), '--output', join(stagingDirectory, 'Assets', fileName)]);
}

await writeFile(join(stagingDirectory, 'AppxManifest.xml'), manifest);
await mkdir(dirname(outputPath), { recursive: true });
run(await findMakeappx(), ['pack', '/d', stagingDirectory, '/p', outputPath, '/o']);
console.log(`Created ${outputPath} (unsigned; identity ${identityName}, version ${version}).`);
