# Spec: Config Migration



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Config Migration
The system SHALL provide the implemented config migration capability.

- SHALL add missing config keys on load.
- SHALL preserve existing config values during migration.
- SHOULD log migration actions.
- SHOULD support rollback on error.

#### Scenario: Add missing key
- **GIVEN** registry without `maxHistory` key
- **WHEN** config is loaded
- **THEN** `maxHistory: 100` is added
- **AND** other values preserved
#### Scenario: Preserve existing
- **GIVEN** registry with `phase: "maintenance"`
- **WHEN** config is loaded
- **THEN** `phase` remains `"maintenance"`
