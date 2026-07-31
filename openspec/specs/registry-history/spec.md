# Spec: Registry History Storage



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Registry History Storage
The system SHALL provide the implemented registry history storage capability.

- SHALL add `history` array to registry schema.
- SHALL append events to history on each operation.
- SHALL preserve history across `registry.save()` calls.
- SHOULD add unique ID to each event.
- SHOULD store events in chronological order (oldest first).

#### Scenario: Initialize history
- **GIVEN** a fresh registry with no history key
- **WHEN** registry is loaded
- **THEN** `history: []` is added
#### Scenario: Append event
- **GIVEN** registry with 5 history events
- **WHEN** `recordEvent("sync", "Synced 3 rules", {})` is called
- **THEN** history has 6 events
- **AND** new event is last in array
