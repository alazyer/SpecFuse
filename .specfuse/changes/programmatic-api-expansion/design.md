# Design: Programmatic API Expansion — Full CRUD for All Artifact Types

> Part of change: `programmatic-api-expansion`
> Created by SpecFuse on 2026-07-07

---

## Data Model

No new data model changes. The API operates on the same file-based artifacts and `Registry` that the CLI uses.

**Key existing data structures the API will expose:**

| Structure | Source | API Return Shape |
|-----------|--------|-----------------|
| Plan artifacts | `.specfuse/plan/*.md` | `{ path, content, created, filename?, id? }` |
| Constitution | `.specfuse/constitution.md` | `{ sections: [{heading, content, managed}], raw }` |
| Change proposals | `.specfuse/changes/<slug>/` | `{ slug, dir, files: [{name, path, content}] }` or `ChangeSummary` |
| Artifact schema | `.specfuse/artifact-schema.json` | `{ path, exists, version, artifacts }` |

**New error classes** (in `src/api/errors.mjs`):

```
SpecFuseApiError              ← base class (extends Error)
├── ArtifactAlreadyExistsError  { artifactType, path }
├── ArtifactNotFoundError       { artifactType, name, path? }
├── ChangeNotVerifiedError      { slug, verifyStatus, checked, total }
└── SchemaNotFoundError         { path }
```

## API Design

### Module Layout

```
src/api/
├── errors.mjs        ← typed error classes
├── utils.mjs         ← shared internal helpers
├── plan.mjs          ← plan.* CRUD
├── specify.mjs       ← specify.* CRUD
├── change.mjs        ← change.* CRUD
└── schema.mjs        ← schema.* CRUD
src/api.mjs           ← umbrella re-export (existing + new)
```

### Plan API

```js
// src/api/plan.mjs

plan.createPrd(root, { name?, schemaPath? })
  → Promise<{ path: string, content: string, created: boolean }>
  // created=false when file already exists (does not overwrite)

plan.createArch(root, { schemaPath? })
  → Promise<{ path: string, content: string, created: boolean }>

plan.createStory(root, title, { schemaPath? })
  → Promise<{ path: string, content: string, filename: string, id: string }>

plan.createDesignSystem(root, { schemaPath? })
  → Promise<{ path: string, content: string, created: boolean }>

plan.createDesignFlow(root, title, { schemaPath? })
  → Promise<{ path: string, content: string, filename: string, id: string }>

plan.createDesignScreen(root, title, { schemaPath? })
  → Promise<{ path: string, content: string, filename: string, id: string }>

plan.list(root)
  → Promise<{ artifacts: Array<PlanArtifactStatus> }>
  // PlanArtifactStatus = { type, label, path, exists, modifiedTime? }
```

### Specify API

```js
// src/api/specify.mjs

specify.init(root, { force?, sync?, schemaPath? })
  → Promise<{ path: string, content: string, created: boolean, syncedSections?: number }>
  // sync=true auto-syncs plan artifacts like CLI does

specify.add(root, sectionName, content?)
  → Promise<{ path: string, section: string, added: boolean }>
  // added=true = new section appended; added=false = existing section replaced

specify.show(root)
  → Promise<{ sections: Array<SectionInfo>, raw: string }>
  // SectionInfo = { heading: string, content: string, managed: boolean }
  // Throws ArtifactNotFoundError if constitution.md missing
```

### Change API

```js
// src/api/change.mjs

change.new(root, name, { schemaPath? })
  → Promise<{ slug: string, dir: string, files: Array<{name, path, content}> }>
  // Throws ArtifactAlreadyExistsError if change with same slug already active

change.list(root)
  → Promise<{ active: Array<ChangeSummary>, archived: Array<ArchivedChangeSummary> }>
  // ChangeSummary = { slug, title, status, reviewStatus, verifyProgress, uiImpact, modifiedTime }
  // ArchivedChangeSummary = { slug, title, archiveName, verifyStatus }

change.show(root, name)
  → Promise<ChangeDetail>
  // ChangeDetail = { slug, dir, archived, archiveName?, proposal, design, tasks, review, verify,
  //                  status, reviewStatus, verifyStatus, hasConstitutionalHeader }
  // Throws ArtifactNotFoundError if change not found

change.review(root, name, { schemaPath? })
  → Promise<{ path: string, content: string, created: boolean, status: string }>

change.verify(root, name, { schemaPath? })
  → Promise<{ path: string, content: string, created: boolean, status: string, checked: number, total: number }>

change.archive(root, name, { force? })
  → Promise<{ archiveDir: string, slug: string }>
  // Throws ChangeNotVerifiedError if verification not passed and force=false
```

