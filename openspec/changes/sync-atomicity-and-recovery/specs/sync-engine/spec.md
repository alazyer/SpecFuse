## MODIFIED Requirements

### Requirement: Sync is recoverable after interruption
A two-pass sync SHALL be recoverable to a consistent state if the process is interrupted before completion. The engine SHALL persist an incomplete-sync marker (with the snapshot of pre-sync registry state and the manifest of target files intended to be written) before mutating any target file, so that the next sync invocation can detect an incomplete prior run and reconcile it.

#### Scenario: Sync interrupted before registry save
- **WHEN** `specfuse sync` begins Pass A, writes one or more target files, and the process exits before `registry.save()` completes
- **THEN** the project SHALL retain an incomplete-sync marker recording the pre-sync registry snapshot and the target-file manifest
- **AND** the on-disk file content and the registry SHALL be reconcilable on the next sync without silent desynchronization

#### Scenario: Next sync detects and reconciles an interrupted run
- **WHEN** `specfuse sync` is run and an incomplete-sync marker from a prior run is present
- **THEN** the engine SHALL detect the marker, reconcile state to a consistent point by replaying the manifest's recorded write content when replay is possible, or by rolling back to the pre-sync snapshot when replay is impossible
- **AND** the engine SHALL clear the marker once reconciliation succeeds and proceed with the new sync
- **AND** the sync result SHALL report that a recovery was performed

#### Scenario: Marker exists before any target write
- **WHEN** an incomplete-sync marker is present but no target file from its manifest was mutated before the prior process exited
- **THEN** reconciliation SHALL treat the interrupted run as a no-op
- **AND** the marker SHALL be cleared without changing target content beyond what the new sync run would do normally

#### Scenario: Sync completes normally
- **WHEN** `specfuse sync` runs to completion without interruption
- **THEN** the incomplete-sync marker SHALL be cleared at the end of the run
- **AND** no recovery behavior SHALL be observable

### Requirement: Registry records outcomes before the sync is considered complete
The engine SHALL persist per-rule sync outcomes to the registry as the run progresses (or in an atomic batch guarded by the incomplete-sync marker) before declaring the sync complete, so a crash after target-file writes does not leave the registry silently stale.

#### Scenario: Crash after a target write but before final save
- **WHEN** a rule's target file has been written but the final `registry.save()` has not run, and the process exits
- **THEN** the next sync SHALL NOT report the written rule as `IN_SYNC` based on stale registry hashes
- **AND** reconciliation SHALL bring the registry hash for that target into agreement with the on-disk content (or roll the content back)

#### Scenario: Recovery repairs stale hashes without recomputing transforms
- **WHEN** target content was written successfully but the registry still contains pre-sync hashes from before the interruption
- **THEN** reconciliation SHALL repair the registry hashes to match the on-disk content using the interrupted run's recorded manifest data
- **AND** the engine SHALL NOT require re-running non-deterministic transforms to restore consistency

### Requirement: Archive is crash-safe and idempotent
`change archive` SHALL record its archive intent in the registry (target archive path, source change directory) before deleting the source change directory, so a crash mid-archive can be detected and re-run without losing the change.

#### Scenario: Archive interrupted after source deletion
- **WHEN** `specfuse change archive <name>` has copied the change directory to the archive and deleted the source directory, but the process exits before the registry records the archive
- **THEN** the archive-intent marker SHALL allow the next run to detect the partial archive and complete the registry record (or re-run safely)
- **AND** the change SHALL NOT be lost (the archived copy SHALL remain on disk)

#### Scenario: Archive re-run after interruption
- **WHEN** `specfuse change archive <name>` is re-run after a prior interrupted archive for the same change
- **THEN** the command SHALL detect the prior partial archive, complete the registry record, and exit successfully without duplicating the archived directory

#### Scenario: Archive marker is stale because archived copy is missing
- **WHEN** a `pendingArchive` marker exists but the referenced archived copy is absent when archive recovery runs
- **THEN** the command SHALL clear the stale marker instead of recording a completed archive
- **AND** the operator SHALL be able to re-run archive from the source change directory without duplicate history or archive entries

### Requirement: Sync exposes recovery state and operator controls
The sync result returned by the CLI and the programmatic API SHALL include a recovery summary indicating whether the run performed a reconciliation, what was reconciled, and whether the project is now consistent — in both human and `--json` output. The sync command SHALL also provide an operator control to skip automatic recovery when inspection is preferred.

#### Scenario: Recovery reported in JSON output
- **WHEN** `specfuse sync --json` runs and a recovery is performed
- **THEN** the JSON result SHALL include a `recovery` field describing the prior incomplete run and the reconciliation outcome
- **AND** a non-recovery sync SHALL omit or null-out the `recovery` field

#### Scenario: Operator skips recovery
- **WHEN** an incomplete-sync marker is present and the operator runs `specfuse sync --no-recover`
- **THEN** the command SHALL skip automatic reconciliation
- **AND** the result SHALL indicate that recovery was intentionally bypassed so the operator can inspect the inconsistent state
