# Template Customization

SpecFuse v4 supports per-project template customization. You can override any built-in template with your own version.

## Overview

All built-in templates live in the `templates/` directory. When you create a new artifact, SpecFuse:

1. Checks `.specfuse/templates/` for a custom override
2. Falls back to the built-in template if no override exists

This means you can customize the default content for any artifact type without modifying the SpecFuse codebase.

## Quick Start

1. List available templates:

   ```bash
   specfuse template list
   ```

2. Copy a template for customization:

   ```bash
   specfuse template copy proposal
   ```

   This creates `.specfuse/templates/change/proposal.md`.

3. Edit the copy in your preferred editor.

4. Future changes created with `specfuse change new` will use your custom template.

## Template Names

| Name | Category | Description |
|------|----------|-------------|
| `prd` | plan | Product Requirements Document |
| `architecture` | plan | Architecture Document |
| `story` | plan | User Story |
| `design-system` | plan/design | Design System Document |
| `design-flow` | plan/design | Design Flow |
| `design-screen` | plan/design | Design Screen Spec |
| `proposal` | change | Change Proposal |
| `change-design` | change | Change Design |
| `tasks` | change | Change Tasks |
| `review` | change | Review Document |
| `verify` | change | Verification Document |
| `constitution` | specify | Project Constitution |

## Template Variables

Templates use `{{variable}}` syntax for placeholder substitution. For example:

```markdown
# Story: {{title}}

> Created by SpecFuse on {{date}}
> Story ID: {{id}}
```

### Viewing Variable Documentation

To see what variables a template uses:

```bash
specfuse template show story --vars
```

Output:

```
  {{title}}     Story title
  {{id}}        Story ID (e.g. STORY-001)
  {{date}}      Creation date in YYYY-MM-DD format
  {{role}}      User role (e.g. user, admin)
  {{capability}} What the user wants to do
  {{benefit}}   Why they want to do it
```

### Documenting Variables

Templates can include an `@vars` comment block at the top:

```markdown
<!--
@vars
title: Story title
id: Story ID (e.g. STORY-001)
date: Creation date in YYYY-MM-DD format
-->
# Story: {{title}}
```

When present, `specfuse template show --vars` displays this documentation. If absent, SpecFuse auto-detects `{{var}}` references.

## Escaping Template Syntax

If you need literal `{{` or `}}` in your template (e.g., for code examples), escape them:

```markdown
\{{not.a.variable}}
```

This will be preserved as `{{not.a.variable}}` in the output.

## Template Validation

Validate your custom templates for syntax errors:

```bash
specfuse template validate
```

This checks for:

- Unmatched `{{` / `}}` delimiters
- Empty variable names `{{}}`
- Nested delimiters `{{outer {{inner}}}}`

## Overwriting Custom Templates

If you've already customized a template and want to reset it:

```bash
specfuse template copy proposal --force
```

This overwrites your custom template with the built-in version.

## Removing Custom Templates

To revert to the built-in template:

```bash
rm .specfuse/templates/change/proposal.md
```

The next artifact creation will use the built-in template.

## Directory Structure

Custom templates mirror the built-in structure:

```text
.specfuse/templates/
├── plan/
│   ├── prd.md
│   ├── architecture.md
│   ├── story.md
│   └── design/
│       ├── system.md
│       ├── flow.md
│       └── screen.md
├── change/
│   ├── proposal.md
│   ├── design.md
│   ├── tasks.md
│   ├── review.md
│   └── verify.md
└── specify/
    └── constitution.md
```

## Constitution Template

The constitution template is special: it's an inline string rather than a file. When you copy it:

```bash
specfuse template copy constitution
```

SpecFuse creates `.specfuse/templates/specify/constitution.md` containing the default constitution template.

## Programmatic API

You can also manage templates via the API:

```js
import { template } from 'specfuse/api.mjs';

// List templates
const templates = await template.list('./my-project');

// Show a template
const info = await template.show('./my-project', 'proposal');

// Copy a template
await template.copy('./my-project', 'proposal', { force: true });

// Validate custom templates
const results = await template.validate('./my-project');
```

## Best Practices

1. **Document your variables** — Add `@vars` blocks to custom templates so others can see what's expected.

2. **Validate before committing** — Run `specfuse template validate` to catch syntax errors early.

3. **Commit custom templates** — They're project-specific and should be versioned with your code.

4. **Don't over-customize** — The built-in templates are designed for general use. Customize only what you need.

5. **Preserve managed sections** — If your template includes content synced from elsewhere (e.g., constitutional headers in proposals), keep the managed section markers intact.