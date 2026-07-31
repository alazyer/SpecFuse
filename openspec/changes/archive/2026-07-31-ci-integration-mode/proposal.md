---
status: active
created: 2026-07-28
---

# Change Proposal: CI Integration Mode

## Overview

Add dedicated CI integration commands and output formats that make SpecFuse easy to use in GitHub Actions, GitLab CI, and other CI systems. This includes GitHub Actions workflow generation, JUnit XML output, and SARIF support.

## Problem

1. **Manual setup** — Users must manually configure CI to run drift checks and validation
2. **No structured output** — CI systems expect specific formats (JUnit, SARIF) for test results and issues
3. **No workflow templates** — No easy way to add SpecFuse to a project's CI pipeline
4. **No annotations** — Cannot surface issues directly in PRs via GitHub annotations

## Scope

**In scope:**
- `specfuse ci drift` — Run drift check with CI-optimized output
- `specfuse ci validate` — Run validation with CI-optimized output
- `specfuse ci check` — Combined drift + validation
- `--format junit` — JUnit XML output for test runners
- `--format sarif` — SARIF output for GitHub code scanning
- `--format github` — GitHub Actions annotations format
- `specfuse ci init` — Generate GitHub Actions workflow file

**Out of scope:**
- GitLab CI, CircleCI, Jenkins templates (future)
- CI dashboard or metrics
- PR comment generation (future)

## Acceptance Criteria

- [ ] `specfuse ci drift --format github` outputs GitHub Actions `::error::` annotations for each drift issue
- [ ] `specfuse ci validate --format junit` outputs valid JUnit XML with test cases for each validation check
- [ ] `specfuse ci validate --format sarif` outputs valid SARIF JSON for GitHub code scanning
- [ ] `specfuse ci check` runs both drift and validation, exits 1 on any issues
- [ ] `specfuse ci init --github` creates `.github/workflows/specfuse.yml` with drift check on PR
- [ ] GitHub Actions workflow includes: PR drift check, main branch sync, weekly validation
- [ ] All CI commands support `--format` flag
- [ ] Exit codes follow CI conventions (0 = pass, 1 = fail)

## Impact

- **CI/CD:** One-command setup for SpecFuse in GitHub Actions
- **PRs:** Drift and validation issues appear as PR annotations
- **Quality Gates:** Can block PRs on spec drift

## Risks

- GitHub-specific output may not translate to other CI systems
- SARIF format is complex and may have version changes
- Need to handle large result sets efficiently

## Related

- New command file: `src/commands/ci.js`
- New core module: `src/core/ci-output.js`
- New templates: `templates/ci/github-actions.yml`
- New test file: `src/tests/ci.test.js`
