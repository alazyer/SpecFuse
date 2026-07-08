## MODIFIED Requirements

### Requirement: Sync auto-detects story references and records trace links
When `specfuse sync` runs, the sync engine SHALL scan active change proposals for `stories:` frontmatter and record trace links in the registry for each referenced story ID.

#### Scenario: Sync records trace links from proposals
- **WHEN** `specfuse sync` runs
- **AND** active change "add-login" has `stories: STORY-001, STORY-003` in its proposal frontmatter
- **THEN** the sync engine SHALL call `registry.recordTrace("add-login", ["STORY-001", "STORY-003"])`
- **AND** the registry traces SHALL contain entries for STORY-001 and STORY-003

#### Scenario: Sync updates traces when stories field changes
- **WHEN** a proposal's `stories:` field is updated from "STORY-001" to "STORY-001, STORY-005"
- **AND** sync runs
- **THEN** the registry traces SHALL be updated: STORY-001 still active, STORY-005 added as active

#### Scenario: Proposal without stories frontmatter
- **WHEN** a proposal has no `stories:` frontmatter field
- **THEN** the sync engine SHALL skip trace link recording for that change (no error)
