## ADDED Requirements

### Requirement: Resolve command shows conflict diff
The `specfuse resolve <rule-id>` command SHALL display a diff comparing the source-extracted content against the current managed-section content for the specified `BOTH_CHANGED` rule.

#### Scenario: Resolve invoked on a BOTH_CHANGED rule
- **WHEN** user runs `specfuse resolve plan:arch→constitution:plan-decisions` and that rule is in `BOTH_CHANGED` state
- **THEN** the command SHALL print a unified diff showing source-extracted content (labeled "source") vs. current managed-section content (labeled "target"), followed by a prompt presenting three options: (a) accept source, (b) keep target, (c) merge manually

#### Scenario: Resolve invoked on a non-BOTH_CHANGED rule
- **WHEN** user runs `specfuse resolve <rule-id>` and that rule is in `IN_SYNC`, `SOURCE_CHANGED`, `TARGET_CHANGED`, or `NEVER_SYNCED` state
- **THEN** the command SHALL print an error message stating the rule is not in a conflicted state and exit with code 1

#### Scenario: Resolve invoked on a non-existent rule
- **WHEN** user runs `specfuse resolve <rule-id>` and no loaded rule matches the given ID
- **THEN** the command SHALL print an error message listing available rule IDs and exit with code 1

### Requirement: Resolve accept source option
When the user selects "accept source" during `specfuse resolve`, the system SHALL overwrite the managed section with the source-extracted content and update the registry so the pair returns to `IN_SYNC`.

#### Scenario: User accepts source content
- **WHEN** user runs `specfuse resolve <rule-id>` and selects option (a) "accept source"
- **THEN** the managed section in the target file SHALL be replaced with the source-extracted content, the registry SHALL record a new sync with updated hashes, and the command SHALL exit with code 0

### Requirement: Resolve keep target option
When the user selects "keep target" during `specfuse resolve`, the system SHALL preserve the current managed-section content and update the registry so the pair returns to `IN_SYNC`.

#### Scenario: User keeps target content
- **WHEN** user runs `specfuse resolve <rule-id>` and selects option (b) "keep target"
- **THEN** the managed section SHALL remain unchanged, the registry SHALL record a new sync with the current target hash as both source and target hash, and the command SHALL exit with code 0

### Requirement: Resolve merge manually option
When the user selects "merge manually" during `specfuse resolve`, the system SHALL open `$EDITOR` (or `$VISUAL`, falling back to `vi`) on a temporary file containing both versions with conflict markers, and SHALL write the edited result back to the managed section upon editor exit.

#### Scenario: User merges manually and saves
- **WHEN** user runs `specfuse resolve <rule-id>` and selects option (c) "merge manually"
- **THEN** a temporary file SHALL be created containing `<<<<<<< SOURCE\n<source-content>\n=======\n<target-content>\n>>>>>>> TARGET` markers, the editor SHALL be spawned on that file, and after the editor exits, the cleaned content (with conflict markers removed) SHALL be written to the managed section and the registry SHALL record a new sync

#### Scenario: User merges manually but editor exits with error
- **WHEN** the editor process exits with a non-zero code
- **THEN** the resolve command SHALL print a warning that the merge was aborted, no changes SHALL be written to the target file, and the command SHALL exit with code 1

#### Scenario: No editor available in environment
- **WHEN** `$EDITOR` and `$VISUAL` are both unset and `vi` is not found on `$PATH`
- **THEN** the resolve command SHALL print an error stating no editor is available and suggest using the `--json` output or programmatic API instead, and exit with code 1

### Requirement: Machine-readable conflict data in drift output
`specfuse drift --json` SHALL include `sourceContent` and `targetContent` fields for every `BOTH_CHANGED` entry in the results array.

#### Scenario: Drift JSON with BOTH_CHANGED entry
- **WHEN** user runs `specfuse drift --json` and at least one rule is in `BOTH_CHANGED` state
- **THEN** each `BOTH_CHANGED` result object SHALL include a `sourceContent` field (the re-extracted content from the source artifact) and a `targetContent` field (the current content inside the managed section markers)

#### Scenario: Drift JSON with no BOTH_CHANGED entries
- **WHEN** user runs `specfuse drift --json` and no rules are in `BOTH_CHANGED` state
- **THEN** result objects SHALL NOT include `sourceContent` or `targetContent` fields

### Requirement: Resolver core module
The `src/core/resolver.js` module SHALL export two pure functions: `computeConflict(rule, driftResult)` and `applyResolution(rule, resolution, projectRoot, registry)`.

#### Scenario: computeConflict returns conflict data
- **WHEN** `computeConflict` is called with a rule and a `BOTH_CHANGED` drift result
- **THEN** it SHALL return an object with `ruleId`, `sourceContent`, `targetContent`, and `patch` (unified diff string) fields

#### Scenario: applyResolution writes accept-source
- **WHEN** `applyResolution` is called with resolution type `"source"`
- **THEN** it SHALL write the source content into the managed section, call `registry.recordSync` with the source hash as both source and target hash, and return a success result

#### Scenario: applyResolution writes accept-target
- **WHEN** `applyResolution` is called with resolution type `"target"`
- **THEN** it SHALL leave the target file unchanged, call `registry.recordSync` with the current target hash as the source hash (so drift sees them as aligned), and return a success result

#### Scenario: applyResolution writes merged content
- **WHEN** `applyResolution` is called with resolution type `"merge"` and a `mergedContent` string
- **THEN** it SHALL write `mergedContent` into the managed section, call `registry.recordSync` with a hash of the merged content as both source and target hash, and return a success result

### Requirement: Programmatic resolve API
The `src/api.mjs` module SHALL export a `resolve` function for programmatic conflict resolution.

#### Scenario: Programmatic resolve with source choice
- **WHEN** `resolve({ root, ruleId, choice: 'source' })` is called
- **THEN** it SHALL load the rule and drift state, compute the conflict, apply the source resolution, save the registry, and return the result

#### Scenario: Programmatic resolve with target choice
- **WHEN** `resolve({ root, ruleId, choice: 'target' })` is called
- **THEN** it SHALL load the rule and drift state, compute the conflict, apply the target resolution, save the registry, and return the result

#### Scenario: Programmatic resolve with merge content
- **WHEN** `resolve({ root, ruleId, choice: 'merge', mergedContent: '...' })` is called
- **THEN** it SHALL load the rule and drift state, apply the merged content resolution, save the registry, and return the result

#### Scenario: Programmatic resolve on non-conflicted rule
- **WHEN** `resolve({ root, ruleId, choice: 'source' })` is called on a rule not in `BOTH_CHANGED` state
- **THEN** it SHALL throw an error indicating the rule is not in a conflicted state

### Requirement: Resolve command JSON output
The `specfuse resolve` command SHALL accept a `--json` flag that outputs conflict data in machine-readable JSON format without entering interactive mode.

#### Scenario: Resolve with --json flag
- **WHEN** user runs `specfuse resolve <rule-id> --json` on a `BOTH_CHANGED` rule
- **THEN** the command SHALL output a JSON object with `ruleId`, `sourceContent`, `targetContent`, and `patch` fields, and exit with code 0

#### Scenario: Resolve --json on non-conflicted rule
- **WHEN** user runs `specfuse resolve <rule-id> --json` on a rule not in `BOTH_CHANGED` state
- **THEN** the command SHALL output a JSON object with `error` field and exit with code 1
