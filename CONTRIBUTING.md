# Contributing to SpecFuse

Thank you for contributing to SpecFuse! This guide covers the branching strategy, PR process, commit conventions, and development setup.

## Branching strategy

SpecFuse uses a **simplified GitFlow** model. See [docs/branching-strategy.md](docs/branching-strategy.md) for the full document.

Quick summary:

- **All changes go through pull requests** — no direct commits to `main`
- **Branch prefixes**: `feature/`, `fix/`, `release/`, `hotfix/`, `docs/`
- **Squash merge** for feature and fix branches; **merge commit** for release branches
- **`main` is protected** — requires 1 review and passing CI before merge

## How to submit a pull request

1. **Fork** the repository (or work on a branch if you have write access)
2. **Create a branch** with the appropriate prefix:
   ```bash
   git checkout main
   git pull
   git checkout -b feature/your-change-name
   ```
3. **Make your changes** and commit with a descriptive message
4. **Run tests and checks** locally:
   ```bash
   pnpm test:coverage
   pnpm lint
   node bin/specfuse.js drift --fail
   ```
5. **Push** your branch and open a pull request against `main`
6. **Wait for review** — at least 1 approval is required
7. **Address review feedback** — push additional commits to the same branch
8. Once approved and CI passes, the PR will be **squash-merged** into `main`

## PR requirements

- **1 approving review** required before merge
- **CI must pass**: tests with coverage, lint, and spec drift check
- **Branch must be up to date** with `main` before merging
- **Describe the change** clearly in the PR body — what, why, and how

## Commit message style

SpecFuse uses **Conventional Commits** prefixes:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat:` | New feature | `feat: add shopping cart change workflow` |
| `fix:` | Bug fix | `fix: correct drift hash comparison` |
| `docs:` | Documentation | `docs: update branching strategy` |
| `test:` | Test additions or updates | `test: add unit tests for differ` |
| `chore:` | Build, tooling, or maintenance | `chore: update eslint config` |
| `refactor:` | Code restructuring without behavior change | `refactor: simplify sync engine pass ordering` |

Follow the existing commit history style — see `git log --oneline` for examples.

## Testing requirements

Before submitting a PR:

```bash
# Run the test suite with coverage
pnpm test:coverage

# Lint your code
pnpm lint

# Check for spec drift (must pass with --fail)
node bin/specfuse.js drift --fail
```

All three must pass. CI runs these same checks, but catching issues locally is faster.

## Coverage gate

CI runs the test suite under `c8` coverage and fails the build if coverage drops below the configured threshold (lines / branches / functions / statements). The threshold is a **ratchet floor** set just below the current baseline, so existing code passes and only regressions fail — it is a floor, not a target.

To check coverage locally:

```bash
pnpm test:coverage
```

This prints a per-file coverage table to the terminal and writes an lcov report to `coverage/`. Open `coverage/lcov.info` in an HTML viewer (for example `npx lcov-viewer` or your IDE's coverage extension) to see uncovered lines.

When your change adds tests, coverage rises and the floor can be raised in a follow-up. If a PR lowers coverage below the floor, CI fails — add tests covering the regressed code rather than lowering the threshold.

## Lint gate

CI runs `pnpm lint` (ESLint on `src/`) and fails the build on lint **errors**. Lint warnings remain non-fatal at rollout.

> **Follow-up (not part of the initial gate):** `no-unused-vars` is currently a warning across ~80 instances (some genuine dead code). Escalating it to `"error"` now would block every PR, so it stays a warning until those instances are cleared. Once cleared, the rule will be escalated to error and the lint gate will enforce it. See the `ci-coverage-quality-gate` change proposal for context.

## Managed sections

SpecFuse manages content inside HTML comment markers:

```html
<!-- specfuse:section-name:start -->
...
<!-- specfuse:section-name:end -->
```

**Do not edit inside these markers directly.** Content inside managed markers is overwritten by `specfuse sync`. Place your custom content outside the markers.

If you accidentally edit a managed section, `specfuse drift` will detect the change and report `TARGET_CHANGED` or `BOTH_CHANGED`.

## Development setup

```bash
pnpm install
pnpm test:coverage
node bin/specfuse.js --help
```

Requirements:

- **Node.js** >= 20
- **pnpm** recommended

## Questions?

- Use `specfuse guide --persona new-user` for onboarding guidance
- Check [docs/architecture.md](docs/architecture.md) for system design details
- Check [docs/branching-strategy.md](docs/branching-strategy.md) for the full branching model
