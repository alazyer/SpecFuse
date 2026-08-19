## 1. Compare-before-write idempotency

- [ ] 1.1 In `executeRule` (`src/core/sync-engine.js`), after `transform`, read the existing managed-section content from the target and compare to the proposed content.
- [ ] 1.2 When equal, skip `writeFileAtomic`, leave registry hashes unchanged, and return an `unchanged` structured outcome; when different, write and return `changed`.
- [ ] 1.3 Ensure the registry's `recordSync` is not called (or is a no-op) for `unchanged` rules so `syncedAt` is not bumped on a no-op.

## 2. Deterministic built-in transforms

- [ ] 2.1 Remove the `> Auto-synced ... on ${ctx.today()}` (and equivalent) date stamps from `transform()` output in `rules/plan-to-constitution.rule.mjs` and `rules/changes-and-stories.rule.mjs`.
- [ ] 2.2 Confirm the authoritative synced timestamp is `registry.json` `syncs[].syncedAt`; surface "last synced" in `specfuse status`/`doctor` from the registry, not from in-content stamps.
- [ ] 2.3 Note the one-time managed-section rewrite (stamp removed) in the CHANGELOG entry.

## 3. Structured `unchanged` outcome

- [ ] 3.1 Add `unchanged` to the per-rule outcome enum alongside `changed`/`skipped`/`forced`/`failed`.
- [ ] 3.2 Surface `unchanged` in human sync output, `--json` sync output, and CI output (`src/core/ci-output.js` SARIF/GitHub annotations).
- [ ] 3.3 Add a non-determinism heuristic warning (in `--json`/verbose) when a rule's output changes between two runs with identical source hashes.

## 4. Rule-authoring guidance

- [ ] 4.1 Document the determinism contract and the `unchanged` outcome in the rule-authoring section of `docs/architecture.md` (and the future rule-authoring guide).
- [ ] 4.2 Update `.specfuse/rules.mjs` example stub and any rule-authoring examples to avoid embedding `ctx.today()` in diffed content.

## 5. Tests

- [ ] 5.1 Test: re-running `specfuse sync` with unchanged sources writes no files and reports `unchanged` for all rules.
- [ ] 5.2 Test: sync on day 2 with identical day-1 sources is a no-op (date does not cause a change).
- [ ] 5.3 Test: a source change produces `changed` for the affected rule and `unchanged` for the rest.
- [ ] 5.4 Test: `--json` output carries an `unchanged` state per rule and distinguishes zero-change runs from change runs.
- [ ] 5.5 Test: `specfuse drift --fail` after a clean no-op sync exits 0 with `IN_SYNC`.

## 6. Verify

- [ ] 6.1 Run `pnpm test`; confirm new idempotency tests pass and no regressions.
- [ ] 6.2 Confirm `specfuse sync` run twice produces no git diff on managed sections.
- [ ] 6.3 Confirm CI (`specfuse drift --fail`) does not fail on timestamp churn.
