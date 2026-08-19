## ADDED Requirements

### Requirement: Operational outcomes use structured states
SpecFuse SHALL represent command/API operational outcomes with structured states rather than requiring callers to parse human-readable messages.

#### Scenario: Sync rule fails during Pass A
- **WHEN** a sync rule throws during Pass A
- **THEN** the sync result SHALL include a machine-readable state indicating failure
- **AND** Pass B skip logic SHALL use that structured state rather than checking whether the result message starts with a particular string

#### Scenario: Sync rule is skipped due to conflict
- **WHEN** a sync rule is skipped because of `BOTH_CHANGED` drift
- **THEN** the sync result SHALL include a machine-readable state indicating skipped/conflicted
- **AND** it SHALL remain distinguishable from an execution failure and from a no-op in-sync result

### Requirement: Silent degradation is allowed only when it is explicitly classified
SpecFuse SHALL classify degraded reads of optional directories, corrupt files, permission errors, and empty-but-valid state distinctly in JSON/API surfaces.

#### Scenario: Optional archive directory is missing
- **WHEN** a list operation inspects a project with no archive directory
- **THEN** the structured result SHALL identify the archive state as empty or absent-but-valid
- **AND** the operation SHALL NOT report an error

#### Scenario: Archive directory cannot be read
- **WHEN** a list operation cannot read an existing archive directory because of permissions or corruption
- **THEN** the structured result SHALL include a warning or error code for unreadable archive state
- **AND** it SHALL NOT silently present the same output as a valid empty archive

### Requirement: API errors are typed and presentation-free
Programmatic APIs SHALL throw typed errors for invalid operations and SHALL NOT log to console, call `process.exit`, or import CLI-only presentation dependencies.

#### Scenario: API function detects invalid user input
- **WHEN** an API function detects invalid input such as a duplicate artifact, missing required artifact, invalid configuration value, or unverified archive attempt
- **THEN** it SHALL throw a `SpecFuseApiError` subclass with machine-readable fields
- **AND** it SHALL NOT write to stdout/stderr or terminate the process

#### Scenario: CLI adapter detects same invalid operation
- **WHEN** the CLI performs the same invalid operation
- **THEN** it SHALL map the shared error/result into user-facing prose and exit behavior
- **AND** it SHALL preserve the same underlying error code or state for JSON output when JSON output exists

### Requirement: Diagnostics expose architecture-relevant warnings
SpecFuse diagnostics SHALL expose warnings for architecture-relevant inconsistencies that do not necessarily block command execution.

#### Scenario: Path-model inconsistency is found
- **WHEN** diagnostics find hard-coded artifact root prose that contradicts runtime path constants
- **THEN** diagnostics SHALL emit a warning that identifies the inconsistent surface and expected canonical root

#### Scenario: Presentation dependency leaks into API surface
- **WHEN** diagnostics or tests inspect API modules
- **THEN** they SHALL fail or warn if API modules import `chalk`, call `console.*`, call `logger.*`, or call `process.exit`
- **AND** they SHALL allow those dependencies in CLI adapter modules where presentation is expected

