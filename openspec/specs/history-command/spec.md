# Spec: History Command



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: History Command
The system SHALL provide the implemented history command capability.

- SHALL store history events in `registry.json` under `history` key.
- SHALL record timestamp, type, summary, and details for each event.
- SHALL support filtering by event type (`sync`, `archive`, `validate`, etc.).
- SHALL support filtering by date range (`--since`, `--until`).
- SHOULD limit default output to 20 most recent events.
- SHOULD support configurable history limit (default 100).
- SHOULD prune oldest events when limit exceeded.

#### Scenario: Record sync event
- **GIVEN** a project with registry
- **WHEN** `specfuse sync` completes
- **THEN** a history event with `type: "sync"` is recorded
- **AND** event includes summary of rules run and changes made
#### Scenario: Filter by type
- **GIVEN** history with sync and archive events
- **WHEN** user runs `specfuse history archive`
- **THEN** only archive events are shown
#### Scenario: Filter by date
- **GIVEN** history spanning multiple days
- **WHEN** user runs `specfuse history --since 2026-07-01`
- **THEN** only events on or after 2026-07-01 are shown
