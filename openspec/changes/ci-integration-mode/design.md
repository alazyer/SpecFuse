# Design: CI Integration Mode

## Architecture

### Output Formats

1. **GitHub Actions** (`--format github`)
   ```
   ::error file=constitution.md,line=10::Drift detected: BOTH_CHANGED
   ::warning file=proposal.md::Missing required section: Scope
   ```

2. **JUnit XML** (`--format junit`)
   ```xml
   <?xml version="1.0"?>
   <testsuites>
     <testsuite name="specfuse-validate">
       <testcase name="checkRequiredSections:prd"/>
       <testcase name="checkAcceptanceCriteria:proposal">
         <failure>Missing acceptance criteria</failure>
       </testcase>
     </testsuite>
   </testsuites>
   ```

3. **SARIF** (`--format sarif`)
   ```json
   {
     "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/sarif-2.1.0.json",
     "runs": [{
       "tool": {"driver": {"name": "SpecFuse"}},
       "results": [{
         "ruleId": "SF001",
         "level": "error",
         "message": {"text": "Drift detected"},
         "locations": [{"physicalLocation": {"artifactLocation": {"uri": "constitution.md"}}}]
       }]
     }]
   }
   ```

### New Files

1. **`src/commands/ci.js`** — CI command handlers
2. **`src/core/ci-output.js`** — Output format generators
3. **`templates/ci/github-actions.yml`** — Workflow template

### GitHub Actions Workflow Template

```yaml
name: SpecFuse

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx specfuse ci drift --format github

  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx specfuse ci validate --format sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: specfuse.sarif
```

### CLI Design

```
specfuse ci drift [--format github|junit|sarif]
specfuse ci validate [--format github|junit|sarif]
specfuse ci check [--format github|junit|sarif]
specfuse ci init [--github]

Options:
  --fail-on-warn    Exit 1 on warnings (not just errors)
  --output <path>   Write output to file
```

## Implementation Notes

1. **GitHub format:** Uses `::error` and `::warning` commands with file/line annotations.

2. **JUnit format:** Maps each check to a testcase, failures for FAIL state.

3. **SARIF format:** Follows SARIF 2.1.0 spec for GitHub code scanning.

4. **Exit codes:** 0 = all checks pass, 1 = any failures.

5. **Performance:** CI mode should complete in < 5 seconds for typical projects.
