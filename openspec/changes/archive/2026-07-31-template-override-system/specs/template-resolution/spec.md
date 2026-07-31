# Spec: Template Resolution

## SHALL Requirements

1. **SHALL** check `.specfuse/templates/<path>` first when resolving any template.
2. **SHALL** fall back to built-in `templates/<path>` if custom template not found.
3. **SHALL** return the same content structure whether from custom or built-in.

## SHOULD Requirements

4. **SHOULD** log a debug message when using custom template.
5. **SHOULD** cache resolved templates for the duration of a command invocation.

## Test Scenarios

### Scenario: Resolve built-in template
**Given** no custom templates exist
**When** `resolveTemplate('change', 'proposal.md')` is called
**Then** returns content from `templates/change/proposal.md`

### Scenario: Resolve custom template
**Given** `.specfuse/templates/change/proposal.md` exists
**When** `resolveTemplate('change', 'proposal.md')` is called
**Then** returns content from `.specfuse/templates/change/proposal.md`

### Scenario: Partial override
**Given** only `.specfuse/templates/change/proposal.md` exists (not design.md)
**When** `resolveTemplate('change', 'design.md')` is called
**Then** returns built-in `templates/change/design.md`
