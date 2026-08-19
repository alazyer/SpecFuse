## Why

SpecFuse bundles (`.specfuse-bundle.zip`) are shared between teams to transport planning and change artifacts. During import, `_extractBundle` reads each zip entry and writes it to `join(projectRoot, entry.fileName)` with **no check that the resolved path stays inside `projectRoot`** (`src/core/bundle.js:475` and `:479`). The same unguarded join is used in the rename strategy at `bundle.js:534`, where `entry.fileName.replace(changeName, newName)` is joined to the project root before any validation.

A crafted bundle whose entries use `../` sequences (e.g. `../../.ssh/authorized_keys`, or `../.specfuse/rules.mjs`) can therefore write files anywhere on disk the process can reach — including overwriting `.specfuse/rules.mjs` with a booby-trapped plugin that executes on the next `specfuse sync` (see the dynamic-import rule loader at `src/core/rule-loader.js:61`). This is the classic zip-slip / path-traversal class of supply-chain vulnerability: there is no containment check anywhere on the import extraction path (no `path.resolve` + `relative` guard, no symlink rejection on intermediate directories).

Because bundles are an explicit cross-team sharing primitive, a single malicious or compromised bundle is a realistic vector — every contributor who imports it gets arbitrary file write, and the attack is invisible at the CLI (import reports success).

## What Changes

- Define a path-containment contract: every file written during bundle import SHALL resolve to a path inside the project's `.specfuse/` extraction root, and entries that escape SHALL be rejected with a structured error before any write.
- Introduce a single `resolveSafeExtractionPath(root, entryName)` helper that canonicalizes both paths, rejects `..` traversal and absolute entry names, and rejects entries that would resolve through a symlink outside the root.
- Apply the containment check at every write site in `_extractBundle` (directory creation, file write, and the rename strategy) so no extraction path bypasses it.
- Surface a structured `BundleValidationError` (already exists in `src/api/errors.mjs`) for rejected entries, with the offending entry name and the target it would have escaped to, and abort the import without partial writes.
- Add a quarantine/cleanup path: when a malicious entry is detected, any directories already created for the current entry SHALL be left empty-collapsed (no orphan temp files), and the registry SHALL not be mutated.

## Capabilities

### New Capabilities

- `bundle-security`: Ensures bundle import extraction is path-contained — no zip entry can write outside the designated extraction root.

### Modified Capabilities

- `change-archive` / bundle import flow: the extraction step SHALL validate every entry path against the extraction root before writing.

## Impact

- **Core modules**: `src/core/bundle.js` (the `_extractBundle` and `_extractEntry` paths at lines ~460–606; the rename strategy at ~534).
- **Utilities**: `src/utils/fs.js` (new `resolveSafeExtractionPath` helper, or co-located in `bundle.js` if preferred — Planner to decide).
- **API/errors**: reuse existing `BundleValidationError` from `src/api/errors.mjs`; no new error class expected.
- **CLI**: `src/commands/import.js` surfaces the structured error to the user with the offending entry name.
- **Tests**: malicious-bundle fixtures (entries with `../`, absolute paths, symlink-escape attempts) asserting rejection; regression test that a well-formed bundle still imports.
- **Dependencies**: None; uses existing `path` + `fs` primitives.
- **Breaking behavior**: None for well-formed bundles. Malicious bundles that previously wrote outside the root (a latent vulnerability) will now be rejected — this is the intended fix.
