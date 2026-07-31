# Tasks: Template Override System

## Phase 1: Core Resolution (P1)

- [ ] **T1:** Create `src/core/template-resolver.js` with `resolveTemplate()`, `listTemplates()`, `getTemplateVariables()`
- [ ] **T2:** Add `TEMPLATE_DIR` constant pointing to `.specfuse/templates/`
- [ ] **T3:** Implement fallback logic: check custom dir first, then built-in
- [ ] **T4:** Add unit tests for template resolution (`template-resolver.test.js`)

## Phase 2: CLI Commands (P1)

- [ ] **T5:** Create `src/commands/template.js` with list/show/copy/validate handlers
- [ ] **T6:** Register commands in `src/cli.js` under `specfuse template` group
- [ ] **T7:** Implement `specfuse template list` with JSON output
- [ ] **T8:** Implement `specfuse template show <name>` with variable docs
- [ ] **T9:** Implement `specfuse template copy <name>` with force flag
- [ ] **T10:** Implement `specfuse template validate` with JSON output
- [ ] **T11:** Add CLI tests (`template.test.js`)

## Phase 3: Integration (P2)

- [ ] **T12:** Update `src/api/plan.mjs` to use `TemplateResolver.resolve()`
- [ ] **T13:** Update `src/api/change.mjs` to use `TemplateResolver.resolve()`
- [ ] **T14:** Update `src/api/specify.mjs` to use `TemplateResolver.resolve()`
- [ ] **T15:** Add `src/api/template.mjs` for programmatic access

## Phase 4: Documentation (P2)

- [ ] **T16:** Add `@vars` documentation to all built-in templates
- [ ] **T17:** Update README.md with template command reference
- [ ] **T18:** Add template customization guide to docs/

## Phase 5: Testing (P1)

- [ ] **T19:** Integration tests for template copy + usage flow
- [ ] **T20:** Edge case tests: missing template, invalid name, circular reference
- [ ] **T21:** Performance test: template resolution overhead < 5ms