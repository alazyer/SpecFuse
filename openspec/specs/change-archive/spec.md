# Spec: Change Archive



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Archive marks linked stories as implemented
When `specfuse change archive <name>` runs, the archive flow SHALL read the proposal's `stories:` frontmatter, and for each referenced story ID, mark the story as implemented in the registry traces.

#### Scenario: Archive marks stories implemented
- **WHEN** `specfuse change archive add-login` runs
- **AND** the proposal has `stories: STORY-001, STORY-003`
- **THEN** the archive flow SHALL call `registry.markStoryImplemented("STORY-001", "2026-07-08-add-login")`
- **AND** `registry.markStoryImplemented("STORY-003", "2026-07-08-add-login")`
- **AND** the registry SHALL be saved after updating traces

#### Scenario: Archive with no stories frontmatter
- **WHEN** `specfuse change archive <name>` runs
- **AND** the proposal has no `stories:` frontmatter
- **THEN** the archive SHALL proceed normally without trace updates (no error)
