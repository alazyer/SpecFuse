# Spec: Config Schema



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Config Schema
The system SHALL provide the implemented config schema capability.

- SHALL define valid values for each config key.
- SHALL validate config on read and write.
- SHALL reject invalid values with error message.
- SHOULD coerce string values to correct types.
- SHOULD document valid values in error messages.

#### Scenario: Validate phase
- **GIVEN** config with `registry.phase: "invalid"`
- **WHEN** `validateConfig()` is called
- **THEN** returns error: "phase must be one of: unknown, planning, feature-dev, maintenance"
#### Scenario: Type coercion
- **GIVEN** user runs `specfuse config set registry.maxHistory "50"`
- **WHEN** value is stored
- **THEN** registry has `maxHistory: 50` (number, not string)
