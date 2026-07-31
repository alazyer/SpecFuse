# Spec: Clean Command



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Clean Command
The system SHALL provide the implemented clean command capability.

- SHALL provide `specfuse clean` command.
- SHALL provide `specfuse clean --dry-run` to preview changes.
- SHALL require confirmation before destructive operations.
- SHOULD support `--force` to skip confirmation.
- SHOULD log all clean operations to history.

#### Scenario: Dry run
- **GIVEN** orphaned files exist
- **WHEN** user runs `specfuse clean --dry-run`
- **THEN** files are listed but not removed
- **AND** exit code is 0
#### Scenario: Clean with confirmation
- **GIVEN** orphaned files exist
- **WHEN** user runs `specfuse clean` and confirms
- **THEN** files are removed
- **AND** operations logged to history
#### Scenario: Clean registry only
- **GIVEN** stale registry entries
- **WHEN** user runs `specfuse clean --registry`
- **THEN** only registry entries are cleaned
