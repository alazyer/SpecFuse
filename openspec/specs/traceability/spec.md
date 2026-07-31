# Spec: Traceability



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Build traceability matrix from project artifacts
The traceability engine SHALL scan `.specfuse/plan/stories/` for story IDs, scan active and archived change proposals for `stories:` frontmatter references, and combine this data with registry trace records to produce a complete traceability matrix.

#### Scenario: Matrix with active and archived changes
- **WHEN** stories STORY-001 and STORY-003 exist in `.specfuse/plan/stories/`
- **AND** active change "add-login" references `stories: STORY-001`
- **AND** archived change "2026-07-01-user-auth" referenced `stories: STORY-003`
- **THEN** the matrix SHALL list STORY-001 with status "active" linked to "add-login"
- **AND** the matrix SHALL list STORY-003 with status "implemented" linked to "2026-07-01-user-auth"

#### Scenario: Story with no changes
- **WHEN** story STORY-005 exists in `.specfuse/plan/stories/`
- **AND** no active or archived change references STORY-005
- **THEN** the matrix SHALL list STORY-005 with status "uncovered" and no linked changes

#### Scenario: Story referenced by multiple active changes
- **WHEN** both "add-login" and "user-profiles" reference `stories: STORY-001`
- **THEN** the matrix SHALL list STORY-001 with status "active" and linked changes ["add-login", "user-profiles"]

### Requirement: Compute coverage report
The traceability engine SHALL compute coverage metrics from the traceability matrix: total stories, stories with active changes, stories implemented, and stories uncovered.

#### Scenario: Full coverage report
- **WHEN** 5 stories exist
- **AND** 2 have active changes, 1 is implemented, 2 are uncovered
- **THEN** coverage report SHALL show: total=5, active=2, implemented=1, uncovered=2

#### Scenario: All stories covered
- **WHEN** all stories have either active changes or are implemented
- **THEN** coverage report SHALL show uncovered=0

### Requirement: Detect unknown story IDs
The traceability engine SHALL warn when a proposal's `stories:` frontmatter references a story ID that does not exist in `.specfuse/plan/stories/`.

#### Scenario: Unknown story reference
- **WHEN** a proposal references `stories: STORY-999`
- **AND** no file exists in `.specfuse/plan/stories/` for STORY-999
- **THEN** the engine SHALL include STORY-999 in the matrix with status "unknown" and emit a warning

### Requirement: Record trace links in registry
The traceability engine SHALL provide a function to record that a change references specific story IDs, storing the link in `registry.json` under `traces.<storyId>.active[]`.

#### Scenario: Recording trace link
- **WHEN** change "add-login" references stories ["STORY-001", "STORY-003"]
- **THEN** registry traces SHALL contain `STORY-001: { active: ["add-login"], implemented: false }` and `STORY-003: { active: ["add-login"], implemented: false }`

### Requirement: Mark stories as implemented on archive
The traceability engine SHALL provide a function to mark story IDs as implemented when their linked change is archived, moving the change from `active[]` to `implemented: true` and recording `implementedBy`.

#### Scenario: Marking stories implemented on archive
- **WHEN** change "add-login" referencing STORY-001 is archived as "2026-07-08-add-login"
- **THEN** registry traces SHALL update STORY-001 to `{ active: [], implemented: true, implementedBy: "2026-07-08-add-login" }`

#### Scenario: Story referenced by multiple changes, one archived
- **WHEN** STORY-001 is referenced by both "add-login" and "user-profiles"
- **AND** "add-login" is archived
- **THEN** STORY-001 traces SHALL show `{ active: ["user-profiles"], implemented: true, implementedBy: "2026-07-08-add-login" }`