### Schema API

```js
// src/api/schema.mjs

schema.init(root, { force? })
  → Promise<{ path: string, created: boolean }>

schema.show(root)
  → Promise<{ path: string, displayPath: string, exists: boolean, version: number, artifacts: Object }>
  // Does NOT throw when schema missing — returns { exists: false, artifacts: {} }
  // (differs from CLI which shows help; API returns empty state for composability)
```

### Umbrella Re-export

```js
// src/api.mjs (updated)

import { sync, drift, diff, status, phase } from './api/sync-ops.mjs'  // renamed from inline
import * as plan from './api/plan.mjs'
import * as specify from './api/specify.mjs'
import * as change from './api/change.mjs'
import * as schema from './api/schema.mjs'
export { SpecFuseApiError, ArtifactAlreadyExistsError, ArtifactNotFoundError,
         ChangeNotVerifiedError, SchemaNotFoundError } from './api/errors.mjs'

export { sync, drift, diff, status, phase, plan, specify, change, schema }

export default { sync, drift, diff, status, phase, plan, specify, change, schema }
```

### Error Handling Contract

1. **No `process.exit`** — all API functions throw instead of exiting the process.
2. **No console output** — API functions never call `console.log`, `logger.*`, or `chalk`.
3. **Typed errors** — all thrown errors are subclasses of `SpecFuseApiError` with machine-readable properties.
4. **Idempotent create** — `createPrd`, `createArch`, `createDesignSystem` return `{ created: false }` when artifact exists rather than throwing; `change.new` throws `ArtifactAlreadyExistsError` because a duplicate active change is a harder conflict.

## Sequence Diagrams

### Plan: createPrd flow

```
Consumer → api.plan.createPrd(root, { name })
  → api.utils.resolveRoot(root)
  → api.utils.loadSchemaOrThrow(root, schemaPath)
  → utils/plan.resolveTemplate('prd.md')
  → api.utils.fillTemplate(template, { name, date })
  → api.utils.applySchema(content, schema, 'plan.prd')
  → fs.pathExists(prdPath)?
      yes → readFileSafe(prdPath) → return { path, content, created: false }
      no  → writeFileAtomic(prdPath, content) → return { path, content, created: true }
```

### Change: archive flow

```
Consumer → api.change.archive(root, name, { force })
  → change-artifacts.slugifyName(name)
  → fs.pathExists(changeDir)?
      no → throw ArtifactNotFoundError
  → readFileSafe(verify.md)
  → change-artifacts.normalizeVerifyStatus / countVerifyChecklist
  → verifyStatus !== 'pass' && !force?
      yes → throw ChangeNotVerifiedError({ slug, verifyStatus, checked, total })
  → cp(changeDir, archiveDir, { recursive })
  → updateProposalStatus(archiveDir/proposal.md, { status: 'archived', archived: date })
  → rm(changeDir, { recursive })
  → return { archiveDir, slug }
```

### Specify: show flow

```
Consumer → api.specify.show(root)
  → fs.pathExists(constitutionPath)?
      no → throw ArtifactNotFoundError({ artifactType: 'constitution' })
  → readFileSafe(constitutionPath)
  → markdown.extractAllH2Sections(content)
  → detect managed sections via comment markers
  → return { sections: [{heading, content, managed}], raw }
```

## UI Impact

**Affects UI:** No

This is a pure programmatic API expansion. No CLI output, terminal formatting, or user-facing UI changes.

### Screen/Component Changes

None.

### Design System References

None applicable.

### Accessibility Impact

None — no UI changes.

## Open Questions

- [ ] Should `plan.list()` return stories and design items inline, or as separate sub-arrays? **Decision: single flat `artifacts` array with a `type` discriminator — simpler to consume, filterable by caller.**
- [ ] Should `schema.show()` throw when missing, or return an empty-state object? **Decision: return `{ exists: false, artifacts: {} }` — more composable; callers can check `exists` and decide.**
- [ ] Should the existing `sync/drift/diff/status/phase` functions be moved into `src/api/sync-ops.mjs` or stay inline? **Decision: extract to `src/api/sync-ops.mjs` for module consistency, but this is a pure refactor with no behavioral change.**

## Custom Instructions (Schema)

- Keep language concise and implementation-oriented.
