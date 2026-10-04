# Copyright © 2026 Zenin Easa Panthakkalakath
# Template: scripts/generateChocolateyPackage.mjs fills in the double-brace placeholders.

$ErrorActionPreference = 'Stop'

# The NSIS installer's /S flag is the unattended path (exercised in release.yml's "Verify Windows
# installer's silent-install path" step). It requires admin, which Chocolatey already provides.
$packageArgs = @{
    packageName    = $env:ChocolateyPackageName
    fileType       = 'exe'
    url64bit       = '{{url}}'
    checksum64     = '{{sha256}}'
    checksumType64 = 'sha256'
    silentArgs     = '/S'
    validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
