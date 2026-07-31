# Spec: JUnit XML Output Format



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: JUnit XML Output Format
The system SHALL provide the implemented junit xml output format capability.

- SHALL output valid JUnit XML schema.
- SHALL create `<testsuite>` for each check category.
- SHALL create `<testcase>` for each check.
- SHALL add `<failure>` for FAIL state checks.
- SHOULD include execution time in testsuite.
- SHOULD include message in failure element.

#### Scenario: JUnit structure
- **GIVEN** validation results
- **WHEN** formatted with JUnit format
- **THEN** output is valid XML
- **AND** root element is `<testsuites>`
- **AND** contains `<testsuite name="specfuse-validate">`
#### Scenario: JUnit failure
- **GIVEN** validation result with state `FAIL`
- **WHEN** formatted with JUnit format
- **THEN** testcase contains `<failure>...</failure>`
