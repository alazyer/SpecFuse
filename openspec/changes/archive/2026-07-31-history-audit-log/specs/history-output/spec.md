# Spec: History Output Formats

## SHALL Requirements

1. **SHALL** support `--json` flag for machine-readable output.
2. **SHALL** include all event fields in JSON output.

## SHOULD Requirements

3. **SHOULD** format timestamps in ISO 8601.
4. **SHOULD** include relative time in human output (e.g., "2 hours ago").

## Test Scenarios

### Scenario: JSON output
**Given** history with events
**When** user runs `specfuse history --json`
**Then** output is valid JSON array
**And** each event has `timestamp`, `type`, `summary`, `details`

### Scenario: Human output
**Given** history with recent events
**When** user runs `specfuse history`
**Then** events are formatted as table with relative times
