## Context

`registry.json` is read with `readFileSafe`, parsed, mutated in memory, and written back with `writeFileAtomic`. The per-file write is atomic, but the read-modify-write window is not guarded, so concurrent processes race. Three concrete failure modes:

1. **Lost update** — `watch` + manual `sync`: both load state S1, both mutate, second save wins, first's sync records vanish silently.
2. **Corrupt JSON** — `Registry.load()` catch block (registry.js:73-76) calls `_fresh()` and logs a warning. All syncs/traces/history gone; API consumers see nothing.
3. **Version mismatch** — `_migrate()` (registry.js:439-459) wipes `syncs`/`traces`/`artifacts`/`loadedRules` on any version difference, with no backup and no migration between intermediate versions.

The `batch.mjs` archive flow (lines 158-183) is a single-process variant of the lost-update bug: it creates a second `Registry` instance and saves twice, so an external writer can interleave between the trace write and the history write.

## Goals / Non-Goals

**Goals:**

- Serialize concurrent registry writers with an advisory lock + stale-lock reclamation.
- Make corrupt-JSON and version-mismatch handling non-destructive (quarantine + backup) and observable (structured errors).
- Collapse the batch-archive double-Registry into one locked transaction.
- Surface registry health in `specfuse doctor`.

**Non-Goals:**

- True multi-file sync transactions (owned by `sync-atomicity-and-recovery`).
- Fixing every silent empty-fallback across the codebase (that is the W3 scope of `sweep-architecture-weaknesses`); this change scopes to the registry only.
- Distributed locking across network filesystems; the lock is local-file based, suitable for a single-developer workstation and watch mode.

## Decisions

### D1: PID-based lockfile with staleness detection
A lockfile (e.g. `.specfuse/registry.lock`) holding the holder's PID and an acquisition timestamp SHALL guard writers. On acquire, the writer checks the PID; if the process is gone, the lock is reclaimed. This handles the common "crashed process left a lock" case without manual cleanup. A lockfile is chosen over `flock`/`O_EXCL`-only schemes because PID-based staleness is inspectable and recoverable, and it stays within Node's portable fs API.

### D2: Lock scope is the load-mutate-save sequence, not individual calls
The lock is NOT held around every `Registry` method. Callers that perform load-mutate-save (sync, archive, batch archive, resolve, watch) SHALL acquire the lock for the duration of the sequence. `Registry` exposes `withLock(fn)` to make this ergonomic and to guarantee release on throw. Read-only operations (drift, status) do not need the lock.

### D3: Quarantine, never delete
On corrupt JSON or unrecoverable shape, the loader renames the offending file to `registry.json.corrupt-<n>` (or `registry.json.pre-migrate-<version>`) and initializes fresh. The original is never deleted, so a user can recover by hand. This is strictly safer than the current silent `_fresh()`.

### D4: Field-level migration map, backup-then-migrate
`_migrate()` is restructured into a per-version migration map (`v3→v4`, etc.). Before migrating, the original is backed up. Fields with a migration are transformed; fields without one are preserved as-is rather than wiped. An unknown future version triggers quarantine + a structured error rather than a blind reset, so a downgrade does not destroy newer-state data.

### D5: New typed errors
`src/api/errors.mjs` gains `RegistryError` and `RegistryLockedError` (subclasses of `SpecFuseApiError`). The corrupt-JSON and version-mismatch paths throw/report these so API consumers see typed failures, matching the existing contract that API functions throw `SpecFuseApiError` subclasses.

## Trade-offs

- **Lockfile vs `flock`**: lockfile + PID is portable and inspectable but can still leak if a process is killed with SIGKILL between pid-check and write. Mitigation: stale-PID reclamation covers the common case; `specfuse doctor` + the `RegistryLockedError` message tell the operator how to clear a stubborn lock.
- **Locking adds latency** to every writer. For a workstation tool this is negligible (sub-ms); watch mode already serializes in-process.
- **Quarantine accumulates files** over many corruptions. Mitigation: `specfuse doctor` lists quarantines; a future `clean` could prune them (out of scope here).

## Risks

- A long-running `watch` holds the lock across a slow sync, blocking the user's manual command. Mitigation: configurable acquire timeout with a clear `RegistryLockedError`; watch syncs are short.
- Migration-map growth: as versions accumulate, the map grows. Acceptable; each entry is small and versioned.
- Interaction with the `sync-atomicity-and-recovery` journal: both touch registry lifecycle. The lock wraps the journal's load-mutate-save; the journal's `pendingSync` marker lives inside the locked region. The two changes are designed to compose, and the Planner SHOULD sequence registry-concurrency-safety before or alongside sync-atomicity-and-recovery.
