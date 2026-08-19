# Tasks — CI Coverage & Lint Quality Gate

## 1. Coverage tooling
- [ ] 1.1 Add `c8` to `devDependencies` in `package.json`.
- [ ] 1.2 Add `test:coverage` script: `c8 --check-coverage --reporter=text --reporter=lcov node --test src/tests/*.test.js`.
- [ ] 1.3 Add `.c8rc.json` with `check-coverage` thresholds (lines/branches/functions/statements) set to just below the measured baseline.

## 2. CI workflow (`.github/workflows/ci.yml`)
- [ ] 2.1 Replace `pnpm test` step with `pnpm test:coverage`.
- [ ] 2.2 Add `pnpm lint` step (errors fail; warnings non-fatal at rollout).
- [ ] 2.3 Add `actions/upload-artifact@v4` step uploading `coverage/`.
- [ ] 2.4 Keep the existing `specfuse drift --fail` step unchanged.

## 3. Baseline measurement
- [ ] 3.1 Run `pnpm test:coverage` (no threshold) to capture current line/branch/function/statement %.
- [ ] 3.2 Set `.c8rc.json` thresholds ~2 pts below baseline (ratchet floor) to avoid flapping.
- [ ] 3.3 Verify `pnpm test:coverage` exits 0 at baseline; verify it exits non-zero when coverage is deliberately lowered (sanity check the gate).

## 4. Docs
- [ ] 4.1 `CONTRIBUTING.md`: note coverage + lint run in CI; how to run/view coverage locally (`pnpm test:coverage` → `coverage/`).
- [ ] 4.2 Note the `no-unused-vars` escalation as a documented follow-up (after clearing the 80 existing instances), not part of this change.

## 5. Verification
- [ ] 5.1 Confirm `pnpm test:coverage` passes locally and produces `coverage/lcov.info`.
- [ ] 5.2 Confirm `pnpm lint` exits 0 (0 errors; warnings reported).
- [ ] 5.3 Confirm CI workflow YAML is valid and the new steps run.
