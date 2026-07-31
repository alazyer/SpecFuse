# Spec: Template Schema and Validation

## SHALL Requirements

1. **SHALL** define a template variable schema with name, type, and description.
2. **SHALL** extract all `{{variable}}` references from template content.
3. **SHALL** validate that all referenced variables are documented.

## SHOULD Requirements

4. **SHOULD** warn on undocumented variables (not error).
5. **SHOULD** support optional variables with default values.

## MAY Requirements

6. **MAY** support variable type validation (string, number, array).

## Test Scenarios

### Scenario: Extract variables
**Given** template content `# {{title}}\n\nDate: {{date}}\n`
**When** `getTemplateVariables(content)` is called
**Then** returns `['title', 'date']`

### Scenario: Validate documented variables
**Given** template with documented variables `@vars title: string`
**And** template uses `{{title}}`
**When** `validateTemplate(content)` is called
**Then** returns `{valid: true, warnings: []}`

### Scenario: Warn on undocumented variable
**Given** template uses `{{unknown}}` without `@vars unknown`
**When** `validateTemplate(content)` is called
**Then** returns `{valid: true, warnings: ['Undocumented variable: unknown']}`
