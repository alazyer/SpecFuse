# Spec: Template Resolution



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Template Resolution
The system SHALL provide the implemented template resolution capability.

- SHALL check `.specfuse/templates/<path>` first when resolving any template.
- SHALL fall back to built-in `templates/<path>` if custom template not found.
- SHALL return the same content structure whether from custom or built-in.
- SHOULD log a debug message when using custom template.
- SHOULD cache resolved templates for the duration of a command invocation.

#### Scenario: Resolve built-in template
- **GIVEN** no custom templates exist
- **WHEN** `resolveTemplate('change', 'proposal.md')` is called
- **THEN** returns content from `templates/change/proposal.md`
#### Scenario: Resolve custom template
- **GIVEN** `.specfuse/templates/change/proposal.md` exists
- **WHEN** `resolveTemplate('change', 'proposal.md')` is called
- **THEN** returns content from `.specfuse/templates/change/proposal.md`
#### Scenario: Partial override
- **GIVEN** only `.specfuse/templates/change/proposal.md` exists (not design.md)
- **WHEN** `resolveTemplate('change', 'design.md')` is called
- **THEN** returns built-in `templates/change/design.md`
