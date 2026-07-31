# Tasks: CI Integration Mode

## Phase 1: Output Formats (P1)

- [ ] **T1:** Create `src/core/ci-output.js` with format generators
- [ ] **T2:** Implement `formatGitHub(results)` for GitHub Actions annotations
- [ ] **T3:** Implement `formatJUnit(results)` for JUnit XML
- [ ] **T4:** Implement `formatSarif(results)` for SARIF JSON
- [ ] **T5:** Add unit tests for each format (`ci-output.test.js`)

## Phase 2: CI Commands (P1)

- [ ] **T6:** Create `src/commands/ci.js` with drift/validate/check handlers
- [ ] **T7:** Register `specfuse ci` command group in `src/cli.js`
- [ ] **T8:** Implement `specfuse ci drift --format <fmt>`
- [ ] **T9:** Implement `specfuse ci validate --format <fmt>`
- [ ] **T10:** Implement `specfuse ci check` (combined drift + validate)
- [ ] **T11:** Add CLI tests (`ci.test.js`)

## Phase 3: GitHub Actions Integration (P1)

- [ ] **T12:** Create `templates/ci/github-actions.yml` workflow template
- [ ] **T13:** Implement `specfuse ci init --github` to copy template
- [ ] **T14:** Test workflow in real GitHub Actions environment

## Phase 4: API (P2)

- [ ] **T15:** Create `src/api/ci.mjs` with `check()`, `format()` functions
- [ ] **T16:** Export from `src/api.mjs`

## Phase 5: Documentation (P2)

- [ ] **T17:** Update README.md with CI command reference
- [ ] **T18:** Add CI integration guide to docs/
- [ ] **T19:** Document output formats and their use cases
