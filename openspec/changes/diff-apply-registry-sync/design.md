# Design — diff --apply registry sync

## Context

`diff --apply` writes proposed managed-section content to target files (`applyDiff`, `src/core/differ.js:187`) but does not call `registry.recordSync()`. The registry's per-pair hashes therefore stay stale, and the next `drift` reports phantom `TARGET_CHANGED` for the very content the apply just wrote. The sync engine's `executeRule` does the right thing (write + recordSync, `sync-engine.js:281-282`); the `diff --apply` path performs only the write half.

## Decision

**Reuse the sync engine's hash + `recordSync` contract; record after each successful write; save once.**

Two implementation shapes are acceptable — the Planner picks based on how `applyDiff` is currently called:

**Shape A (registry passed into applyDiff):** `applyDiff(projectRoot, proposedFiles, registry, ruleIndex)` — after each successful `writeFileAtomic`, call `registry.recordSync(rule, targetPath, writtenContent)` (mirroring `executeRule`). `applyDiff` returns the same `AppliedFile[]`. The caller saves the registry once. This co-locates the write and its bookkeeping, matching the sync engine's pattern.

**Shape B (caller records):** `applyDiff` stays write-only and returns `AppliedFile[]` with the `rule`/`relPath` it touched; the CLI/API caller iterates `applied` and calls `registry.recordSync(...)` per `written: true` entry, then `registry.save()` once. This keeps `applyDiff` pure but duplicates the record logic in two callers.

**Recommendation: Shape A** — it mirrors the sync engine's proven pattern and avoids duplicating the hash/record contract in the CLI and API callers. The registry is already loaded in `diff.js:21-22`.

### Locking (API path)

`src/api/sync-ops.mjs:82-83` (the `diff({ apply: true })` path) SHALL wrap the apply+record+save in the advisory lock, exactly as the `resolve` path does at `sync-ops.mjs:156`. The CLI path does not need an explicit lock for a single interactive invocation, but should not regress — it already loads the registry; the save at the end is atomic via `writeFileAtomic`.

### Hash contract

Whatever hash the registry currently stores for a sync (the existing `recordSync` in `registry.js` already defines this — Planner to confirm the exact field, likely the target file's content hash or a source+target combined hash). The apply path MUST use the same `recordSync` call the sync engine uses, not a new hash, so `drift`'s comparison is identical across both write paths. This is the core of the fix: drift must not be able to tell whether a pair was reconciled by `sync` or by `diff --apply`.

### What gets recorded

- Per successful write (`written: true`): record sync for that pair.
- Per failed write (`written: false`): do NOT record — the registry must not claim a sync for content that never reached disk. The pair retains its prior drift state, which is the honest state.

## Trade-offs

- **diff --apply vs. "just run sync"**: `diff --apply` exists as a review-then-apply shortcut. Making it registry-consistent completes the shortcut; it does not duplicate `sync` because `sync` re-derives content from rules, while `--apply` applies a user-reviewed diff. They are complementary.
- **Single save vs. per-pair save**: Single save (one atomic `registry.save()`) is required by the spec — per-pair saves would be more I/O and would leave partial registry states visible to a concurrent reader mid-apply.
- **Locking scope**: Acquiring the advisory lock in the API path is consistent with `resolve`. The CLI interactive path skips the lock (single user, no concurrent writer expected) — acceptable and matches how other interactive commands behave.

## Non-goals

- Does not change `diff` preview behavior (no `--apply`).
- Does not change the sync engine's own `recordSync`/hash implementation — this change *reuses* it.
- Does not add a new drift state or change `drift` output formatting.
- Does not touch the `resolve` command's conflict-resolution path (separate concern).

## Test strategy

- `IN_SYNC` after apply: create a drifted project, run `diff --apply`, assert `drift` reports `IN_SYNC` for the applied pair.
- Failed-write isolation: force a write failure on one pair, assert that pair is NOT recorded as `IN_SYNC` while other applied pairs are.
- Preview unchanged: run `diff` without `--apply`, assert registry is untouched and drift state unchanged.
- Concurrency: with a mock watch writer running, assert the API apply path holds the lock and the recorded sync survives the watch's interleaved save.
