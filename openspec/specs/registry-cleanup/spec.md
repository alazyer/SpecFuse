# Spec: Registry Cleanup



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Registry Cleanup
The system SHALL provide the implemented registry cleanup capability.

- SHALL remove sync entries for missing source/target.
- SHALL remove trace entries for missing stories.
- SHALL preserve valid entries.
- SHOULD compact registry file after cleanup.
- SHOULD report counts of removed entries.

#### Scenario: Remove stale sync
- **GIVEN** registry with sync entry for non-existent file
- **WHEN** cleanup runs
- **THEN** entry is removed
- **AND** other entries preserved
#### Scenario: Remove stale trace
- **GIVEN** registry with trace for `STORY-999`
- **AND** `STORY-999.md` does not exist
- **WHEN** cleanup runs
- **THEN** trace entry is removed
