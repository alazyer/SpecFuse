# Spec: Template CLI Commands



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Template CLI Commands
The system SHALL provide the implemented template cli commands capability.

- SHALL provide `specfuse template list` command that outputs all available template names and their descriptions.
- SHALL support `--json` flag for machine-readable output.
- SHALL include both built-in and custom templates in the list.
- SHOULD group templates by category (plan, change, constitution) in output.
- SHOULD indicate which templates have custom overrides.

#### Scenario: List all templates
- **GIVEN** a fresh SpecFuse project
- **WHEN** user runs `specfuse template list`
- **THEN** output includes all 12 template names:
- prd, arch, story
- design-system, design-flow, design-screen
- proposal, design, tasks, review, verify
- constitution
#### Scenario: List with custom templates
- **GIVEN** a project with `.specfuse/templates/change/proposal.md`
- **WHEN** user runs `specfuse template list`
- **THEN** proposal template shows "(custom)" indicator
#### Scenario: JSON output
- **GIVEN** any project
- **WHEN** user runs `specfuse template list --json`
- **THEN** output is valid JSON array with `{name, category, custom, description}` objects
