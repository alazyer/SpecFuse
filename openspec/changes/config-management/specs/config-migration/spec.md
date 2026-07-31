# Spec: Config Migration

## SHALL Requirements

1. **SHALL** add missing config keys on load.
2. **SHALL** preserve existing config values during migration.

## SHOULD Requirements

3. **SHOULD** log migration actions.
4. **SHOULD** support rollback on error.

## Test Scenarios

### Scenario: Add missing key
**Given** registry without `maxHistory` key
**When** config is loaded
**Then** `maxHistory: 100` is added
**And** other values preserved

### Scenario: Preserve existing
**Given** registry with `phase: "maintenance"`
**When** config is loaded
**Then** `phase` remains `"maintenance"`
