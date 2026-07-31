# Spec: Registry



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Registry stores trace links
The `Registry` class SHALL support a `traces` key in `registry.json` that maps story IDs to their trace records. The `traces` key SHALL be optional — absent key is treated as empty traces.

#### Scenario: Reading traces from registry
- **WHEN** registry is loaded and `traces` key is absent
- **THEN** `getTraces()` SHALL return an empty object `{}`

#### Scenario: Recording a trace link
- **WHEN** `recordTrace(changeName, storyIds)` is called with changeName="add-login" and storyIds=["STORY-001"]
- **THEN** the traces key SHALL contain `{ "STORY-001": { active: ["add-login"], implemented: false } }`

#### Scenario: Marking a story as implemented
- **WHEN** `markStoryImplemented(storyId, archiveName)` is called with storyId="STORY-001" and archiveName="2026-07-08-add-login"
- **THEN** the trace record for STORY-001 SHALL have `implemented: true` and `implementedBy: "2026-07-08-add-login"`
- **AND** the change SHALL be removed from the `active` array

#### Scenario: Removing trace links for a change
- **WHEN** `removeTraceLinks(changeName)` is called
- **THEN** the changeName SHALL be removed from all story trace records' `active` arrays
- **AND** story records with empty `active` arrays and `implemented: false` SHALL be cleaned up
