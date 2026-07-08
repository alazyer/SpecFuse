# Tasks: Programmatic API Expansion — Full CRUD for All Artifact Types

> Part of change: `programmatic-api-expansion`
> Created by SpecFuse on 2026-07-07

---

## Implementation Tasks

### Phase 1: Foundation

- [ ] **T1. Create `src/api/errors.mjs`** — Define typed error classes: `SpecFuseApiError` (base), `ArtifactAlreadyExistsError`, `ArtifactNotFoundError`, `ChangeNotVerifiedError`, `SchemaNotFoundError`. Each error class SHALL include machine-readable properties (e.g., `artifactType`, `slug`, `path`).

- [ ] **T2. Create `src/api/utils.mjs`** — Extract shared internal helpers: `resolveRoot(root)` (path resolution + validation), `loadSchemaOrThrow(root, schemaPath)` (schema loading with typed error on failure), `fillTemplate(template, vars)`, `applySchema(content, schema, artifactId)`, `readTemplate(templateDir, name)`. These wrap existing `artifact-schema.js` and `fs.js` utilities but throw typed errors instead of calling `process.exit`.

### Phase 2: Sync-ops extraction

- [ ] **T3. Extract `src/api/sync-ops.mjs`** — Move the existing `sync`, `drift`, `diff`, `status`, `phase` function implementations from `src/api.mjs` into `src/api/sync-ops.mjs`. Update `src/api.mjs` to re-export from the new module. No behavioral change — pure refactor.

### Phase 3: CRUD modules

- [ ] **T4. Create `src/api/plan.mjs`** — Implement `createPrd`, `createArch`, `createStory`, `createDesignSystem`, `createDesignFlow`, `createDesignScreen`, `list`. Each function uses `src/api/utils.mjs` helpers and the same template/numbering logic from `src/commands/plan/index.js`, but returns structured data objects instead of logging. Reuse `slugifyName` from `change-artifacts.js` for story/flow/screen numbering.

- [ ] **T5. Create `src/api/specify.mjs`** — Implement `init`, `add`, `show`. Reuse constitution template, `upsertManagedSection`, `stripManagedSections`, `extractAllH2Sections` from existing `src/commands/specify/index.js` and `src/utils/markdown.js`. `init` with `sync=true` SHALL invoke the same two-pass sync as the CLI.

- [ ] **T6. Create `src/api/change.mjs`** — Implement `new`, `list`, `show`, `review`, `verify`, `archive`. Reuse `slugifyName`, `titleCaseChangeName`, `parseFrontmatterDocument`, `normalizeReviewStatus`, `normalizeVerifyStatus`, `extractAcceptanceCriteria`, `getConstitutionChecklistItems`, `buildUncheckedChecklist`, `buildConfirmedChecklist`, `countVerifyChecklist`, `detectUiImpact`, `getChangeProposalState`, `getChangeTitle` from `src/utils/change-artifacts.js`. Archive logic replicates the CLI's copy-then-delete approach.

- [ ] **T7. Create `src/api/schema.mjs`** — Implement `init`, `show`. Thin wrappers around `initArtifactSchema` and `loadArtifactSchema` from `src/core/artifact-schema.js`, returning structured results.

### Phase 4: Umbrella and package

- [ ] **T8. Update `src/api.mjs`** — Import and re-export all new modules (`plan`, `specify`, `change`, `schema`, error classes) alongside the existing sync-ops. Update default export to include new namespaces. Preserve backward compatibility: `import { sync } from 'specfuse/api.mjs'` still works.

- [ ] **T9. Update `package.json` exports map** — Add deep-path exports: `"./api/plan.mjs": "./src/api/plan.mjs"`, `"./api/specify.mjs": "./src/api/specify.mjs"`, `"./api/change.mjs": "./src/api/change.mjs"`, `"./api/schema.mjs": "./src/api/schema.mjs"`, `"./api/errors.mjs": "./src/api/errors.mjs"`.

### Phase 5: Tests

- [ ] **T10. Create `src/tests/api.test.js`** — Test all new API functions using Node.js built-in test runner with temporary directories. Coverage areas:
  - Plan: create each artifact type, verify file created, verify return shape, verify idempotent create (returns `created: false`), verify `list` returns structured data
  - Specify: init (with and without sync), add (new and replace), show (parsed sections), error when missing
  - Change: new (return shape, duplicate throws `ArtifactAlreadyExistsError`), list (active + archived), show (full detail, not-found throws), review (generate + already-exists), verify (generate + progress), archive (success + unverified throws + force override)
  - Schema: init (create + already-exists), show (found + missing returns empty state)
  - Errors: verify error classes are `SpecFuseApiError` subclasses, verify error properties
  - Backward compat: existing `sync`, `drift`, `diff`, `status`, `phase` still exported

## Review Checklist

- [ ] All acceptance criteria from proposal.md are met
- [ ] Unit test coverage ≥ 90% of `src/api/` directory
- [ ] No new lint errors
- [ ] Constitution constraints respected (see header below)
- [ ] No `process.exit` calls in any API module
- [ ] No `console.*` or `logger.*` calls in any API module
- [ ] No `chalk` imports in any API module
- [ ] Existing `src/api.mjs` backward compatibility preserved
- [ ] `package.json` exports map valid and deep paths work
- [ ] review.md generated and completed
- [ ] verify.md generated and all acceptance criteria confirmed
- [ ] Change ready to archive

## Custom Instructions (Schema)

- Keep language concise and implementation-oriented.
