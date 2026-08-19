# Tasks — Bundle Import Path Containment (zip-slip fix)

## 1. Containment primitive
- [ ] 1.1 Implement `resolveSafeExtractionPath(root, entryName)` in `src/core/bundle.js` (or `src/utils/fs.js` if Planner prefers): `path.isAbsolute` reject, `path.relative` child check, symlink-segment escape check via `realpath`/`lstat`.
- [ ] 1.2 On escape, throw `BundleValidationError` (reuse from `src/api/errors.mjs`) carrying `entryName` and `escapedTarget`.

## 2. Wire into extraction
- [ ] 2.1 Route directory-entry `ensureDir` at `bundle.js:475` through the helper.
- [ ] 2.2 Route file-entry `targetPath` at `bundle.js:479` through the helper.
- [ ] 2.3 Route the rename-strategy path at `bundle.js:534` through the helper (re-validate after the `.replace`).
- [ ] 2.4 Ensure `_extractEntry` (`bundle.js:593–606`) writes only to a validated path; abort on first rejection without orphan temp files and without registry mutation.

## 3. CLI / API surface
- [ ] 3.1 `src/commands/import.js` surfaces the `BundleValidationError` with the offending entry name and exits non-zero.
- [ ] 3.2 Confirm `specfuse/api/bundle.mjs` API path throws `BundleValidationError` (instanceof check) — no new error class.

## 4. Tests
- [ ] 4.1 Fixture: bundle with `../` traversal entry → rejected, no outside write, import aborts, registry unchanged.
- [ ] 4.2 Fixture: bundle with absolute-path entry → rejected.
- [ ] 4.3 Fixture: bundle with symlinked intermediate directory → rejected.
- [ ] 4.4 Fixture: `--rename` import whose renamed entry escapes → rejected.
- [ ] 4.5 Regression: existing well-formed bundle import passes unchanged.

## 5. Docs
- [ ] 5.1 Note the containment guarantee in the bundle import section of `README.md` / relevant `docs/` page (one line: imported bundles cannot write outside `.specfuse/`).
