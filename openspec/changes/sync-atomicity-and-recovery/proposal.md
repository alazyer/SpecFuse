## Why

The two-pass sync is the core operation of SpecFuse, yet it has no all-or-nothing guarantee. `runTwoPassSync` writes managed sections into target files one rule at a time (`writeFileAtomic` at `sync-engine.js:170` and `:204`) and only calls `registry.save()` once at the very end (`:305`). If the process is interrupted between the first target write and the final registry save — by Ctrl+C, SIGKILL, OOM, or a thrown error in a later rule — the project is left with updated file content on disk but a stale registry that still records the pre-sync hashes. The artifact graph and the registry are now silently desynchronized with no recovery path short of manual inspection.

The archive operation (`change-workflow.js:406-428`) is worse: it `cp`s the change directory to the archive, rewrites the archived proposal frontmatter, `rm`s the original change directory, and only then calls `registry.save()`. A crash after the `rm` but before `registry.save()` loses the change directory entirely, with no registry record that an archive happened. Per-file writes are atomic (temp+rename in `writeFileAtomic`), but there is no cross-file transaction, no journal, no backup, and no rollback.

## What Changes

- Define a sync-transaction contract: a sync run SHALL be recoverable to a consistent state after an interruption, so that either all of a sync's effects are visible or none are.
- Introduce a pre-sync snapshot of registry state (and a manifest of target files touched) so an interrupted sync can be detected and reconciled on the next run.
- Make `registry.save()` record sync outcomes per-rule before the run is considered complete, so a crash after file writes leaves a resolvable "incomplete sync" marker rather than a silently-stale registry.
- Make `change archive` record its intent in the registry before deleting the source directory, so a crash mid-archive can be detected and re-run safely (idempotent archive).
- Define a `specfuse sync --recover` (or automatic detection) path that finishes or rolls back an interrupted sync using the snapshot, and exposes the recovery outcome in sync results and `--json` output.

## Capabilities

### New Capabilities

- `sync-recovery`: Ensures an interrupted two-pass sync can be detected and reconciled to a consistent state without silent desynchronization between file content and the registry.

### Modified Capabilities

- `sync-engine`: Strengthens the sync lifecycle so registry state is durable per-rule before the run completes, and so the engine can detect and report an incomplete prior sync.
- `change-archive`: Strengthens archive ordering so the registry records archive intent before source deletion, making archive crash-safe and idempotent.

## Impact

- **Core modules**: `src/core/sync-engine.js` (transaction lifecycle, snapshot, recovery), `src/core/registry.js` (incomplete-sync marker, atomic outcome recording), `src/core/change-workflow.js` (archive intent-before-delete ordering).
- **CLI/API**: `src/commands/sync.js`, `src/api/sync-ops.mjs` — surface recovery state and a recovery path; extend `--json` output with a recovery/outcome summary.
- **Tests**: new scenarios for interrupted sync, interrupted archive, and recovery reconciliation.
- **Dependencies**: None expected. Snapshotting reuses existing file utilities.
- **Breaking behavior**: None intended. The default sync path is unchanged when no interruption occurred; recovery is additive.
