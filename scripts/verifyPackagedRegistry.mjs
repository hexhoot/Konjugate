// Copyright © 2026 Zenin Easa Panthakkalakath

// Run after packaging (see the package* targets in the Makefile): the bundled registry is the
// offline fallback for Extensions -> Discover, and its images/ are what Discover and Installed show
// without any network access (see the packageRegistryImage handler in src/main.mjs). Checks that
// every file under the source registry/ made it into the packaged app byte for byte, and that
// every image an entry names is among them.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const resourcesDirectory = process.argv[2];
if (!resourcesDirectory) {
    throw new Error('Pass the packaged application resources directory.');
}

// @electron/asar comes with @electron/packager, so it's resolved from there rather than declared
// as a dependency of its own.
const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve('@electron/packager'))('@electron/asar');

const archivePath = join(resolve(resourcesDirectory), 'app.asar');
const unpackedDirectory = join(resolve(resourcesDirectory), 'app');
const readPackaged = existsSync(archivePath)
    ? (relativePath) => asar.extractFile(archivePath, relativePath)
    : (relativePath) => readFile(join(unpackedDirectory, relativePath));

const sourceDirectory = resolve('registry');
const sourceFiles = (await readdir(sourceDirectory, { recursive: true, withFileTypes: true }))
    // Hidden files (macOS's .DS_Store, mostly) aren't part of the registry and aren't packaged.
    .filter((item) => item.isFile() && !item.name.startsWith('.'))
    .map((item) => join(item.parentPath, item.name).slice(sourceDirectory.length + 1).replaceAll('\\', '/'));

const problems = [];
for (const relativePath of sourceFiles) {
    let packaged;
    try {
        packaged = await readPackaged(join('registry', relativePath));
    } catch {
        problems.push(`registry/${relativePath} is missing from the packaged app.`);
        continue;
    }
    if (!Buffer.from(packaged).equals(await readFile(join(sourceDirectory, relativePath)))) {
        problems.push(`registry/${relativePath} differs from the source copy.`);
    }
}
for (const relativePath of sourceFiles.filter((name) => name.endsWith('.json') && !name.includes('/'))) {
    const entry = JSON.parse(await readFile(join(sourceDirectory, relativePath), 'utf8'));
    if (entry.image && !sourceFiles.includes(entry.image)) problems.push(`registry/${relativePath} names ${entry.image}, which doesn't exist.`);
}

if (problems.length) throw new Error(`The packaged registry is incomplete:\n${problems.join('\n')}`);
console.log(`Packaged registry verified: ${sourceFiles.length} files.`);
