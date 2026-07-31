# Spec: Clean Command

## SHALL Requirements

1. **SHALL** provide `specfuse clean` command.
2. **SHALL** provide `specfuse clean --dry-run` to preview changes.
3. **SHALL** require confirmation before destructive operations.

## SHOULD Requirements

4. **SHOULD** support `--force` to skip confirmation.
5. **SHOULD** log all clean operations to history.

## Test Scenarios

### Scenario: Dry run
**Given** orphaned files exist
**When** user runs `specfuse clean --dry-run`
**Then** files are listed but not removed
**And** exit code is 0

### Scenario: Clean with confirmation
**Given** orphaned files exist
**When** user runs `specfuse clean` and confirms
**Then** files are removed
**And** operations logged to history

### Scenario: Clean registry only
**Given** stale registry entries
**When** user runs `specfuse clean --registry`
**Then** only registry entries are cleaned
