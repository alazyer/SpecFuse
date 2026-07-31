# Spec: CI Commands

## SHALL Requirements

1. **SHALL** provide `specfuse ci drift` command.
2. **SHALL** provide `specfuse ci validate` command.
3. **SHALL** provide `specfuse ci check` command (combined).
4. **SHALL** exit 0 on pass, 1 on any failures.

## SHOULD Requirements

5. **SHOULD** support `--fail-on-warn` to exit 1 on warnings.
6. **SHOULD** support `--output <path>` to write to file.

## Test Scenarios

### Scenario: CI drift pass
**Given** no drift detected
**When** user runs `specfuse ci drift`
**Then** exit code is 0

### Scenario: CI drift fail
**Given** drift detected
**When** user runs `specfuse ci drift`
**Then** exit code is 1

### Scenario: CI check combined
**Given** drift detected but validation passes
**When** user runs `specfuse ci check`
**Then** exit code is 1 (drift causes failure)
