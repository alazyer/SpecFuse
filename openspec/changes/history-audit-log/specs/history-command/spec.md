# Spec: History Command

## SHALL Requirements

1. **SHALL** store history events in `registry.json` under `history` key.
2. **SHALL** record timestamp, type, summary, and details for each event.
3. **SHALL** support filtering by event type (`sync`, `archive`, `validate`, etc.).
4. **SHALL** support filtering by date range (`--since`, `--until`).

## SHOULD Requirements

5. **SHOULD** limit default output to 20 most recent events.
6. **SHOULD** support configurable history limit (default 100).
7. **SHOULD** prune oldest events when limit exceeded.

## Test Scenarios

### Scenario: Record sync event
**Given** a project with registry
**When** `specfuse sync` completes
**Then** a history event with `type: "sync"` is recorded
**And** event includes summary of rules run and changes made

### Scenario: Filter by type
**Given** history with sync and archive events
**When** user runs `specfuse history archive`
**Then** only archive events are shown

### Scenario: Filter by date
**Given** history spanning multiple days
**When** user runs `specfuse history --since 2026-07-01`
**Then** only events on or after 2026-07-01 are shown
