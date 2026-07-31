# Spec: Registry Cleanup

## SHALL Requirements

1. **SHALL** remove sync entries for missing source/target.
2. **SHALL** remove trace entries for missing stories.
3. **SHALL** preserve valid entries.

## SHOULD Requirements

4. **SHOULD** compact registry file after cleanup.
5. **SHOULD** report counts of removed entries.

## Test Scenarios

### Scenario: Remove stale sync
**Given** registry with sync entry for non-existent file
**When** cleanup runs
**Then** entry is removed
**And** other entries preserved

### Scenario: Remove stale trace
**Given** registry with trace for `STORY-999`
**And** `STORY-999.md` does not exist
**When** cleanup runs
**Then** trace entry is removed
