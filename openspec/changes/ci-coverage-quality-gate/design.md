# Design — CI Coverage & Lint Quality Gate

## Context

SpecFuse's CI (`ci.yml`) runs only `pnpm test` + `drift --fail`. There is no coverage instrumentation (no c8/nyc/istanbul) and no lint step in CI. Consequence: large modules are untested with no visibility (`sync-engine.js`, `linter.js`, `config-manager.js`, `traceability.js`, `artifact-diagnostics.js`, `init.js`, `sync.js`, `status.js`), and 204 lint warnings accumulate unchecked. Coverage gaps and lint regressions both pass CI silently.

## Decision

**Add `c8` coverage with a baseline-ratcheted threshold, a CI lint step (errors-only at rollout), and a coverage artifact upload.**

### Coverage tool: c8

`c8` is chosen over `nyc`/`istanbul` because:
- It instruments V8 directly (no Babel/source-map overhead for SpecFuse's plain ESM).
- It works with `node --test` out of the box — no runner adapter needed.
- Zero config to start; threshold via `--check-coverage` and `.c8rc.json`.

Script: `"test:coverage": "c8 --check-coverage --reporter=text --reporter=lcov node --test src/tests/*.test.js"`.

### Baseline threshold (ratchet)

- Run `pnpm test:coverage` once with no threshold to capture the current line/branch/function/statement percentages.
- Set `.c8rc.json` thresholds to **just below** the current baseline (e.g. baseline lines 62% → threshold 60%) — close enough to catch regressions, loose enough to not flap on minor variance as tests are added/removed.
- The threshold is a **floor**, not a target. As coverage improves (other changes add tests), the floor can be raised in follow-ups. The intent is "never let coverage drop," not "block on day one."

This is the standard ratchet pattern: the gate only fails on *regressions*, so it can ship immediately without first writing all the missing tests.

### CI lint step

- Add `pnpm lint` as a CI step. ESLint config (`eslint.config.js`) currently treats the 204 findings as **warnings** (0 errors), so `pnpm lint` exits 0 today — the gate passes at rollout.
- Errors fail the build; warnings are reported but non-fatal at rollout.
- Follow-up (documented, not in this change): escalate `no-unused-vars` to `"error"` after clearing the existing 80 instances (some are genuine dead code in `bundle.js`, `batch.js`, `clean.js`, `import.js`). Escalating now would block CI on day one; the ratchet clears them first.

### CI workflow changes (`ci.yml`)

```
- name: Run tests with coverage
  run: pnpm test:coverage

- name: Lint
  run: pnpm lint

- name: Upload coverage
  uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: coverage/
```

`pnpm test` is replaced by `pnpm test:coverage` (coverage is a superset of running the tests). The `drift --fail` step is unchanged.

## Trade-offs

- **c8 vs. nyc**: c8 is lighter and Node-native; nyc would add Babel transpilation overhead SpecFuse doesn't need. c8 is the right pick for a plain-ESM Node >=20 project.
- **Errors-only lint at rollout**: Failing on the existing 204 warnings on day one would block every PR. Errors-only + a documented ratchet to escalate `no-unused-vars` later is the pragmatic path. The gate still catches *new* lint errors immediately.
- **Coverage floor vs. target**: A floor (baseline ratchet) ships now and prevents regressions; a target would require writing the missing tests first. They are complementary — this change adds the floor; the other 4 improvements in this proposal (and future work) raise coverage as a side effect of adding tests.
- **No source changes**: This is purely tooling + CI config, so it carries near-zero runtime risk. It is the safest of the five improvements and foundational — the coverage report will *measure* the gaps the other improvements address.

## Non-goals

- Does not write the missing tests for `sync-engine.js`, `linter.js`, etc. — it only *surfaces* that they're missing so future work can target them. (Coverage visibility is the deliverable; closing the gaps is separate.)
- Does not escalate `no-unused-vars` to error (documented follow-up after the existing instances are cleared).
- Does not add a coverage badge to the README (optional follow-up).
- Does not change the test runner (`node --test`) or add a coverage-PR-comment bot.

## Test strategy

- The "test" of this change is the CI workflow itself: assert (in a dry-run or on the first PR) that `pnpm test:coverage` runs, produces `coverage/lcov.info`, exits 0 at baseline, and exits non-zero when coverage is deliberately lowered.
- Assert `pnpm lint` exits 0 on current code (0 errors).
- Local: `pnpm test:coverage` prints a per-file table and writes the lcov report.
