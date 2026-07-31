# Spec: Sync Engine



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Sync skips BOTH_CHANGED pairs by default
When `specfuse sync` encounters a rule pair in `BOTH_CHANGED` drift state, the sync engine SHALL skip that rule (log a warning, do not overwrite) and continue processing remaining rules.

#### Scenario: Sync encounters BOTH_CHANGED pair
- **WHEN** `specfuse sync` is run and at least one rule has `BOTH_CHANGED` drift state
- **THEN** the engine SHALL log a warning identifying the conflicted rule, skip executing that rule, continue with other rules, and the `SyncResult` for the skipped rule SHALL have `changed: false` and `message` indicating "skipped — BOTH_CHANGED conflict, run `specfuse resolve <rule-id>`"

#### Scenario: Sync with no BOTH_CHANGED pairs
- **WHEN** `specfuse sync` is run and no rules have `BOTH_CHANGED` drift state
- **THEN** sync SHALL proceed as before with no behavioral change

### Requirement: Sync --force flag overwrites BOTH_CHANGED pairs
The `specfuse sync` command SHALL accept a `--force` flag that restores the pre-change behavior of overwriting managed sections for `BOTH_CHANGED` pairs without prompting.

#### Scenario: Sync with --force encounters BOTH_CHANGED pair
- **WHEN** user runs `specfuse sync --force` and a rule has `BOTH_CHANGED` drift state
- **THEN** the engine SHALL overwrite the managed section with the source-extracted content (the old behavior), log a warning that `--force` was used, and record the sync in the registry

#### Scenario: Sync --force with no BOTH_CHANGED pairs
- **WHEN** user runs `specfuse sync --force` and no rules have `BOTH_CHANGED` state
- **THEN** sync SHALL proceed identically to `specfuse sync` without `--force`

### Requirement: Sync --resolve flag runs interactive resolver
The `specfuse sync` command SHALL accept a `--resolve` flag that, when a `BOTH_CHANGED` pair is encountered, pauses to run the interactive conflict resolver before continuing sync.

#### Scenario: Sync --resolve encounters BOTH_CHANGED pair
- **WHEN** user runs `specfuse sync --resolve` and a rule has `BOTH_CHANGED` drift state
- **THEN** the engine SHALL pause, present the interactive resolve prompt for that rule, apply the user's resolution choice, then continue with the remaining rules

#### Scenario: Sync --resolve with no BOTH_CHANGED pairs
- **WHEN** user runs `specfuse sync --resolve` and no rules have `BOTH_CHANGED` state
- **THEN** sync SHALL proceed identically to `specfuse sync` without `--resolve`

#### Scenario: Sync --resolve with --force
- **WHEN** user runs `specfuse sync --resolve --force`
- **THEN** `--force` SHALL take precedence and `--resolve` SHALL be ignored, with a warning logged that both flags were specified

### Requirement: Programmatic sync API supports force option
The `sync()` function in `src/api.mjs` SHALL accept a `force` option that, when `true`, skips the `BOTH_CHANGED` guard and overwrites as in the old behavior.

#### Scenario: Programmatic sync with force=true
- **WHEN** `sync({ root, force: true })` is called and a rule is `BOTH_CHANGED`
- **THEN** the engine SHALL overwrite the managed section without skipping, matching `--force` CLI behavior

#### Scenario: Programmatic sync with force=false or omitted
- **WHEN** `sync({ root })` or `sync({ root, force: false })` is called and a rule is `BOTH_CHANGED`
- **THEN** the engine SHALL skip the rule, matching the default CLI behavior

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
