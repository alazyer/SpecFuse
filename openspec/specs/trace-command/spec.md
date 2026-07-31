# Spec: Trace Command



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: specfuse trace command displays traceability matrix
The `specfuse trace` command SHALL display a traceability matrix showing each story ID, its status (active/implemented/uncovered/unknown), and linked change names.

#### Scenario: Trace with mixed statuses
- **WHEN** user runs `specfuse trace`
- **THEN** the output SHALL list each story with its status and linked changes
- **AND** active stories SHALL be shown with their active change names
- **AND** implemented stories SHALL be shown with their archived change names
- **AND** uncovered stories SHALL be shown with "no linked changes"
- **AND** unknown story IDs (referenced but not found) SHALL be shown with a warning

#### Scenario: No stories exist
- **WHEN** user runs `specfuse trace` and no stories exist in `.specfuse/plan/stories/`
- **THEN** the command SHALL display "No stories found. Run `specfuse plan story` to create stories."

#### Scenario: No changes reference stories
- **WHEN** stories exist but no proposals have `stories:` frontmatter
- **THEN** all stories SHALL be shown as "uncovered"

### Requirement: specfuse trace --coverage displays coverage summary
The `specfuse trace --coverage` flag SHALL output a concise coverage summary with counts and percentages.

#### Scenario: Coverage summary output
- **WHEN** user runs `specfuse trace --coverage`
- **THEN** the output SHALL show: total stories, stories with active changes, implemented stories, uncovered stories, and coverage percentage
- **AND** coverage percentage SHALL be calculated as (active + implemented) / total * 100

#### Scenario: Full coverage
- **WHEN** all stories are either active or implemented
- **THEN** coverage SHALL show 100% and a success indicator

#### Scenario: JSON output mode
- **WHEN** user runs `specfuse trace --json`
- **THEN** the output SHALL be a JSON object with `stories` array and `coverage` object
