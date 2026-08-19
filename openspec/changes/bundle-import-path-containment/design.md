# Design — Bundle Import Path Containment (zip-slip fix)

## Context

Bundle import (`src/core/bundle.js`) extracts a `.specfuse-bundle.zip` into the project's `.specfuse/` directory. The extraction joins each zip entry's `entry.fileName` to `projectRoot` without validating that the result stays inside the extraction root. This is a zip-slip / path-traversal vulnerability — a crafted bundle can write anywhere on disk.

## Decision

**Single containment primitive, applied at every write site.**

Introduce `resolveSafeExtractionPath(root, entryName)`:

1. Compute `resolved = path.resolve(root, entryName)`.
2. Compute `resolvedRoot = path.resolve(root)`.
3. Reject if `entryName` is absolute (`path.isAbsolute(entryName)`).
4. Reject if `resolved` is not equal to or a child of `resolvedRoot`, tested via `path.relative(resolvedRoot, resolved)` — it MUST NOT start with `..` and MUST NOT be absolute.
5. Reject if the resolved path or any intermediate segment is a symlink that points outside `resolvedRoot` (use `fs.lstat` on each path segment, or `fs.realpath` on the parent and compare). This closes the symlink-escape variant.

The helper is co-located in `bundle.js` (it is import-extraction-specific and reuses no other module's concerns). If the Planner finds `src/utils/fs.js` a cleaner home because the helper is generally useful, that is acceptable — the contract is the same.

## Where it applies

Three write sites in `_extractBundle`, all routed through the helper before any `ensureDir`/`writeFileAtomic`/`createWriteStreamRaw`:
- Directory entries: `ensureDir(join(projectRoot, entry.fileName))` at `bundle.js:475` → `ensureDir(resolveSafeExtractionPath(projectRoot, entry.fileName))`.
- File entries: `const targetPath = join(projectRoot, entry.fileName)` at `bundle.js:479` → `resolveSafeExtractionPath(...)`.
- Rename strategy: the `entry.fileName.replace(changeName, newName)` result at `bundle.js:534` → re-validate through the helper (the replace can re-introduce `..` if `newName` is attacker-influenced, so it must be re-checked, not assumed safe).

## Error handling

Reuse the existing `BundleValidationError` from `src/api/errors.mjs` (already re-exported from `api.mjs`). The error carries the offending `entryName` and the `escapedTarget` it would have written to. Import aborts on the first malicious entry; well-formed entries already written are left in place (no partial-rollback contract — see spec scenario "Partial state is recoverable"). The registry is not mutated on a failed import, so no drift is introduced.

## Trade-offs

- **Reject vs. sanitize-and-continue**: We reject rather than silently stripping `..`. Sanitizing could mask a genuine bug in a bundler and would still leave the symlink-escape hole. Rejecting is loud and safe, matching how SpecFuse already treats malformed input (e.g. corrupt registry quarantine).
- **realpath cost**: `fs.realpath` on every segment adds I/O, but bundle import is not a hot path (manual, infrequent). The cost is acceptable for the safety gained. If profiling shows it matters, the check can be limited to entries whose `relative` result is suspicious — but the initial implementation checks all entries uniformly for simplicity.
- **No symlink-following writes**: Extraction writes through `writeFileAtomic`/streams that do not follow symlinks at the leaf, but a symlinked *intermediate directory* could redirect a write. The realpath-segment check covers this.

## Non-goals

- Does not sandbox plugin rules (`rules.mjs` dynamic import) — that is a separate concern (the rule loader's trust model). This change only prevents a malicious bundle from planting a malicious `rules.mjs` in the first place.
- Does not change the bundle *export* path (export already collects from `.specfuse/` and is not attacker-controlled).
- Does not add bundle signature verification / provenance — a future change; this change assumes the bundle is untrusted by default and makes import safe regardless.

## Test strategy

- Malicious-bundle fixtures built with `archiver` (already a dependency): entries with `../` traversal, absolute paths, and a symlinked intermediate dir. Assert each is rejected with `BundleValidationError` and no file lands outside the root (verify by scanning a sibling temp dir).
- Regression: the existing well-formed bundle import test continues to pass unchanged.
- Rename-strategy test: a bundle imported with `--rename` whose renamed entry escapes is rejected.
