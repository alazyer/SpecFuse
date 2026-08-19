## ADDED Requirements

### Requirement: Resolve accepts a non-interactive --choice flag
The `resolve` command and `sync --resolve` SHALL accept a `--choice <source|target|skip>` option that applies the chosen resolution to the conflicted pair(s) without reading stdin or prompting. `source` overwrites the managed section with source-extracted content; `target` keeps the current managed section; `skip` leaves the pair in `BOTH_CHANGED` and continues.

#### Scenario: --choice source applies without prompting
- **WHEN** the user runs `specfuse resolve <rule-id> --choice source` and the rule is in `BOTH_CHANGED` state
- **THEN** the command SHALL overwrite the managed section with the source-extracted content (same outcome as interactive "accept source")
- **AND** it SHALL update the registry so the pair returns to `IN_SYNC`
- **AND** the command SHALL NOT open a readline prompt or read from stdin

#### Scenario: --choice target keeps managed section
- **WHEN** the user runs `specfuse resolve <rule-id> --choice target` on a `BOTH_CHANGED` rule
- **THEN** the managed section SHALL be kept as-is
- **AND** the registry SHALL be updated so the pair returns to `IN_SYNC` (the source is treated as acknowledged)

#### Scenario: --choice skip leaves the pair conflicted
- **WHEN** the user runs `specfuse sync --resolve --choice skip` and one or more pairs are `BOTH_CHANGED`
- **THEN** the command SHALL apply all non-conflicted pairs normally
- **AND** each `BOTH_CHANGED` pair SHALL be left in `BOTH_CHANGED` state (registry not changed for those pairs)
- **AND** the command SHALL exit reporting which pairs were skipped

### Requirement: Non-interactive context fails fast instead of hanging
When no `--choice` is provided and the invocation is non-interactive (stdin is not a TTY, or the `CI` environment variable is set), the command SHALL NOT block on stdin. It SHALL exit non-zero with a message naming the conflicted rule(s) and listing the available `--choice` values.

#### Scenario: CI invocation with conflict and no --choice fails fast
- **WHEN** `specfuse sync` is run in a CI environment (`CI` set, stdin not a TTY) and a `BOTH_CHANGED` conflict is encountered, with no `--choice` provided
- **THEN** the command SHALL exit with a non-zero code
- **AND** it SHALL print a message naming the conflicted rule(s) and suggesting `--choice source|target|skip`
- **AND** it SHALL NOT hang waiting on stdin input

#### Scenario: TTY invocation still prompts when no --choice
- **WHEN** `specfuse resolve <rule-id>` is run with stdin as a TTY and no `--choice`
- **THEN** the existing interactive prompt SHALL be shown (no regression)
- **AND** the three options (accept source / keep target / skip) SHALL be presented as before

## MODIFIED Requirements

### Requirement: Resolve command shows conflict diff
The `specfuse resolve <rule-id>` command SHALL display a diff comparing the source-extracted content against the current managed-section content for the specified `BOTH_CHANGED` rule, then either apply the `--choice` flag (if provided) or, when stdin is a TTY, prompt for an interactive choice.

#### Scenario: Resolve invoked on a BOTH_CHANGED rule with --choice
- **WHEN** user runs `specfuse resolve <rule-id> --choice source` and that rule is in `BOTH_CHANGED` state
- **THEN** the command SHALL print the diff (for review) followed by applying the `--choice` resolution without prompting
- **AND** the registry SHALL be updated to `IN_SYNC`

#### Scenario: Resolve invoked on a BOTH_CHANGED rule interactively (TTY, no --choice)
- **WHEN** user runs `specfuse resolve <rule-id>` on a TTY with no `--choice`
- **THEN** the command SHALL print the unified diff and present the three-option prompt as before
- **AND** behavior SHALL be unchanged from the prior interactive flow
