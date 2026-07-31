# Spec: Config Schema

## SHALL Requirements

1. **SHALL** define valid values for each config key.
2. **SHALL** validate config on read and write.
3. **SHALL** reject invalid values with error message.

## SHOULD Requirements

4. **SHOULD** coerce string values to correct types.
5. **SHOULD** document valid values in error messages.

## Test Scenarios

### Scenario: Validate phase
**Given** config with `registry.phase: "invalid"`
**When** `validateConfig()` is called
**Then** returns error: "phase must be one of: unknown, planning, feature-dev, maintenance"

### Scenario: Type coercion
**Given** user runs `specfuse config set registry.maxHistory "50"`
**When** value is stored
**Then** registry has `maxHistory: 50` (number, not string)
