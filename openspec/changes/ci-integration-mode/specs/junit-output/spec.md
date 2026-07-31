# Spec: JUnit XML Output Format

## SHALL Requirements

1. **SHALL** output valid JUnit XML schema.
2. **SHALL** create `<testsuite>` for each check category.
3. **SHALL** create `<testcase>` for each check.
4. **SHALL** add `<failure>` for FAIL state checks.

## SHOULD Requirements

5. **SHOULD** include execution time in testsuite.
6. **SHOULD** include message in failure element.

## Test Scenarios

### Scenario: JUnit structure
**Given** validation results
**When** formatted with JUnit format
**Then** output is valid XML
**And** root element is `<testsuites>`
**And** contains `<testsuite name="specfuse-validate">`

### Scenario: JUnit failure
**Given** validation result with state `FAIL`
**When** formatted with JUnit format
**Then** testcase contains `<failure>...</failure>`
