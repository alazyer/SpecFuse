---
status: active
created: 2026-07-07
reviewed_by: ~
verified_by: ~
archived: ~
---

# Change Proposal: Programmatic API Expansion — Full CRUD for All Artifact Types

> Created by SpecFuse on 2026-07-07
> Related: [COM-79](mention://issue/5cb59a9c-c0a6-4d0a-92ff-6b1c14dfd554)

---

## Overview

Expand `src/api.mjs` from 5 sync/observability functions to a complete programmatic API covering CRUD operations for all SpecFuse artifact types (plan, specify, change, schema). Consumers will be able to `import { plan, change, specify, schema, sync, drift } from 'specfuse/api.mjs'` and perform every CLI-equivalent operation without spawning a subprocess.

## Problem Statement

The current programmatic API (`src/api.mjs`) exposes only `sync`, `drift`, `diff`, `status`, and `phase`. This covers the sync/observability surface but provides **no CRUD operations** for creating, reading, updating, or deleting artifacts. Any tooling, editor integration, or automation that wants to create a change proposal, add a story, or read the constitution must shell out to the CLI — slower, harder to compose, and impossible in browser or serverless environments.

The CLI command modules (`src/commands/plan/index.js`, `src/commands/specify/index.js`, `src/commands/change/index.js`, `src/commands/schema.js`) already implement all the CRUD logic, but it is tightly coupled to CLI presentation (chalk, logger, console.log, process.exit). This coupling prevents reuse from programmatic consumers.

## Proposed Solution

Add five namespaced API modules to `src/api.mjs` — `plan`, `specify`, `change`, `schema`, and a re-export umbrella — that wrap the same underlying modules (fs utils, registry, artifact-schema, change-artifacts, markdown) used by the CLI commands. These API functions SHALL:

- Return structured data objects (not log to stdout)
- Throw typed errors (not call `process.exit`)
- Accept the same `projectRoot` + options pattern as the existing API functions
- Remain independent of `chalk`, `logger`, and any CLI-only dependencies

CLI commands remain unchanged in this change; a future refactor can thin-wrap the API layer.

## Scope

**In scope:**
- `src/api.mjs` — Major expansion with all CRUD functions organized into namespaced exports
- `src/api/plan.mjs` — Plan API module (createPrd, createArch, createStory, createDesignSystem, createDesignFlow, createDesignScreen, list)
- `src/api/specify.mjs` — Specify API module (init, add, show)
- `src/api/change.mjs` — Change API module (new, list, show, review, verify, archive)
- `src/api/schema.mjs` — Schema API module (init, show)
- `src/api/utils.mjs` — Shared internal helpers (path resolution, schema loading, template filling)
- `src/api/errors.mjs` — Typed error classes (ArtifactAlreadyExistsError, ArtifactNotFoundError, ChangeNotVerifiedError, SchemaNotFoundError)
- `src/tests/api.test.js` — Comprehensive test coverage for all new API functions
- `package.json` — Update exports map for deep-path imports

**Out of scope:**
- Refactoring existing CLI commands to call the API layer (future change)
- Watch/guide/doctor/init/diff/sync/drift/status/phase API functions (already covered or out of CRUD scope)
- Browser-specific bundling or ESM/CJS dual packaging
- Plugin rule management API
- Any changes to CLI behavior or output
- Delete operations for artifacts (not currently supported by CLI either)

## Acceptance Criteria

- [ ] `plan.createPrd(root, { name })` creates a PRD from template and returns `{ path, content, created: true }`; returns `{ path, content, created: false }` if already exists
- [ ] `plan.createArch(root)` creates an architecture doc from template and returns `{ path, content, created }`
- [ ] `plan.createStory(root, title)` creates a numbered story file and returns `{ path, content, filename, id }`
- [ ] `plan.createDesignSystem(root)` creates a design system doc and returns `{ path, content, created }`
- [ ] `plan.createDesignFlow(root, title)` creates a design flow file and returns `{ path, content, filename, id }`
- [ ] `plan.createDesignScreen(root, title)` creates a screen spec file and returns `{ path, content, filename, id }`
- [ ] `plan.list(root)` returns structured artifact status array (no console output)
- [ ] `specify.init(root, { force?, sync? })` creates or resets constitution.md and returns `{ path, content, created, syncedSections? }`
- [ ] `specify.add(root, section, content?)` adds or updates a constitution section and returns `{ path, section, added: boolean }`
- [ ] `specify.show(root)` returns parsed constitution as `{ sections: Array<{heading, content, managed}>, raw: string }`
- [ ] `change.new(root, name)` creates a change proposal directory and returns `{ slug, dir, files: Array<{name, path, content}> }`
- [ ] `change.list(root)` returns `{ active: Array<ChangeSummary>, archived: Array<ChangeSummary> }`
- [ ] `change.show(root, name)` returns full change detail as structured object; throws `ArtifactNotFoundError` if not found
- [ ] `change.review(root, name)` generates review.md and returns `{ path, content, created, status }`
- [ ] `change.verify(root, name)` generates verify.md and returns `{ path, content, created, status, checked, total }`
- [ ] `change.archive(root, name, { force? })` archives a change and returns `{ archiveDir, archived: true }`; throws `ChangeNotVerifiedError` if unverified without force
- [ ] `schema.init(root, { force? })` creates schema file and returns `{ path, created }`
- [ ] `schema.show(root)` returns parsed schema as structured object; throws `SchemaNotFoundError` if missing and required
- [ ] All API functions throw typed errors (not `process.exit`); error classes: `ArtifactAlreadyExistsError`, `ArtifactNotFoundError`, `ChangeNotVerifiedError`, `SchemaNotFoundError`
- [ ] Existing 5 API functions (`sync`, `drift`, `diff`, `status`, `phase`) continue to work unchanged
- [ ] Deep import paths work: `import { plan } from 'specfuse/api.mjs'` and `import plan from 'specfuse/api/plan.mjs'`
- [ ] All new API functions have unit tests in `src/tests/api.test.js` with ≥90% line coverage of `src/api/`
- [ ] No CLI behavior changes — existing `specfuse` commands produce identical output

## Technical Impact

- **Files affected:** ~8 new files, 2 modified files (api.mjs, package.json)
- **Database changes:** No
- **API changes:** Yes — non-breaking expansion (all new exports, no removals)
- **Dependencies added:** None

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Logic drift between CLI and API implementations | Medium | Medium | Share underlying modules (fs, registry, artifact-schema, change-artifacts, markdown); add integration tests that verify API results match CLI file output |
| Template loading path differences in bundled environments | Low | High | Use `import.meta.url`-based resolution consistently; document Node.js ≥20 requirement |
| Breaking existing `import api from 'specfuse/api.mjs'` default export | Low | High | Preserve default export object shape; add new namespaces as properties only |
| Return type instability across versions | Medium | Medium | Version the API surface; use JSDoc `@returns` types; treat return shapes as semver-public |

## Custom Instructions (Schema)

- Keep language concise and implementation-oriented.
- Always link related issue IDs in the Overview section.
