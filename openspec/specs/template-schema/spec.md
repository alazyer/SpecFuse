# Spec: Template Schema and Validation



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Template Schema and Validation
The system SHALL provide the implemented template schema and validation capability.

- SHALL define a template variable schema with name, type, and description.
- SHALL extract all `{{variable}}` references from template content.
- SHALL validate that all referenced variables are documented.
- SHOULD warn on undocumented variables (not error).
- SHOULD support optional variables with default values.
- MAY support variable type validation (string, number, array).

#### Scenario: Extract variables
- **GIVEN** template content `# {{title}}\n\nDate: {{date}}\n`
- **WHEN** `getTemplateVariables(content)` is called
- **THEN** returns `['title', 'date']`
#### Scenario: Validate documented variables
- **GIVEN** template with documented variables `@vars title: string`
- **AND** template uses `{{title}}`
- **WHEN** `validateTemplate(content)` is called
- **THEN** returns `{valid: true, warnings: []}`
#### Scenario: Warn on undocumented variable
- **GIVEN** template uses `{{unknown}}` without `@vars unknown`
- **WHEN** `validateTemplate(content)` is called
- **THEN** returns `{valid: true, warnings: ['Undocumented variable: unknown']}`
