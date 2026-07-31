# Spec: GitHub Actions Output Format

## SHALL Requirements

1. **SHALL** output `::error` for FAIL state results.
2. **SHALL** output `::warning` for WARN state results.
3. **SHALL** include `file` and `line` when available.

## SHOULD Requirements

4. **SHOULD** group related issues by file.
5. **SHOULD** include remediation in message.

## Test Scenarios

### Scenario: Error annotation
**Given** drift result with state `BOTH_CHANGED`
**When** formatted with GitHub format
**Then** output is `::error file=constitution.md::Drift: BOTH_CHANGED`

### Scenario: Warning annotation
**Given** validation result with state `WARN`
**When** formatted with GitHub format
**Then** output is `::warning file=prd.md::Missing section: Overview`
