## Why

`registry.json` is the single source of truth for sync state, traceability links, and history, yet every access follows a non-atomic load-mutate-save pattern with no locking. `Registry.load()` reads the file, the caller mutates in memory, and `Registry.save()` writes it back. Two processes running concurrently — most commonly `specfuse watch` in one terminal and `specfuse sync` (or `change archive`) in another — both load the same registry state, both mutate, and the second `save()` silently overwrites the first, losing sync-hash records, traces, or history events with no error.

A second, independent defect compounds this: `Registry.load()` catches a corrupt (unparseable) `registry.json` and silently replaces the entire registry with `_fresh()` (registry.js:73-76), destroying all syncs, traces, and history with only a console warning that API consumers never see. The same destructive reset happens on any schema-version mismatch: `_migrate()` wipes `syncs`, `traces`, `artifacts`, and `loadedRules` when the version differs (registry.js:439-459), with no backup of the old registry, no migration path between intermediate versions, and no structured error. A single interrupted write, a git merge conflict, or a version bump can erase all accumulated state.

This change makes registry access safe under concurrency and makes corrupt/version-mismatch handling non-destructive and observable.

## What Changes

- Define a concurrency contract: registry access SHALL be guarded so concurrent processes cannot silently overwrite each other's mutations.
- Introduce an advisory lock (pidfile-based or file-lock-based) around `load-mutate-save` sequences so only one writer proceeds at a time, with a configurable acquire timeout and a clear "lock held by another process" error.
- Make corrupt-JSON handling non-destructive: a corrupt registry SHALL be quarantined (renamed aside), not silently reset, and the corruption SHALL be reported as a structured error to CLI and API consumers.
- Make schema-version migration non-destructive: a version mismatch SHALL preserve the old registry (quarantine + backup), migrate field-by-field where possible, and report what was migrated — rather than wiping `syncs`/`traces` on any mismatch.
- Expose registry health and lock state through `specfuse doctor` and a structured error type.

## Capabilities

### New Capabilities

- `registry-concurrency`: Ensures concurrent registry access is serialized so two processes cannot silently overwrite each other's mutations.
- `registry-resilience`: Ensures corrupt or version-mismatched registry state is quarantined and reported, never silently destroyed.

### Modified Capabilities

- `registry`: Strengthens load/save semantics to be concurrency-safe and to preserve recoverable state on corruption or version mismatch.
- `history-output`: Strengthens registry-failure reporting so a structured error reaches API consumers rather than a console warning.

## Impact

- **Core modules**: `src/core/registry.js` (locking, quarantine, non-destructive migration), `src/utils/fs.js` (lock primitive if added here).
- **Core modules**: `src/core/sync-engine.js`, `src/core/change-workflow.js`, `src/api/batch.mjs` — acquire/release the lock around their load-mutate-save sequences; `batch.mjs` archive's double-Registry pattern (lines 158-183) SHALL be collapsed to one locked transaction.
- **CLI/API**: `src/commands/watch.js` (serialize watch syncs against external commands), `src/api/sync-ops.mjs`, `src/api/errors.mjs` (new `RegistryError` / `RegistryLockedError`).
- **Tests**: concurrency, corruption-quarantine, and version-migration scenarios.
- **Dependencies**: None expected; a pidfile/lockfile uses existing fs primitives.
- **Breaking behavior**: None intended. Single-process usage is unchanged; the lock is acquired transparently and released on exit.
