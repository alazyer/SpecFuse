## MODIFIED Requirements

### Requirement: Sync is idempotent — no-op when content is unchanged
`executeRule` SHALL compare the proposed transformed managed-section content to the existing on-disk managed-section content and, when they are equal, SHALL NOT write the target file, SHALL NOT report `changed: true`, and SHALL record a structured `unchanged` outcome for that rule.

#### Scenario: Sync re-run with unchanged sources
- **WHEN** `specfuse sync` is run a second time and no source artifact has changed since the prior successful sync
- **THEN** no target file SHALL be written
- **AND** every rule SHALL be reported as `unchanged` (not `changed`)
- **AND** the sync result SHALL report zero changed rules

#### Scenario: Sync after a source change
- **WHEN** a source artifact is modified and `specfuse sync` runs
- **THEN** the affected rule's target SHALL be written and reported as `changed`
- **AND** rules whose source is unchanged SHALL be reported as `unchanged`

#### Scenario: Sync re-run across days with unchanged sources
- **WHEN** `specfuse sync` is run on day 2 after a day-1 sync, and the source artifacts are byte-identical
- **THEN** no target file SHALL be written
- **AND** the sync SHALL be a no-op (no spurious diff, no `changed` result) — the date changing SHALL NOT cause a content change

### Requirement: Rule transforms are deterministic
A rule's `transform()` output SHALL be a pure function of its source content: identical source content SHALL produce identical transformed output across runs and across days. Volatile metadata (e.g. the current date) SHALL NOT be embedded in the diffed managed-section content; the last-synced timestamp is recorded in the registry under `syncs[].syncedAt` instead.

#### Scenario: Built-in rule output is stable across days
- **WHEN** the `plan-to-constitution` rule runs on day 1 and again on day 2 with identical source architecture.md content
- **THEN** the transformed managed-section content SHALL be byte-identical across both runs
- **AND** the day-2 run SHALL be a no-op (no write, `unchanged`)

#### Scenario: Custom rule embedding today() is flagged
- **WHEN** a custom rule's `transform()` embeds volatile context (e.g. `ctx.today()`) in the diffed content
- **THEN** the engine SHALL emit a warning in `--json`/verbose output that the rule is non-deterministic and may produce spurious diffs
- **AND** the rule-authoring documentation SHALL recommend keeping volatile metadata out of diffed content

### Requirement: Sync results expose an unchanged outcome distinctly
The sync result returned by the CLI and the programmatic API SHALL distinguish `unchanged` from `changed`, `skipped`, `forced`, and `failed` as a structured per-rule state, in both human and `--json` output, and in CI output (SARIF/GitHub annotations).

#### Scenario: JSON output reports unchanged rules
- **WHEN** `specfuse sync --json` runs and some rules are no-ops
- **THEN** each no-op rule SHALL carry an `unchanged` state in the JSON result
- **AND** a run with zero `changed` rules SHALL be distinguishable from a run that changed files

#### Scenario: CI does not fail on a clean no-op sync
- **WHEN** CI runs `specfuse sync` followed by `specfuse drift --fail` on an unchanged project
- **THEN** drift SHALL report `IN_SYNC` and exit 0, with no spurious `SOURCE_CHANGED`/`TARGET_CHANGED` from timestamp churn
