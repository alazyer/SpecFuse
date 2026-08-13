# Sync Lifecycle & Crash Recovery

SpecFuse's two-pass sync writes managed sections into multiple target files and
updates the registry once at the end. Because there is no cross-file filesystem
transaction, an interruption between the first target write and the final
`registry.save()` — a Ctrl+C, SIGKILL, OOM, or a thrown error in a later rule —
could once leave the project silently desynchronized: file content on disk
updated, but a stale registry still recording pre-sync hashes.

SpecFuse solves this with a lightweight **recovery journal** inside
`registry.json`. An interrupted sync is always *detectable* and *reconcilable* on
the next invocation — never silently lost.

## How the journal works

Before any target-file mutation, a `pendingSync` marker is written to
`registry.json` containing:

- **`snapshot`** — a deep copy of the pre-sync registry state (`syncs`,
  `traces`, `artifacts`, `phase`).
- **`manifest`** — one entry per target file the run intends to write, recording
  the rule id, target path, source/target hashes, and the **exact transformed
  content** that would land on disk.
- **`startedAt`** — an ISO timestamp of when the run began.

The marker is cleared only after the final `registry.save()` succeeds. So its
presence at the start of a sync means the previous run was interrupted.

| Lifecycle stage | Marker state |
|---|---|
| Before any write | written (snapshot + manifest) |
| During Pass A / Pass B | present |
| After final `registry.save()` | cleared |

## Automatic recovery on the next sync

By default, the next `specfuse sync` detects a stale marker and reconciles it
**before** proceeding with the new sync. Recovery prefers **replay**:

- For each manifest entry, the on-disk managed section is compared to the
  manifest's recorded `transformedContent`.
- If they match (the write landed, or was a no-op), the registry hash is brought
  into agreement so the rule is not reported `IN_SYNC` on a stale hash.
- If they differ (the write never landed), the manifest content is written
  verbatim — `transform()` is **not** re-run, so non-deterministic or
  since-edited sources cannot diverge the recovered state.

If replay is impossible (e.g. a target path is unreadable/unwritable), the
engine falls back to **rolling the registry back to the pre-sync snapshot**, so
the registry no longer claims outcomes for a run whose writes did not land
consistently.

The whole reconcile (and the run that follows) is serialized by the registry
advisory lock — concurrent writers cannot interleave.

## The `recovery` field

A recovered run is surfaced in both human and `--json` output so automation can
tell a clean sync from a recovered one.

**Human output** prints a notice after the Summary:

```
⚠ Recovered an interrupted sync from 2026-08-11T09:00:00.000Z — 3 intended write(s) replayed from the manifest.
```

**JSON output** carries a `recovery` field — `null` on a clean run, otherwise:

```json
{
  "recovery": {
    "performed": true,
    "priorStartedAt": "2026-08-11T09:00:00.000Z",
    "strategy": "replay",
    "replayedWrites": 3,
    "rolledBackEntries": 0,
    "manifestEntries": 3,
    "notes": [],
    "consistent": true
  }
}
```

`strategy` is `"replay"` (preferred) or `"rollback"` (fallback).

## Declining recovery: `--no-recover`

A `--no-recover` flag lets an operator skip automatic recovery — for example, to
inspect the registry or on-disk state manually before reconciling.

```bash
specfuse sync --no-recover
```

When `--no-recover` is set and an interrupted prior sync is detected, the run
aborts with a clear error (the marker is left intact):

```bash
specfuse sync --no-recover --json
# {
#   "error": {
#     "code": "INTERRUPTED_SYNC_PENDING",
#     "message": "An interrupted sync from 2026-08-11T09:00:00.000Z is pending recovery. ...",
#     "startedAt": "2026-08-11T09:00:00.000Z"
#   }
# }
```

Programmatic callers receive an `InterruptedSyncPendingError` (code
`INTERRUPTED_SYNC_PENDING`). Re-running without `--no-recover` reconciles
automatically.

## Crash-safe, idempotent archive

`specfuse change archive <name>` follows the same intent-before-delete pattern.
After the change directory is copied to the archive (and its frontmatter is
updated), a `pendingArchive` marker `{ change, sourceDir, archiveDir }` is
recorded in the registry **before** the source directory is removed. The marker
is cleared once the traceability record is complete.

If the process is interrupted in that window, the next `specfuse change archive
<name>` for the same change:

- **detects the marker**, and
- if the archived copy survived on disk, **completes the registry record without
  re-copying** (the archive is never duplicated), or
- if the archived copy is gone, **clears the stale marker and re-runs the full
  archive** from scratch.

The change is never lost to a mid-archive crash.

## `specfuse doctor` reporting

`specfuse doctor` reports stale markers so they are visible even outside a sync
or archive run:

- `pending-sync` — WARN when an interrupted sync marker is present, with the
  start time and pending-write count. Remediation: run `specfuse sync` to
  reconcile (or `specfuse sync --no-recover` to inspect first).
- `pending-archive` — WARN when an interrupted archive marker is present, noting
  whether the archived copy survived. Remediation: re-run `specfuse change
  archive <name>`.

Both checks are read-only (no lock, no recovery attempt).

## Edge cases

| Scenario | Behavior |
|---|---|
| Marker written but no target writes happened | Reconciliation is a no-op — consistent. |
| Non-deterministic custom rules | Replay uses the manifest's `transformedContent`, not a re-run of `transform()`. |
| Source deleted between crash and recovery | Replay falls back to snapshot rollback with a warning. |
| Crash during recovery itself | Marker is not cleared; the next invocation re-reconciles (idempotent). |
| Concurrent sync + archive | Serialized by the registry advisory lock. |
