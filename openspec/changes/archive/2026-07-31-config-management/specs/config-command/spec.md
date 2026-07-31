# Spec: Config Command

## SHALL Requirements

1. **SHALL** provide `specfuse config list` command.
2. **SHALL** provide `specfuse config get <key>` command.
3. **SHALL** provide `specfuse config set <key> <value>` command.
4. **SHALL** provide `specfuse config validate` command.
5. **SHALL** support dot notation for keys (e.g., `registry.phase`).

## SHOULD Requirements

6. **SHOULD** group output by source (registry, schema, rules).
7. **SHOULD** indicate read-only keys.

## Test Scenarios

### Scenario: List config
**Given** a project with registry and schema
**When** user runs `specfuse config list`
**Then** all config keys are shown grouped by source

### Scenario: Get config value
**Given** registry with `phase: "feature-dev"`
**When** user runs `specfuse config get registry.phase`
**Then** output is `feature-dev`

### Scenario: Set config value
**Given** a project
**When** user runs `specfuse config set registry.phase maintenance`
**Then** registry is updated with `phase: "maintenance"`
