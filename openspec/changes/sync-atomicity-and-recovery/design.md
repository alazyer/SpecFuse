## Context

`writeFileAtomic` (temp+rename in `src/utils/fs.js:27-33`) already makes each individual file write crash-safe at the OS level. The gap is cross-file atomicity: a sync writes multiple targets (constitution.md + each active change proposal) and updates the registry once at the end. Between the first target write and the final `registry.save()`, a crash leaves the artifact graph and the registry disagreeing. The archive flow has the same shape but with a destructive `rm` of the source directory in the middle.

This change does not attempt a true multi-file transaction (that would require a journaling filesystem or a lock + two-phase commit across files). Instead it provides **detectability + recoverability**: a lightweight journal records what the sync intends to do, so an interrupted run can be reconciled on the next invocation. This matches SpecFuse's existing "registry as the source of truth + per-file atomic writes" model and stays within the pure-JavaScript ESM constraint (ADR 0003).

## Goals / Non-Goals

**Goals:**

- Guarantee that an interrupted sync is detectable and reconcilable, never silently desynchronized.
- Make `change archive` crash-safe: the change is never lost to a mid-archive crash.
- Expose recovery state through CLI and `--json` so automation can tell a clean sync from a recovered one.

**Non-Goals:**

- True cross-file atomic transactions (out of scope for a pure-JS, filesystem-only tool).
- Concurrency locking (owned by the `registry-concurrency-safety` change).
- Idempotency of sync output / stable transforms (owned by the `sync-idempotency-deterministic-output` change).
- Changing the rule execution model or the two-pass partition (A/B) — recovery layers on top of the existing loop.

## Decisions

### D1: Journal in the registry, not a sidecar file
The incomplete-sync marker (snapshot of pre-sync registry state + target-file manifest) SHALL live inside `registry.json` under a dedicated `pendingSync` key (or a sibling `registry.pending.json` if the key grows large). Putting it in the registry keeps the source of truth in one place and reuses `writeFileAtomic`. A sidecar file would introduce a second consistency point.

### D2: Reconcile by replay, not by blind rollback
On detection of an incomplete prior sync, the engine SHALL prefer replaying the intended writes from the manifest (re-running extract/transform for each pending rule) over rolling back, because a rollback to the pre-sync snapshot could discard legitimate concurrent edits that happened after the snapshot. Rollback is the fallback only when replay is impossible (e.g. a source file referenced by the manifest no longer exists).

### D3: Archive intent-before-delete
`change archive` SHALL write an `pendingArchive` marker ({ change, sourceDir, archiveDir }) to the registry immediately after the copy succeeds and before the `rm`. A re-run detecting the marker verifies the archived copy exists, records the trace/history, and clears the marker. This makes archive idempotent under interruption.

### D4: Recovery is automatic on next sync, with a `--no-recover` escape
The default next-sync behavior SHALL detect and reconcile an incomplete run automatically. A `--no-recover` flag SHALL allow an operator to skip recovery (e.g. to inspect state manually first). Recovery is also exposed via the sync result `recovery` field.

## Trade-offs

- **Replay vs rollback** (D2): replay is safer for concurrent edits but more complex. Accepted because the alternative (blind rollback) can lose user work.
- **Registry-side journal** (D1) slightly increases `registry.json` churn during syncs (one extra `writeFileAtomic` at start and end). This is negligible relative to the rule writes themselves.
- **No true transactions**: there remains a window where the marker is written but the first target write has not happened. The marker is written *before* any mutation, so a crash in this window simply reconciles to "no work done" — still consistent.

## Risks

- A corrupt or hand-edited registry could contain a stale `pendingSync` marker that blocks sync. Mitigation: `--no-recover` lets an operator proceed; `specfuse doctor` SHALL report a stale marker.
- Replay complexity: a rule whose `extract` is non-deterministic could produce different content on replay. Mitigation: the `sync-idempotency-deterministic-output` change addresses non-determinism (notably the `ctx.today()` date stamp); recovery SHOULD use the manifest's recorded transformed content when available rather than re-running transform.
- The `pendingArchive` marker plus the concurrency-safety locking change must agree on ordering. This change assumes single-process recovery; concurrent-process safety is the other change's scope.
