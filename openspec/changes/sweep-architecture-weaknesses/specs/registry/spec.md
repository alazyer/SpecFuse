## MODIFIED Requirements

### Requirement: Registry records bidirectional trace links
When sync detects story references in active change proposals, the registry SHALL store bidirectional trace links between changes and stories, and registry consumers SHALL be able to identify canonical artifact paths and path-model warnings from the same registry-backed artifact contract.

#### Scenario: Record trace link on sync
- **WHEN** `specfuse sync` processes an active change with `stories: STORY-001, STORY-002`
- **THEN** registry SHALL store trace entries mapping the change slug to both story IDs
- **AND** story trace queries SHALL return that change as linked to each story

#### Scenario: Update trace link when proposal changes
- **WHEN** proposal frontmatter changes from `stories: STORY-001` to `stories: STORY-002`
- **AND** sync runs
- **THEN** registry SHALL remove the stale STORY-001 active link and add the STORY-002 active link

#### Scenario: Mark story implemented on archive
- **WHEN** `specfuse change archive <name>` archives a change linked to STORY-001
- **THEN** registry SHALL mark STORY-001 as implemented by the archive name
- **AND** trace queries SHALL distinguish active links from implemented links

#### Scenario: Registry reports canonical artifact path
- **WHEN** a consumer requests the path for a registered artifact ID such as `constitution`, `changes:active`, or `changes:archive`
- **THEN** registry SHALL return the canonical runtime path used by SpecFuse commands
- **AND** adjacent documentation and diagnostics SHALL use the same path contract

#### Scenario: Registry detects path-model mismatch
- **WHEN** diagnostics compare known runtime artifact roots against project files and discover a non-canonical active change root
- **THEN** registry-backed diagnostics SHALL identify the non-canonical root with a warning
- **AND** they SHALL identify the canonical root for native commands

