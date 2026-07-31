# SpecFuse CI Integration

SpecFuse provides dedicated CI commands and output formats that make it easy to integrate spec drift checking and validation into GitHub Actions, GitLab CI, and other continuous integration systems.

## Quick Start

### 1. Generate a GitHub Actions workflow

```bash
specfuse ci init --github
```

This creates `.github/workflows/specfuse-ci.yml` with a pre-configured SpecFuse CI job.

### 2. Run CI checks locally

```bash
# Drift check only
specfuse ci drift --format junit

# Validation only
specfuse ci validate --format junit

# Combined drift + validation
specfuse ci check --format junit
```

## Commands

### `specfuse ci drift`

Run drift check with CI-optimized output. Exits with code 1 on conflicts (BOTH_CHANGED).

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Output format: `github`, `junit`, `sarif`, `auto` | `auto` |
| `--allow-plugins` | Allow user plugin rules | `false` |

### `specfuse ci validate`

Run validation with CI-optimized output. Exits with code 1 on failures.

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Output format: `github`, `junit`, `sarif`, `auto` | `auto` |
| `--artifact <type>` | Validate one type: `prd`, `arch`, `design-system`, `proposal`, `story`, `all` | `all` |

### `specfuse ci check`

Combined drift + validation check. Exits with code 1 on any FAIL-state (BOTH_CHANGED or validation FAIL).

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Output format: `github`, `junit`, `sarif`, `auto` | `auto` |
| `--artifact <type>` | Validate one type (same as validate) | `all` |
| `--allow-plugins` | Allow user plugin rules | `false` |

### `specfuse ci init`

Generate a GitHub Actions workflow file for SpecFuse CI.

| Option | Description | Default |
|--------|-------------|---------|
| `--github` | Generate GitHub Actions workflow | `true` |
| `--output <path>` | Output file path | `.github/workflows/specfuse-ci.yml` |
| `--force` | Overwrite existing file | `false` |

## Output Formats

### `github` — GitHub Actions Annotations

Produces `::error`, `::warning`, and `::notice` workflow commands that appear as inline annotations on PRs. Wrapped in `::group`/`::endgroup` for collapsible output.

```bash
specfuse ci check --format github
```

**Auto-detected** when the `GITHUB_ACTIONS` environment variable is `true`.

### `junit` — JUnit XML

Produces a single `<testsuite>` element. Each check result becomes a `<testcase>`. FAIL states produce `<failure>` elements; WARN states produce `<error>` elements. PASS states are empty testcases.

```bash
specfuse ci check --format junit > specfuse-junit.xml
```

Compatible with CI systems that consume JUnit XML (GitLab CI, Jenkins, CircleCI, etc.).

### `sarif` — SARIF 2.1.0 JSON

Produces a SARIF 2.1.0 JSON file for GitHub code scanning. Only non-PASS results are included (PASS/IN_SYNC states are omitted).

```bash
specfuse ci check --format sarif > specfuse-results.sarif
```

Upload to GitHub code scanning:

```yaml
- name: SpecFuse SARIF
  if: always()
  run: pnpm specfuse ci check --format sarif > specfuse-results.sarif

- name: Upload SARIF
  if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: specfuse-results.sarif
```

### `auto` — Auto-detect

Picks the best format based on the environment:
- **GitHub Actions** → `github`
- **All other environments** → `junit`

This is the default when no `--format` is specified.

## Programmatic API

Use the CI operations in your own Node.js tools:

```javascript
import { drift, validate, check, init } from 'specfuse/api/ci.mjs'

// Drift check
const { exitCode, output } = await drift({
  root: './my-project',
  format: 'junit',
})

// Validation
const { results, exitCode } = await validate({
  root: './my-project',
  format: 'sarif',
  artifact: 'proposal',
})

// Combined check
const { driftResults, validateResults, exitCode } = await check({
  root: './my-project',
  format: 'github',
})

// Generate workflow file
const { path, created } = await init({ github: true })
```

You can also import the formatters directly:

```javascript
import {
  formatGitHub,
  formatJUnit,
  formatSarif,
  formatAuto,
  detectFormat,
} from 'specfuse/api/ci.mjs'

const output = formatJUnit({ results: myResults }, {
  command: 'custom-check',
  timestamp: new Date().toISOString(),
})
```

## Design Principles

- **Reuse existing core logic** — `ci drift` calls `checkAllDrift()`, `ci validate` calls `validateArtifacts()`. No duplicate behavior.
- **Thin command layer** — Formatting lives in `ci-output.js`, commands just orchestrate.
- **CI-friendly defaults** — Auto-detect format, exit code 1 on failure, no interactive prompts.
- **SARIF compliance** — Output conforms to SARIF 2.1.0 schema for GitHub code scanning integration.
