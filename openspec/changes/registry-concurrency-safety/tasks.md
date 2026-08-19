## 1. Registry locking primitive

- [ ] 1.1 Implement a PID-based advisory lockfile (`.specfuse/registry.lock`) holding holder PID + acquisition timestamp, with stale-PID reclamation, in `src/core/registry.js` (or `src/utils/fs.js`).
- [ ] 1.2 Add `Registry.withLock(fn)` (and a release-on-throw guarantee) so callers wrap load-mutate-save sequences ergonomically.
- [ ] 1.3 Add a configurable acquire timeout with a default (e.g. 5s).

## 2. Typed errors

- [ ] 2.1 Add `RegistryError` and `RegistryLockedError` subclasses to `src/api/errors.mjs`.
- [ ] 2.2 Re-export them from `src/api.mjs` so programmatic consumers can catch them by type.

## 3. Non-destructive corruption handling

- [ ] 3.1 Replace the silent `_fresh()` reset in `Registry.load()`'s catch with quarantine (rename to `registry.json.corrupt-<n>`) + fresh init + a structured `RegistryError` reporting the quarantined path.
- [ ] 3.2 Handle partially-corrupt valid JSON (unexpected shape) by quarantining and reporting, rather than running on partially-corrupt state.

## 4. Non-destructive version migration

- [ ] 4.1 Restructure `_migrate()` into a per-version migration map; back up the original before migrating.
- [ ] 4.2 Migrate defined fields in place; preserve fields without a defined migration instead of wiping them.
- [ ] 4.3 Report the version transition and what was migrated to CLI/API; quarantine + error on an unknown future version (so downgrades don't destroy newer-state data).

## 5. Collapse batch-archive double-Registry

- [ ] 5.1 Refactor `src/api/batch.mjs` `archive()` (lines 158-183) to perform trace updates and history recording in a single locked `withLock` transaction instead of two `Registry` instances.

## 6. Wire callers to the lock

- [ ] 6.1 Wrap `runTwoPassSync` (sync), `change archive`, `batchArchive`, `resolve`, and watch's drain path in `Registry.withLock`.
- [ ] 6.2 Ensure `specfuse doctor` reports lock state, stale locks, and quarantined registry files with recovery hints.

## 7. Tests

- [ ] 7.1 Test: two concurrent writers (simulated) — second waits or fails with `RegistryLockedError`; no silent lost update.
- [ ] 7.2 Test: stale lock with a dead PID is reclaimed.
- [ ] 7.3 Test: corrupt `registry.json` is quarantined and reported via a typed error; fresh state initialized.
- [ ] 7.4 Test: older-version registry is migrated field-by-field with a backup; no fields wiped.
- [ ] 7.5 Test: unknown future version is quarantined and errors rather than resetting.
- [ ] 7.6 Test: batch archive records traces + history in one locked transaction.

## 8. Verify

- [ ] 8.1 Run `pnpm test` and confirm no regressions plus new concurrency/resilience tests pass.
- [ ] 8.2 Confirm `specfuse doctor` reports lock + quarantine state.
- [ ] 8.3 Confirm a programmatic caller catches `RegistryError`/`RegistryLockedError` by type.
