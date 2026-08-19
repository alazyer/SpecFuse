## 1. Registry journal foundations

- [ ] 1.1 Update `src/core/registry.js` to persist `pendingSync` and `pendingArchive` structures with helper accessors, including the pre-sync snapshot, target-file manifest with recorded transformed content, archive intent details, and persistence expectations.
- [ ] 1.2 Add targeted registry tests covering marker serialization, marker clearing, and stale-marker shape validation.

## 2. Sync transaction and recovery engine

- [ ] 2.1 In `src/core/sync-engine.js`, write the `pendingSync` marker before the first target-file mutation and clear it only after the final registry persistence succeeds.
- [ ] 2.2 Reconcile a stale `pendingSync` marker at sync start by treating pre-write markers as no-ops, replaying recorded manifest content first, repairing stale hashes when on-disk content already matches the manifest, and rolling back to the snapshot only when replay is impossible.
- [ ] 2.3 Ensure unreplayable targets fall back to snapshot rollback without leaving the marker behind.

## 3. Crash-safe archive recovery path

- [ ] 3.1 In `src/core/change-workflow.js`, record `pendingArchive` immediately after archive copy succeeds and before deleting the source change directory.
- [ ] 3.2 Resume a stale `pendingArchive` marker idempotently by completing registry/history updates when the archived copy exists, and clear the marker without recording completion when the archived copy is missing.

## 4. CLI, API, and doctor reporting

- [ ] 4.1 Update `src/commands/sync.js` and `src/api/sync-ops.mjs` to expose a `recovery` summary for clean, recovered, and recovery-bypassed runs.
- [ ] 4.2 Add `--no-recover` operator control so automatic reconciliation can be skipped for inspection.
- [ ] 4.3 Update `src/commands/doctor.js` to warn on stale `pendingSync` and `pendingArchive` markers without mutating state.

## 5. Verification and documentation

- [ ] 5.1 Add interruption simulations in `src/tests/sync-recovery.test.js` covering replay recovery, rollback fallback, stale-hash repair, pre-write no-op markers, archive idempotency, missing-archive marker clearing, and `--no-recover` behavior.
- [ ] 5.2 Extend CLI/API tests to verify `recovery` JSON shape and human output for clean versus recovered runs.
- [ ] 5.3 Document sync recovery behavior and operator guidance in `docs/sync-recovery.md`.
- [ ] 5.4 Run `pnpm test` and confirm the full regression suite passes.
