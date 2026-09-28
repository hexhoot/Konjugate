/* Copyright © 2026 Zenin Easa Panthakkalakath */

// The network side of the registry (see docs/registry.md, docs/addonExplorer.md): fetching entries
// from GitHub, and downloading/verifying/installing the packages a chosen entry lists. Kept
// separate from packageArchive.mjs, which stays fetch-free and disk/byte-only, so that module's
// tests never need a network mock. Everything here is a plain function taking a fetch
// implementation as a parameter (default: the global fetch) specifically so it's testable the same
// way -- with a fake fetchImpl, no real network access, no Electron.

import { unzipSync } from 'fflate';
import { buildNamespaceRegistry, inspectPackageArchive, installPackageArchive, verifyPackageArchive } from './packageArchive.mjs';

export class RegistryClientError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'RegistryClientError';
        this.code = code;
    }
}

// The one official registry, unless overridden. Deliberately an environment variable, not a UI
// preference, for now -- see docs/addonExplorer.md's Design principles: this is a buried,
// admin-level concern (pointing an organization's installs at a private fork or mirror), not
// something worth a settings UI before anyone's actually asked for one.
const defaultOwner = 'zenineasa';
const defaultRepo = 'Konjugate';
// zenineasa/Konjugate's actual default branch, confirmed against the live repo -- not every
// zenineasa repo uses the same one (Konjugate-Fintech, for instance, defaults to "main").
const defaultRef = 'master';

// Lists registry/*.json via GitHub's contents API (or an alternate registry URL) -- works
// unauthenticated for a public repo (rate-limited to 60 requests/hour/IP, ample for something
// fetched occasionally and cached, not on every keystroke) -- rather than requiring a separately-
// maintained index file that could drift from the directory's real contents. A repo with no
// registry/ directory yet (a fresh fork) is an empty registry, not an error.
export async function fetchRemoteRegistry({
    registryUrl = process.env.KONJUGATE_REGISTRY_URL,
    owner = process.env.KONJUGATE_REGISTRY_OWNER || defaultOwner,
    repo = process.env.KONJUGATE_REGISTRY_REPO || defaultRepo,
    ref = process.env.KONJUGATE_REGISTRY_REF || defaultRef,
    fetchImpl = fetch
} = {}) {
    if (registryUrl) {
        const response = await fetchImpl(registryUrl);
        if (!response.ok) {
            if (response.status === 404) return { prefixes: {} };
            throw new RegistryClientError(`Could not fetch registry from ${registryUrl} (HTTP ${response.status}).`, 'FETCH_FAILED');
        }
        const data = await response.json();
        if (data && typeof data === 'object' && data.prefixes) return data;
        if (Array.isArray(data)) return buildNamespaceRegistry(data);
        throw new RegistryClientError('The remote registry URL returned an unrecognized format.', 'INVALID_REGISTRY_FORMAT');
    }
    const listingUrl = `https://api.github.com/repos/${owner}/${repo}/contents/registry?ref=${encodeURIComponent(ref)}`;
    const listingResponse = await fetchImpl(listingUrl, { headers: { Accept: 'application/vnd.github+json' } });
    if (!listingResponse.ok) {
        if (listingResponse.status === 404) return { prefixes: {} };
        if (listingResponse.status === 403) {
            throw new RegistryClientError('GitHub API rate limit exceeded while listing the registry.', 'RATE_LIMITED');
        }
        throw new RegistryClientError(`Could not list the registry (HTTP ${listingResponse.status}).`, 'LISTING_FAILED');
    }
    const listing = await listingResponse.json();
    if (!Array.isArray(listing)) throw new RegistryClientError('Registry listing is not a valid directory.', 'LISTING_FAILED');
    const jsonFiles = listing.filter((item) => item.type === 'file' && item.name.endsWith('.json'));
    const files = await Promise.all(jsonFiles.map(async (file) => {
        const contentResponse = await fetchImpl(file.download_url);
        if (!contentResponse.ok) throw new RegistryClientError(`Could not fetch registry entry "${file.name}" (HTTP ${contentResponse.status}).`, 'FETCH_FAILED');
        return { name: file.name, text: await contentResponse.text() };
    }));
    // A malformed entry throws PackageArchiveError here and is allowed to propagate -- a broken
    // registry entry should be visible as a real error, not silently dropped from the list.
    return buildNamespaceRegistry(files);
}

// entry: one registry entry (as returned by fetchRemoteRegistry/loadNamespaceRegistry's prefixes
// map), with its packages/downloadUrl fields. namespaces: passed straight through to
// verifyPackageArchive for each installed package -- trust status is reported per package, never
// used to block anything here, per the advisory-only principle in docs/addonExplorer.md. Returns
// one { packageType, packageId, version, verification } per package the entry declares.
export async function installFromRegistryEntry(entry, { namespaces, directory, overwrite = true, fetchImpl = fetch } = {}) {
    if (typeof entry?.downloadUrl !== 'string' || !entry.downloadUrl) throw new RegistryClientError('This registry entry has no downloadUrl.', 'NO_DOWNLOAD_URL');
    if (!Array.isArray(entry.packages) || !entry.packages.length) throw new RegistryClientError('This registry entry lists no packages.', 'NO_PACKAGES');
    const response = await fetchImpl(entry.downloadUrl);
    if (!response.ok) throw new RegistryClientError(`Could not download ${entry.downloadUrl} (HTTP ${response.status}).`, 'DOWNLOAD_FAILED');
    const archiveBytes = new Uint8Array(await response.arrayBuffer());
    let zipEntries;
    try {
        zipEntries = unzipSync(archiveBytes);
    } catch (error) {
        throw new RegistryClientError(`The downloaded file is not a valid zip: ${error.message}`, 'INVALID_DOWNLOAD');
    }
    // Matched by each candidate file's own declared identity, not by file name -- file names carry
    // a version number the registry entry doesn't (and shouldn't have to) know in advance.
    let candidates = Object.entries(zipEntries).filter(([name]) => name.endsWith('.kja') || name.endsWith('.kjp'));
    if (!candidates.length && entry.packages.length === 1) {
        // The download may be a direct .kja or .kjp package archive rather than a multi-package zip container
        const declared = entry.packages[0];
        const extension = declared.packageType === 'addon' ? '.kja' : '.kjp';
        try {
            const inspected = inspectPackageArchive(archiveBytes, { extension });
            if (inspected.packageManifest.packageType === declared.packageType && inspected.packageManifest.packageId === declared.packageId) {
                candidates = [[`direct${extension}`, archiveBytes]];
            }
        } catch {
            // Not a direct package archive
        }
    }
    const results = [];
    for (const declared of entry.packages) {
        const extension = declared.packageType === 'addon' ? '.kja' : '.kjp';
        const match = candidates.find(([, bytes]) => {
            try {
                const inspected = inspectPackageArchive(bytes, { extension });
                return inspected.packageManifest.packageType === declared.packageType && inspected.packageManifest.packageId === declared.packageId;
            } catch {
                return false;
            }
        });
        if (!match) throw new RegistryClientError(`The download does not contain the declared package "${declared.packageId}".`, 'PACKAGE_MISSING');
        const [, bytes] = match;
        const verification = verifyPackageArchive(bytes, { namespaces });
        const installed = await installPackageArchive(bytes, { extension, directory, overwrite });
        results.push({
            packageType: installed.packageManifest.packageType, packageId: installed.packageManifest.packageId,
            version: installed.packageManifest.version, verification
        });
    }
    return results;
}
