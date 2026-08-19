## Why

`specfuse diff --apply` (and the programmatic `diff({ apply: true })` API) writes proposed managed-section content to target files on disk via `applyDiff()`, but **explicitly does not update the registry** afterwards. The function's own JSDoc states it: *"Write proposed file contents to disk. Does NOT update the registry."* (`src/core/differ.js:187`).

This is a correctness defect. The registry's `syncs` map records per-pair content hashes that `drift` compares against. When `diff --apply` writes new content to a target file but leaves the registry's hashes stale, the very next `specfuse drift` reports a false `TARGET_CHANGED` (or `SOURCE_CHANGED`) state for the exact pairs that were just reconciled — content the user just accepted and applied. The user is told their project is drifting from content they deliberately wrote.

The contrast makes the bug clear: the sync engine's `executeRule` correctly calls **both** `writeFileAtomic` **and** `registry.recordSync()` in sequence (`src/core/sync-engine.js:281-282`). The `diff --apply` path bypasses the sync engine entirely and performs only the write half of that contract. Both the CLI path (`src/commands/diff.js:63, 85, 109`) and the API path (`src/api/sync-ops.mjs:82-83`) share the defect — the registry is loaded but never updated post-write.

This matters operationally: `diff --apply` is the intended "review-and-apply in one step" workflow (it exists specifically so users don't have to run a separate `sync`). Leaving the registry stale defeats that purpose — the user must run `specfuse sync` immediately after `diff --apply` to clear the phantom drift, or the pre-commit drift hook (`install-hooks`) will block the commit.

## What Changes

- Define a correctness contract: `diff --apply` (and `diff({ apply: true })`) SHALL bring the registry into sync with the written content for every pair it applies, the same way a full `sync` does — so that a subsequent `drift` reports `IN_SYNC` for applied pairs (absent genuine new source changes).
- After `applyDiff` writes a file successfully, record the sync state in the registry for the affected rule/pair (content hash of the written target, matching the registry's existing hash contract), and `registry.save()` once at the end of the apply.
- The API path (`src/api/sync-ops.mjs`) SHALL acquire the registry advisory lock around the apply-and-record sequence (consistency with the `resolve` path at `sync-ops.mjs:156` which already locks), so a concurrent `watch`/`sync` cannot interleave.
- A pair that `applyDiff` failed to write (`written: false`) SHALL NOT have its registry state updated — the registry reflects only what was actually written to disk.
- The `--apply` path SHALL remain reviewable: when `--apply` is not set, behavior is unchanged (no writes, no registry mutation, pure preview).

## Capabilities

### New Capabilities

- `diff-apply`: Guarantees `diff --apply` leaves the registry consistent with the written files, so applying a diff does not introduce phantom drift.

### Modified Capabilities

- `diff-command`: The `--apply` flag now updates the registry in addition to writing files.
- `sync-engine` (by reference): the apply path SHALL reuse the same hash/`recordSync` contract the sync engine uses, so drift semantics are identical between the two write paths.

## Impact

- **Core modules**: `src/core/differ.js` (`applyDiff`, ~line 187) — gains an optional registry parameter and a record-sync step after each successful write; or, per Planner, the CLI/API callers perform the record step after `applyDiff` returns. Either shape is acceptable; the contract is "registry is consistent after apply."
- **CLI**: `src/commands/diff.js` (`:63, :85, :109`) — pass the loaded registry into the apply path and `save()` once after.
- **API**: `src/api/sync-ops.mjs` (`:82-83`) — acquire the advisory lock (as the `resolve` path does at `:156`) around apply+record+save.
- **Tests**: assert `drift` is `IN_SYNC` immediately after `diff --apply`; assert a failed write does not update that pair's registry state; assert non-`--apply` (preview) leaves the registry untouched; assert concurrency with a running `watch` does not lose the recorded sync (lock held).
- **Dependencies**: None.
- **Breaking behavior**: None intended — `--apply` now also updates the registry, which is the behavior users already expect (they apply a diff precisely to stop drifting). A user who ran `diff --apply` and then separately `sync` will see no double-write; `sync` becomes a no-op for already-applied pairs.
