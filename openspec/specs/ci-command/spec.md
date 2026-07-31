# Spec: CI Commands



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: CI Commands
The system SHALL provide the implemented ci commands capability.

- SHALL provide `specfuse ci drift` command.
- SHALL provide `specfuse ci validate` command.
- SHALL provide `specfuse ci check` command (combined).
- SHALL exit 0 on pass, 1 on any failures.
- SHOULD support `--fail-on-warn` to exit 1 on warnings.
- SHOULD support `--output <path>` to write to file.

#### Scenario: CI drift pass
- **GIVEN** no drift detected
- **WHEN** user runs `specfuse ci drift`
- **THEN** exit code is 0
#### Scenario: CI drift fail
- **GIVEN** drift detected
- **WHEN** user runs `specfuse ci drift`
- **THEN** exit code is 1
#### Scenario: CI check combined
- **GIVEN** drift detected but validation passes
- **WHEN** user runs `specfuse ci check`
- **THEN** exit code is 1 (drift causes failure)
