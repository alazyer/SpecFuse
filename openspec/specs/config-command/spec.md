# Spec: Config Command



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Config Command
The system SHALL provide the implemented config command capability.

- SHALL provide `specfuse config list` command.
- SHALL provide `specfuse config get <key>` command.
- SHALL provide `specfuse config set <key> <value>` command.
- SHALL provide `specfuse config validate` command.
- SHALL support dot notation for keys (e.g., `registry.phase`).
- SHOULD group output by source (registry, schema, rules).
- SHOULD indicate read-only keys.

#### Scenario: List config
- **GIVEN** a project with registry and schema
- **WHEN** user runs `specfuse config list`
- **THEN** all config keys are shown grouped by source
#### Scenario: Get config value
- **GIVEN** registry with `phase: "feature-dev"`
- **WHEN** user runs `specfuse config get registry.phase`
- **THEN** output is `feature-dev`
#### Scenario: Set config value
- **GIVEN** a project
- **WHEN** user runs `specfuse config set registry.phase maintenance`
- **THEN** registry is updated with `phase: "maintenance"`
