# Spec: Registry History Storage

## SHALL Requirements

1. **SHALL** add `history` array to registry schema.
2. **SHALL** append events to history on each operation.
3. **SHALL** preserve history across `registry.save()` calls.

## SHOULD Requirements

4. **SHOULD** add unique ID to each event.
5. **SHOULD** store events in chronological order (oldest first).

## Test Scenarios

### Scenario: Initialize history
**Given** a fresh registry with no history key
**When** registry is loaded
**Then** `history: []` is added

### Scenario: Append event
**Given** registry with 5 history events
**When** `recordEvent("sync", "Synced 3 rules", {})` is called
**Then** history has 6 events
**And** new event is last in array
