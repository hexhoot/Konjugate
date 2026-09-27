# Package namespaces

Every Konjugate package (`.kja` add-on, `.kjp` plugin) has a dot-namespaced id, like `konjugate.fintech.toolbox` — the same shape as a Java reverse-DNS package name or an npm scope. [`namespaces.json`](namespaces.json) reserves the *first segment or two* of that namespace to a publisher, so a package id claiming to belong to a given author can be checked against a public key that author controls, via `signPackageArchive`/`verifyPackageArchive` in [`src/packageArchive.mjs`](src/packageArchive.mjs).

## What reservation is, and isn't

This is a namespace registry, not an app store review. Reserving a prefix here doesn't grant permission to publish, doesn't vet the quality or safety of anything published under it, and isn't required to write or distribute a Konjugate plugin at all — an unclaimed prefix, or a claimed prefix whose packages aren't signed, works exactly as it does today. What reservation adds is a way for a package's *identity claim* to be checkable: if `konjugate.fintech.toolbox` is signed with a key registered here under `konjugate.fintech`, a user (or the app) can confirm the package claiming that identity actually controls the key associated with it. Nothing in Konjugate's install or run path *requires* this check to pass, or even to exist — see the note on `verifyPackageArchive` in `packageArchive.mjs` for why that's deliberate: an unsigned or unverifiable package installs and runs exactly as it always has. This is a trust signal, not a gate.

## Reserving a prefix

Open a pull request adding an entry to `namespaces.json`:

```json
"your.prefix": {
    "owner": "Your name or organization",
    "contact": "A URL or address someone can reach you at",
    "publicKeys": ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"]
}
```

- `publicKeys` is a list (not a single key) so a key can be rotated by adding the new one alongside the old, rather than needing every already-signed package re-signed atomically the moment a key changes.
- Reservations are first-come, first-served, reviewed the way any pull request is — there's no separate approval process beyond that.
- A prefix must not already be reserved, or be a parent/child of one that is, by a different owner (`konjugate.fintech` and `konjugate.fintech.markets` can't be reserved by two different people — the longer prefix would make the shorter one's signature claim ambiguous).
- You don't need to reserve a prefix to publish under it. You need to reserve it if you want packages under it to be checkable as genuinely yours.

## Signing a package

```js
import { signPackageArchive } from './src/packageArchive.mjs';
const signed = signPackageArchive(archiveBytes, { privateKey: privateKeyPem, prefix: 'your.prefix' });
```

The private key never appears in this repository — only the corresponding public key does, in `namespaces.json`. Keep the private key wherever you keep other release secrets (a CI secret store, for instance); losing it means re-registering a new key here, not recovering the old one.
