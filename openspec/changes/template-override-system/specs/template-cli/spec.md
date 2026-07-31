# Spec: Template CLI Commands

## SHALL Requirements

1. **SHALL** provide `specfuse template list` command that outputs all available template names and their descriptions.
2. **SHALL** support `--json` flag for machine-readable output.
3. **SHALL** include both built-in and custom templates in the list.

## SHOULD Requirements

4. **SHOULD** group templates by category (plan, change, constitution) in output.
5. **SHOULD** indicate which templates have custom overrides.

## Test Scenarios

### Scenario: List all templates
**Given** a fresh SpecFuse project
**When** user runs `specfuse template list`
**Then** output includes all 12 template names:
- prd, arch, story
- design-system, design-flow, design-screen
- proposal, design, tasks, review, verify
- constitution

### Scenario: List with custom templates
**Given** a project with `.specfuse/templates/change/proposal.md`
**When** user runs `specfuse template list`
**Then** proposal template shows "(custom)" indicator

### Scenario: JSON output
**Given** any project
**When** user runs `specfuse template list --json`
**Then** output is valid JSON array with `{name, category, custom, description}` objects
