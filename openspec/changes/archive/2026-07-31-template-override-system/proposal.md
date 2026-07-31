---
status: active
created: 2026-07-28
---

# Change Proposal: Template Override System

## Overview

Add a `specfuse template` command group that allows users to customize, override, and manage templates for all artifact types. Currently templates are hardcoded in `templates/` with no way to customize per-project or share between projects.

## Problem

1. **No customization** — Teams cannot adapt templates to their specific needs (e.g., always include certain sections, company-specific formatting)
2. **No sharing** — Cannot share custom templates between projects without manual file copying
3. **No visibility** — Users don't know what templates exist or what variables they support
4. **No versioning** — When templates change upstream, no migration path for custom templates

## Scope

**In scope:**
- `specfuse template list` — Show all available templates with descriptions
- `specfuse template show <name>` — Display a template with variable documentation
- `specfuse template copy <name>` — Copy a built-in template to `.specfuse/templates/` for customization
- `specfuse template validate` — Validate all custom templates for correct syntax
- Template resolution: check `.specfuse/templates/` first, fall back to built-in

**Out of scope:**
- Template sharing between projects (future: `specfuse template export/import`)
- Template marketplace or registry
- Dynamic template generation

## Acceptance Criteria

- [ ] `specfuse template list` shows all 12 built-in templates (prd, arch, story, design-system, design-flow, design-screen, proposal, design, tasks, review, verify, constitution)
- [ ] `specfuse template show prd` displays the PRD template with available variables documented
- [ ] `specfuse template copy proposal` copies the proposal template to `.specfuse/templates/change/proposal.md`
- [ ] After copying, `specfuse change new test` uses the custom template from `.specfuse/templates/`
- [ ] `specfuse template validate` exits 0 when all custom templates are valid
- [ ] `specfuse template validate` exits 1 and reports errors for malformed templates
- [ ] Templates support all existing variables (`{{name}}`, `{{date}}`, `{{id}}`, etc.)
- [ ] Custom templates are preserved during `specfuse init --force`

## Impact

- **Users:** Can customize templates to match team conventions
- **Teams:** Can share templates via version control in `.specfuse/templates/`
- **CI/CD:** Template validation can be added to pre-commit hooks

## Risks

- Breaking change if template variable syntax conflicts with user content
- Need to document all template variables clearly
- Migration path for existing projects with modified templates

## Related

- Extends `src/api/plan.mjs`, `src/api/change.mjs`, `src/api/specify.mjs`
- New command file: `src/commands/template.js`
- New core module: `src/core/template-resolver.js`
- New test file: `src/tests/template.test.js`
