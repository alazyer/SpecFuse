# Spec: History Output Formats



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: History Output Formats
The system SHALL provide the implemented history output formats capability.

- SHALL support `--json` flag for machine-readable output.
- SHALL include all event fields in JSON output.
- SHOULD format timestamps in ISO 8601.
- SHOULD include relative time in human output (e.g., "2 hours ago").

#### Scenario: JSON output
- **GIVEN** history with events
- **WHEN** user runs `specfuse history --json`
- **THEN** output is valid JSON array
- **AND** each event has `timestamp`, `type`, `summary`, `details`
#### Scenario: Human output
- **GIVEN** history with recent events
- **WHEN** user runs `specfuse history`
- **THEN** events are formatted as table with relative times
