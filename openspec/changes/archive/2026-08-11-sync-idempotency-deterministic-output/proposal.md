## Why

Running `specfuse sync` twice in a row is not a no-op: `executeRule` unconditionally writes the target file and reports `changed: true` whenever a rule runs, without comparing the new managed-section content to what is already on disk (sync-engine.js:204-212). Worse, several built-in rules embed `ctx.today()` into their `transform()` output — e.g. `plan-to-constitution.rule.mjs:46` writes `> Auto-synced from .specfuse/plan/architecture.md by SpecFuse on ${ctx.today()}`. Because the date stamp changes daily, a sync run on two consecutive days produces a diff and rewrites the constitution even when the source artifacts are byte-identical.

The consequences are severe for trust in the tool's output:

- **CI noise**: every `specfuse sync` in CI or `specfuse drift --fail` rewrites managed sections and reports drift that is purely timestamp noise, eroding confidence in drift detection.
- **Watch thrash**: `specfuse watch` re-syncs on every file change; without idempotency it rewrites files that did not meaningfully change, generating spurious git diffs.
- **False "changed" results**: the sync result's `changed: true` cannot be trusted to mean "content actually changed", so automation cannot distinguish real work from no-ops.
- **Non-deterministic transforms**: any rule output depending on `ctx.today()` (or other volatile context) is non-reproducible, which also complicates the recovery/replay logic from the `sync-atomicity-and-recovery` change.

The fix is to (a) detect true no-ops by comparing transformed content to existing on-disk content before writing, and (b) make rule transforms deterministic by moving volatile metadata (the synced-on date) out of the content that is diffed, or stamping it in a way that does not produce a content change when nothing else changed.

## What Changes

- Define an idempotency contract: a sync that produces no content change SHALL not write target files and SHALL report `changed: false`.
- Require `executeRule` to compare the proposed transformed content to the existing managed-section content and skip the write (and report `unchanged`) when they are equal.
- Define a determinism contract: rule `transform()` output SHALL be deterministic with respect to the source content, so that identical inputs produce identical outputs across runs and across days.
- Remove or relocate the `ctx.today()` date stamp from the diffed content of built-in rules so a re-sync on a later day with unchanged sources is a true no-op (the last-synced timestamp is already recorded in the registry under `syncedAt`).
- Expose `unchanged` as a distinct, structured rule outcome in sync results and `--json`, alongside the existing `changed`/`skipped`/`forced`/`failed` states.

## Capabilities

### New Capabilities

- `sync-idempotency`: Ensures a sync that produces no content change is a true no-op — no target write, no spurious drift, and a structured `unchanged` outcome.

### Modified Capabilities

- `sync-engine`: Strengthens `executeRule` to compare-before-write and to report `unchanged` outcomes distinctly from `changed`.
- `rule-context`: Strengthens the rule authoring contract so `transform()` output is deterministic; volatile metadata is not embedded in diffed content.

## Impact

- **Core modules**: `src/core/sync-engine.js` (compare-before-write, `unchanged` outcome), `src/core/rule-context.js` (determinism guidance / `today()` usage).
- **Rules**: `rules/plan-to-constitution.rule.mjs`, `rules/changes-and-stories.rule.mjs` — relocate the `ctx.today()` stamp out of the diffed managed-section content (the synced timestamp already lives in `registry.json` `syncs[].syncedAt`).
- **CLI/API**: `src/commands/sync.js`, `src/api/sync-ops.mjs`, `src/core/ci-output.js` — surface `unchanged` in human and `--json`/SARIF output.
- **Tests**: idempotency and determinism scenarios.
- **Dependencies**: None.
- **Breaking behavior**: None intended for users. Rule authors whose custom rules embed `ctx.today()` in diffed content SHOULD update them to be deterministic; this is documented as a rule-authoring guideline, not enforced as a breaking change.
