## ADDED Requirements

### Requirement: CI measures and gates on code coverage
The CI workflow SHALL run the test suite with code coverage instrumentation and SHALL fail the build when coverage falls below the configured threshold (lines/branches/functions/statements). The threshold SHALL be set to the current coverage baseline so that existing code passes and only regressions fail.

#### Scenario: CI runs tests with coverage
- **WHEN** CI runs on a pull request
- **THEN** the test step SHALL execute with a coverage tool (c8) and collect per-file line/branch/function/statement coverage
- **AND** a coverage report (lcov) SHALL be produced and uploaded as a CI artifact

#### Scenario: Coverage regression fails CI
- **WHEN** a pull request reduces coverage below the configured threshold (e.g. removes tests covering a previously-covered module without replacement)
- **THEN** the CI build SHALL fail with a coverage-threshold error identifying the shortfall
- **AND** the PR SHALL be blocked from merge

#### Scenario: Existing code passes the coverage gate
- **WHEN** CI runs on the main branch with no coverage change
- **THEN** the build SHALL pass, because the threshold is set at or just below the current baseline

### Requirement: CI enforces the lint gate
The CI workflow SHALL run `pnpm lint` (ESLint) and SHALL fail the build on lint errors. Lint warnings SHALL remain non-fatal at initial rollout; a documented follow-up escalates `no-unused-vars` to error after the existing warnings are cleared.

#### Scenario: Lint error fails CI
- **WHEN** a pull request introduces a lint error (e.g. an actual ESLint error, not a warning)
- **THEN** the CI lint step SHALL fail and block the PR

#### Scenario: Existing warnings do not block CI at rollout
- **WHEN** CI runs the lint step on existing code that carries the current warnings (no errors)
- **THEN** the lint step SHALL pass
- **AND** warnings SHALL be reported in CI output but SHALL NOT fail the build at initial rollout

### Requirement: Coverage is runnable and viewable locally
A developer SHALL be able to run `pnpm test:coverage` locally to produce a coverage report and view which files/lines are uncovered, without CI.

#### Scenario: Local coverage report
- **WHEN** a developer runs `pnpm test:coverage`
- **THEN** a text coverage summary SHALL be printed to the terminal (per-file percentages)
- **AND** an lcov report SHALL be written to a coverage output directory for HTML viewer consumption
- **AND** the command SHALL exit non-zero if coverage is below the configured threshold
