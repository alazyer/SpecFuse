# Spec: GitHub Actions Output Format



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: GitHub Actions Output Format
The system SHALL provide the implemented github actions output format capability.

- SHALL output `::error` for FAIL state results.
- SHALL output `::warning` for WARN state results.
- SHALL include `file` and `line` when available.
- SHOULD group related issues by file.
- SHOULD include remediation in message.

#### Scenario: Error annotation
- **GIVEN** drift result with state `BOTH_CHANGED`
- **WHEN** formatted with GitHub format
- **THEN** output is `::error file=constitution.md::Drift: BOTH_CHANGED`
#### Scenario: Warning annotation
- **GIVEN** validation result with state `WARN`
- **WHEN** formatted with GitHub format
- **THEN** output is `::warning file=prd.md::Missing section: Overview`
