## ADDED Requirements

### Requirement: Shared workflow behavior lives behind deep core modules
For workflows exposed through both CLI commands and programmatic APIs, SpecFuse SHALL place business rules behind a shared core module or utility seam before adapting the result for presentation.

#### Scenario: CLI and API create a change
- **WHEN** maintainers compare native change creation through `specfuse change new` and the programmatic change API
- **THEN** slug resolution, duplicate detection, template rendering, schema application, file creation order, and returned artifact metadata SHALL be implemented in one shared behavior seam
- **AND** CLI-specific logging, chalk formatting, and `process.exit` handling SHALL remain outside that seam

#### Scenario: CLI and API generate review or verification artifacts
- **WHEN** maintainers compare review/verify generation through CLI and API surfaces
- **THEN** acceptance criteria extraction, constitution checklist generation, template filling, idempotency rules, and status normalization SHALL be shared through one behavior seam
- **AND** presentation differences SHALL be confined to adapter code

### Requirement: Presentation adapters do not own business rules
CLI command modules SHALL act as presentation adapters that parse arguments, call core behavior, render output, and map errors to exit behavior.

#### Scenario: Command module handles duplicate change
- **WHEN** `specfuse change new <name>` receives a duplicate change name
- **THEN** duplicate detection SHALL come from the shared workflow seam
- **AND** the command adapter SHALL render the human-readable error and choose the process exit behavior
- **AND** the duplicate business rule SHALL be testable without spawning the CLI

#### Scenario: API module handles duplicate change
- **WHEN** the programmatic change API receives a duplicate change name
- **THEN** it SHALL use the same duplicate detection result as the CLI
- **AND** it SHALL throw a typed `SpecFuseApiError` subclass without logging or exiting

### Requirement: New seams must pass the deletion test
A new module or interface introduced during this remediation SHALL provide meaningful depth: deleting it would force non-presentation business rules back into two or more callers.

#### Scenario: Planner proposes a new workflow module
- **WHEN** implementation planning introduces a new workflow module or interface
- **THEN** the plan SHALL identify which CLI/API/core callers use it
- **AND** it SHALL state which duplicated business rules are removed from callers
- **AND** it SHALL reject modules that only forward arguments without improving locality or leverage

### Requirement: Adapter parity is tested through behavior, not formatting
Shared workflow behavior SHALL be verified through tests that compare semantic results across adapters without requiring identical human-readable formatting.

#### Scenario: CLI and API expose equivalent change summary
- **WHEN** the same fixture project is inspected through CLI JSON output and programmatic API output
- **THEN** slug, title, status, review status, verification progress, UI impact, and active/archive state SHALL match semantically
- **AND** differences in colored text or prose layout SHALL not be part of the parity assertion

