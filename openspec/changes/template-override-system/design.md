# Design: Template Override System

## Architecture

### Template Resolution Flow

```
User runs: specfuse change new add-login
                    │
                    ▼
         TemplateResolver.resolve('change', 'proposal.md')
                    │
                    ▼
    Check .specfuse/templates/change/proposal.md exists?
         │                      │
        YES                     NO
         │                      │
         ▼                      ▼
   Return custom           Return built-in
    template               templates/change/proposal.md
         │                      │
         └──────────┬───────────┘
                    ▼
         fillTemplate(content, vars)
                    │
                    ▼
         applySchema(filled, schema)
                    │
                    ▼
              Write to disk
```

### New Files

1. **`src/commands/template.js`** — CLI command handlers
   - `templateListCommand()` — List all templates
   - `templateShowCommand()` — Show single template
   - `templateCopyCommand()` — Copy template to custom location
   - `templateValidateCommand()` — Validate custom templates

2. **`src/core/template-resolver.js`** — Template resolution logic
   - `resolveTemplate(category, name)` — Resolve with fallback
   - `listTemplates()` — Enumerate all templates
   - `getTemplateVariables(content)` — Extract variable names from template
   - `validateTemplate(content)` — Check template syntax

3. **`src/api/template.mjs`** — Programmatic API
   - `list()` — List templates
   - `show(name)` — Get template content
   - `copy(name, options)` — Copy to custom location
   - `validate()` — Validate all custom templates

### Template Variable Schema

Each template documents its variables in a comment block:

```markdown
<!--
@template proposal
@vars title: string - Change title
@vars changeName: string - Kebab-case slug
@vars date: string - ISO date (YYYY-MM-DD)
@vars stories: string[] - Optional story IDs
-->
```

### Template Validation Rules

1. All `{{variable}}` references must be documented
2. No unclosed `{{` or `}}` brackets
3. Valid Markdown structure (headings, lists)
4. No conflicting with HTML comment markers

### File Structure

```
.specfuse/
└── templates/
    ├── plan/
    │   ├── prd.md
    │   ├── architecture.md
    │   └── story.md
    ├── plan/design/
    │   ├── system.md
    │   ├── flow.md
    │   └── screen.md
    └── change/
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        ├── review.md
        └── verify.md
```

## Implementation Notes

1. **Backward compatibility:** Existing code using `readTemplate()` continues to work; `TemplateResolver` wraps it with fallback logic.

2. **Schema integration:** Custom templates still receive schema instructions via `applySchema()`.

3. **Variable escaping:** Use `\\{{` and `\\}}` to escape template syntax in content.

4. **Copy behavior:** `template copy` creates parent directories as needed, errors if file already exists (use `--force` to overwrite).

## CLI Design

```
specfuse template list [--json]
specfuse template show <name> [--vars]
specfuse template copy <name> [--force]
specfuse template validate [--json]
```

### Template Name Syntax

- `prd` → `plan/prd.md`
- `arch` → `plan/architecture.md`
- `story` → `plan/story.md`
- `design-system` → `plan/design/system.md`
- `proposal` → `change/proposal.md`
- etc.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid template name | Error with suggestions |
| Copy to existing file | Error unless `--force` |
| Malformed template | `validate` reports line/column |
| Missing variable docs | Warning, not error |
