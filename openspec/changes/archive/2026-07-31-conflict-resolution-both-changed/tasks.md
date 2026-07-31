## 1. Core Resolver Module

- [ ] 1.1 Create `src/core/resolver.js` — export `computeConflict(rule, driftResult)` that returns `{ ruleId, sourceContent, targetContent, patch }` using the `diff` package's `createPatch`
- [ ] 1.2 Add `applyResolution(rule, resolution, projectRoot, registry)` to `src/core/resolver.js` — handle three resolution types: `"source"` (overwrite managed section with sourceContent, recordSync), `"target"` (leave file unchanged, recordSync with target hash as both hashes), `"merge"` (write mergedContent into managed section, recordSync with merged hash)
- [ ] 1.3 Add `applyResolution` support for multi-target rules (same pattern as `executeRule` in sync-engine — iterate `resolveTargets`, apply per target file)

## 2. Drift Detector Enrichment

- [ ] 2.1 Modify `checkSingleRuleDrift()` in `src/core/drift-detector.js` — when state is `BOTH_CHANGED`, include `sourceContent` (raw file content or dir marker) and `targetContent` (current managed section content) in the returned object
- [ ] 2.2 Modify `checkMultiTargetDrift()` in `src/core/drift-detector.js` — include `sourceContent` and `targetContent` for `BOTH_CHANGED` entries in multi-target drift results
- [ ] 2.3 Update `drift --json` output in `src/commands/drift.js` to include `sourceContent` and `targetContent` fields for `BOTH_CHANGED` entries only

## 3. Sync Engine Guard

- [ ] 3.1 Modify `executeRule()` in `src/core/sync-engine.js` — before executing a rule, check drift state via registry; if `BOTH_CHANGED`, skip the rule and return a `SyncResult` with `changed: false` and message "skipped — BOTH_CHANGED conflict, run `specfuse resolve <rule-id>`"
- [ ] 3.2 Add `force` option to `runTwoPassSync()` signature — when `true`, skip the drift-state guard and overwrite `BOTH_CHANGED` pairs as before, logging a warning that `--force` was used
- [ ] 3.3 Add `resolve` option to `runTwoPassSync()` signature — when `true` and a `BOTH_CHANGED` pair is encountered, pause and invoke the interactive resolver before continuing
- [ ] 3.4 Ensure `force` takes precedence over `resolve` when both are set, with a warning logged

## 4. Resolve Command

- [ ] 4.1 Create `src/commands/resolve.js` — implement `resolveCommand(projectRoot, options)` that loads rules and registry, validates the rule ID exists and is `BOTH_CHANGED`, then enters interactive mode
- [ ] 4.2 Implement interactive prompt — display conflict diff (using chalk for colored output), present three numbered options (accept source / keep target / merge manually), read user choice via readline
- [ ] 4.3 Implement manual merge flow — write conflict markers to temp file, spawn `$EDITOR`/`$VISUAL`/`vi`, read back edited content, strip markers, pass to `applyResolution`
- [ ] 4.4 Add `--json` flag to resolve command — output `computeConflict()` result as JSON and exit without entering interactive mode
- [ ] 4.5 Handle error cases — non-existent rule ID (exit 1), non-`BOTH_CHANGED` state (exit 1), editor not available (exit 1 with helpful message)

## 5. CLI Registration

- [ ] 5.1 Register `specfuse resolve <rule-id>` command in `src/cli.js` — add `--root`, `--json` flags, wire to `resolveCommand`
- [ ] 5.2 Add `--force` flag to `specfuse sync` command in `src/cli.js`
- [ ] 5.3 Add `--resolve` flag to `specfuse sync` command in `src/cli.js`
- [ ] 5.4 Pass `force` and `resolve` options through `syncCommand` to `runTwoPassSync`

## 6. Sync Command Updates

- [ ] 6.1 Modify `src/commands/sync.js` — accept `force` and `resolve` options, pass to `runTwoPassSync`
- [ ] 6.2 Update sync summary output — when `BOTH_CHANGED` rules were skipped, list them separately with remediation instructions

## 7. Programmatic API

- [ ] 7.1 Add `resolve()` export to `src/api.mjs` — accept `{ root, ruleId, choice, mergedContent? }`, load rules/registry, compute conflict, apply resolution, save registry, return result
- [ ] 7.2 Add `force` option to existing `sync()` export in `src/api.mjs`
- [ ] 7.3 Update default export object to include `resolve`

## 8. Tests

- [ ] 8.1 Create `src/tests/resolve.test.js` — test `computeConflict()` returns correct structure for `BOTH_CHANGED` data
- [ ] 8.2 Test `applyResolution()` with `"source"` choice — verifies managed section overwritten and registry updated
- [ ] 8.3 Test `applyResolution()` with `"target"` choice — verifies file unchanged and registry updated
- [ ] 8.4 Test `applyResolution()` with `"merge"` choice — verifies merged content written and registry updated
- [ ] 8.5 Test `applyResolution()` on non-`BOTH_CHANGED` rule — verifies error thrown
- [ ] 8.6 Test drift detector enrichment — verify `BOTH_CHANGED` results include `sourceContent` and `targetContent`
- [ ] 8.7 Test sync engine guard — verify `BOTH_CHANGED` rules are skipped by default, overwritten with `force`, and resolved interactively with `resolve`
- [ ] 8.8 Test `specfuse resolve` CLI via spawn — verify exit codes and output for both conflicted and non-conflicted rules
- [ ] 8.9 Test programmatic `resolve()` API — verify all three choices work and error on non-conflicted rule
