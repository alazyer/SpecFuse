## ADDED Requirements

### Requirement: diff --apply updates the registry to match written content
When `diff --apply` (CLI) or `diff({ apply: true })` (API) writes proposed content to a target file, the registry SHALL be updated to reflect that written content for the affected pair, using the same content-hash / `recordSync` contract the sync engine uses. A subsequent `specfuse drift` SHALL report `IN_SYNC` for that pair (in the absence of a genuine new source change).

#### Scenario: Applied pair reports IN_SYNC on next drift
- **WHEN** the user runs `specfuse diff --apply` and one pair's proposed content is written to the target file
- **THEN** the registry's sync state for that pair SHALL be updated to record the written content's hash
- **AND** a subsequent `specfuse drift` for that pair SHALL report `IN_SYNC`
- **AND** no `TARGET_CHANGED` or `SOURCE_CHANGED` state SHALL be reported for content the apply just wrote

#### Scenario: Apply without --apply is a pure preview
- **WHEN** the user runs `specfuse diff` (no `--apply`)
- **THEN** no file SHALL be written and the registry SHALL NOT be mutated
- **AND** drift behavior SHALL be unchanged from before this change

### Requirement: Registry is updated only for successfully written pairs
A pair whose target file failed to write (`written: false` from `applyDiff`) SHALL NOT have its registry sync state updated. The registry reflects only content that actually reached disk.

#### Scenario: Failed write does not record a false sync
- **WHEN** `applyDiff` writes pair A successfully but pair B fails (e.g. a permission error on B's target file)
- **THEN** the registry SHALL be updated for pair A (recording the written content)
- **AND** the registry SHALL NOT be updated for pair B (no false `IN_SYNC` recorded for unwritten content)
- **AND** the failed pair B SHALL remain in its prior drift state

### Requirement: diff --apply is concurrency-safe
The API `diff({ apply: true })` path SHALL acquire the registry advisory lock around the apply-and-record sequence, so a concurrent `specfuse watch` or `specfuse sync` cannot interleave and lose the recorded sync state.

#### Scenario: Watch running during diff --apply
- **WHEN** `specfuse watch` is running and a concurrent `diff({ apply: true })` API call applies and records a pair
- **THEN** the apply path SHALL hold the advisory lock for the duration of the write-and-record sequence
- **AND** the recorded sync state SHALL NOT be silently overwritten by the watch process's own registry write

### Requirement: Registry is saved exactly once after the apply
The registry SHALL be saved exactly once after all applicable pairs in a single `--apply` invocation have been written and recorded, not once per pair.

#### Scenario: Single save after a multi-pair apply
- **WHEN** `diff --apply` applies three pairs successfully in one invocation
- **THEN** `registry.save()` SHALL be called exactly once, after all three records are applied in memory
- **AND** the on-disk registry SHALL reflect all three recorded syncs atomically
