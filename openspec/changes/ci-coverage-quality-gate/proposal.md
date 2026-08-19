## Why

SpecFuse's CI (`.github/workflows/ci.yml`) runs only two steps: `pnpm test` and `specfuse drift --fail`. Two foundational quality gates are missing:

1. **No code coverage instrumentation.** `package.json` devDependencies contains only `eslint` and `prettier` — no `c8`, `nyc`, or `istanbul`, and no coverage config files exist. The team therefore has **no metric** for which `src/core` and `src/commands` modules are exercised by the 758 tests. The audit that produced this proposal found entire large modules with no dedicated test coverage: `src/core/sync-engine.js` (30 KB, only indirectly tested), `src/core/linter.js` (18 KB), `src/core/config-manager.js` (10 KB), `src/core/traceability.js`, `src/core/artifact-diagnostics.js` (zero test references), and the command modules `init.js`, `sync.js`, `status.js` (no direct test references). Without coverage data, these gaps are invisible — regressions there slip through silently.

2. **Lint is not enforced in CI.** `pnpm lint` is defined as a script but is never run in CI. The codebase has accumulated lint warnings (including `no-unused-vars` across 10+ files, some indicating genuinely dead code in `bundle.js`, `batch.js`, `clean.js`, `import.js`). Because CI does not run lint, these regressions pass silently. The 204 accumulated warnings (124 `require-await`, 80 `no-unused-vars`) will keep growing without a gate.

Together, these gaps mean CI gives a green light to commits that reduce coverage or introduce lint regressions — the opposite of what a quality gate should do. This change adds coverage instrumentation, a coverage threshold (set at the current baseline, ratcheted upward), and a CI lint gate.

## What Changes

- Add `c8` (the Node-native coverage tool that works with `node --test` out of the box) as a devDependency.
- Add a `test:coverage` script (`c8 --reporter=text --reporter=lcov node --test src/tests/*.test.js`) and a coverage config (`.c8rc.json`) with a `check-coverage` threshold set to the **current baseline** (so the gate fails only on regressions, not on day one) — the exact baseline is computed in implementation and the threshold is set just below it to avoid flapping on minor variance.
- Add a CI step that runs `pnpm test:coverage` (replacing or augmenting the bare `pnpm test` step) and uploads the `lcov` report as a CI artifact for visibility.
- Add a CI step `pnpm lint` that runs ESLint and fails the build on **errors** (today there are 0 errors); warnings remain non-fatal initially, with a ratcheted `no-unused-vars` escalation documented as a follow-up so the gate does not block on the existing 204 warnings.
- Document the quality gate in `CONTRIBUTING.md` (coverage + lint run in CI; how to view coverage locally).

## Capabilities

### New Capabilities

- `ci-quality-gate`: Adds code coverage instrumentation and a coverage threshold plus a lint CI step, so CI fails on coverage regressions and lint errors.

### Modified Capabilities

- `github-actions`: The CI workflow gains `test:coverage` and `lint` steps and uploads the coverage artifact.

## Impact

- **Tooling**: `package.json` — add `c8` devDependency, add `test:coverage` script; new `.c8rc.json`.
- **CI**: `.github/workflows/ci.yml` — replace `pnpm test` with `pnpm test:coverage` (or add a coverage step), add `pnpm lint` step, add coverage artifact upload.
- **Docs**: `CONTRIBUTING.md` — note the coverage + lint gates and how to run coverage locally (`pnpm test:coverage` opens an HTML/text report).
- **No source-code changes**: this change adds tooling and CI configuration only; it does not alter SpecFuse's runtime behavior.
- **Tests**: none added or removed (the 758 existing tests are the coverage input).
- **Dependencies**: `c8` (devDependency, no runtime impact).
- **Breaking behavior**: None for users. Contributors whose commits lower coverage below the threshold or introduce a lint error will see CI fail — which is the intended gate. The threshold is set at the current baseline so existing code passes; only regressions fail.
