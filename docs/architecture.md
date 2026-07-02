# SpecFuse Architecture Overview

> SpecFuse v4 — self-contained Spec-Driven Development platform.
> This document describes the system architecture, data flows, and key design decisions.

## System Architecture

SpecFuse is a layered CLI application built on a rule-driven sync engine. The architecture follows a clear separation of concerns across four layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI Layer (Commander)                        │
│  init │ guide │ schema │ plan │ specify │ change │ sync │ drift …  │
├─────────────────────────────────────────────────────────────────────┤
│                      Core Engine Layer                               │
│  Registry │ SyncEngine │ Differ │ DriftDetector │ PhaseDetector    │
│  RuleLoader │ RuleContext │ WorkflowAdvice │ ArtifactSchema         │
├─────────────────────────────────────────────────────────────────────┤
│                      Utility Layer                                   │
│  Markdown │ FileSystem │ Logger │ ChangeArtifacts                   │
├─────────────────────────────────────────────────────────────────────┤
│                      Rules Layer                                     │
│  Built-in rules (plan-to-constitution, changes-and-stories)         │
│  User plugin rules (.specfuse/rules.mjs)                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**CLI Layer** (`src/cli.js`, `src/commands/*`)
- Parses command-line arguments via Commander
- Routes user actions to the appropriate command handler
- Provides help text, error suggestions (Levenshtein-based), and aliases
- Commands are the only entry point for users and the programmatic API

**Core Engine Layer** (`src/core/*`)
- Houses the sync engine, drift detection, phase detection, and registry
- Orchestrates the two-pass sync pipeline
- Provides a frozen `RuleContext` that constrains what rules can access
- Manages artifact schema loading and validation

**Utility Layer** (`src/utils/*`)
- Low-level helpers: managed-section parsing, atomic file writes, logging
- Change-artifact logic: frontmatter parsing, status normalization, checklist extraction
- Shared across both the core engine and command handlers

**Rules Layer** (`rules/*`, `.specfuse/rules.mjs`)
- Each rule declares an `extract` → `transform` pipeline
- Rules are loaded by the rule-loader and executed by the sync engine
- Built-in rules live in the `rules/` directory; user plugins in `.specfuse/rules.mjs`

---

## Data Flow: Two-Pass Sync

The central data flow in SpecFuse is the **two-pass sync**, which keeps artifacts synchronized without manual intervention.

```
Pass A (Inbound → Constitution)
─────────────────────────────────
.specfuse/plan/prd.md          ──┐
.specfuse/plan/architecture.md ──┤
.specfuse/plan/design/system.md──┤  extract + transform
.specfuse/plan/stories/         ──┤  ──────────────────→  .specfuse/constitution.md
.specfuse/changes/archive/      ──┘     (managed sections)

                        ↓ Constitution settled

Pass B (Constitution → Outbound)
─────────────────────────────────
.specfuse/constitution.md  ──── extract + transform
                                ──────────────────→  .specfuse/changes/*/proposal.md
                                                      (constitutional headers)
```

### Why Two Passes?

Pass A gathers all planning decisions, stories, and archived features into the constitution. Only after Pass A completes does Pass B read the settled constitution and inject its constraints into active change proposals. This ordering ensures that every change proposal sees a **fully consistent** set of constitutional rules — not a partially-updated constitution.

If any Pass A rule fails, Pass B is skipped entirely to prevent writing stale headers into change proposals.

### Sync State Tracking

After each rule execution, the `Registry` records:

- `sourceHash` — SHA-256 of the source artifact content
- `targetHash` — SHA-256 of the managed section content
- `syncedAt` — timestamp

This enables drift detection: by comparing current hashes against the last-synced hashes, SpecFuse can determine whether a source changed, a target was manually edited, or both changed independently.

---

## Managed Section Protocol

All SpecFuse-generated content lives inside **managed section markers** — HTML comment delimiters that wrap a named section within a Markdown file.

```markdown
<!-- specfuse:section-name:start -->
> Auto-synced content managed by SpecFuse
...
<!-- specfuse:section-name:end -->
```

### Operations

- **Upsert** (`upsertManagedSection`): If the section exists, replace its content. If not, append it at the end of the file under a `## [SpecFuse Managed] section-name` heading.
- **Read** (`readManagedSection`): Extract the content between markers.
- **Strip** (`stripManagedSections`): Remove all managed sections from a document, leaving only user-authored content.

### Design Rationale

Managed markers allow SpecFuse to coexist with human edits. Content inside markers is overwritten on sync; content outside markers is never touched. This avoids the need for separate stores, JSON side-files, or database-backed artifact tracking — the Markdown file itself is the single source of truth, with SpecFuse content clearly delineated.

---

## Rule-Based Architecture

Each sync rule conforms to the `SyncRule` interface:

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique rule identifier (e.g. `plan:arch→constitution:plan-decisions`) |
| `pass` | `'A' \| 'B'` | Which sync pass this rule runs in |
| `source` | `string` | Logical source path (registry key) |
| `target` | `string` | Target file path |
| `section` | `string` | Managed section name in the target |
| `extract` | `async (ctx) → data \| null` | Reads source artifacts; returns null if missing |
| `transform` | `(data, ctx) → string` | Converts extracted data into managed-section content |
| `isMultiTarget` | `boolean` | Whether this rule writes to multiple target files |
| `resolveTargets` | `async (ctx) → string[]` | Resolves all target file paths (for multi-target rules) |

### Rule Context (`RuleContext`)

Rules do not access the filesystem or registry directly. Instead, they receive a frozen context object with a constrained API:

- `ctx.read(path)` — read a project file
- `ctx.listFiles(dir, ext)` — list files in a directory
- `ctx.extractH2Section`, `ctx.extractH2SectionAny`, `ctx.extractAllH2Sections` — Markdown section extraction
- `ctx.contentToRules` — convert Markdown content to a bullet list
- `ctx.hashContent` — compute a SHA-256 hash
- `ctx.today()` — current date string

This isolation ensures rules are deterministic, side-effect-free, and safe for CI environments.

### Built-in Rules

| Rule | Pass | Source → Target | Section |
|---|---|---|---|
| `plan:arch→constitution:plan-decisions` | A | architecture.md → constitution.md | `plan-decisions` |
| `plan:prd→constitution:plan-prd` | A | prd.md → constitution.md | `plan-prd` |
| `plan:design-system→constitution:design-constraints` | A | design/system.md → constitution.md | `design-constraints` |
| `plan:stories→constitution:user-stories` | A | stories/ → constitution.md | `user-stories` |
| `changes:archive→constitution:implemented-features` | A | changes/archive/ → constitution.md | `implemented-features` |
| `constitution→changes:proposal-headers` | B | constitution.md → changes/*/proposal.md | `constitution-header` |

### User Plugin Rules

Users can define custom rules in `.specfuse/rules.mjs`. Plugin rules are loaded after built-in rules and must pass the same validation (required fields: `id`, `pass`, `source`, `target`, `section`, `extract`, `transform`). In CI environments, plugin rules are skipped unless `--allow-plugins` is set.

---

## Phase Lifecycle

SpecFuse projects progress through four lifecycle phases, detected automatically from the `.specfuse/` directory structure:

```
unknown → planning → feature-dev → maintenance
```

| Phase | Detection Condition | Meaning |
|---|---|---|
| **unknown** | No SpecFuse artifacts found | Project has not been initialized; run `specfuse init` |
| **planning** | `.specfuse/plan/` has content, no constitution yet | Building the planning baseline (PRD, architecture, stories) |
| **feature-dev** | Constitution exists, no archived changes | Constitution active; creating change proposals |
| **maintenance** | Archived changes exist, constitution exists | Delivering changes and archiving completed work |

Phase detection is performed by `detectPhase()` in `src/core/phase-detector.js`, which checks for the presence of key files and directories. The detected phase is stored in `registry.json` and used by the `guide` command to provide phase-aware next steps.

---

## Change Proposal Lifecycle

Each change proposal follows a defined state progression:

```
draft → active → reviewed → verified → archived
```

| State | Condition | Description |
|---|---|---|
| **draft** | Initial state after `specfuse change new` | Proposal, design, and tasks templates created |
| **active** | Default state (frontmatter) | Change is being worked on |
| **reviewed** | Review status = `approved` | Review checklist completed and approved |
| **verified** | Verify status = `pass` | All acceptance criteria confirmed |
| **archived** | Moved to `changes/archive/` by `specfuse change archive` | Completed and stored in archive |

### Change Directory Structure

Each active change lives in `.specfuse/changes/<slug>/` with five artifacts:

```
.specfuse/changes/add-login/
├── proposal.md    — What and why (overview, scope, acceptance criteria)
├── design.md      — How (technical design, UI impact assessment)
├── tasks.md       — Implementation task breakdown
├── review.md      — Review checklist (generated on demand)
└── verify.md      — Verification checklist (generated on demand)
```

### Archival Gate

`specfuse change archive` requires verification to pass (`verify.md` frontmatter `status: pass`) unless `--force` is used. On archival, the change is moved to `.specfuse/changes/archive/YYYY-MM-DD-<slug>/` and the active directory is removed. The next sync will update the constitution's `[implemented-features]` section.

---

## Key Module Map

| Module | Path | Responsibility |
|---|---|---|
| **CLI** | `src/cli.js` | Command definitions, argument parsing, help text, error suggestions |
| **Registry** | `src/core/registry.js` | Project state persistence (`registry.json`), artifact path resolution, sync record tracking, phase storage |
| **Sync Engine** | `src/core/sync-engine.js` | Two-pass rule execution, atomic file writes, multi-target handling |
| **Differ** | `src/core/differ.js` | Preview sync changes without writing files (in-memory simulation) |
| **Drift Detector** | `src/core/drift-detector.js` | Compare current hashes against last-synced hashes; report drift states |
| **Phase Detector** | `src/core/phase-detector.js` | Auto-detect project lifecycle phase from directory structure |
| **Workflow Advice** | `src/core/workflow-advice.js` | Phase-aware guidance (recommended commands per phase) |
| **Rule Loader** | `src/core/rule-loader.js` | Load built-in rules and user plugins; validate rule interfaces |
| **Rule Context** | `src/core/rule-context.js` | Frozen context API for rule `extract`/`transform` functions |
| **Artifact Schema** | `src/core/artifact-schema.js` | Load/validate/apply custom generation instructions per artifact type |
| **Markdown** | `src/utils/markdown.js` | Managed-section CRUD, H2 section extraction, hashing, content-to-rules conversion |
| **Change Artifacts** | `src/utils/change-artifacts.js` | Frontmatter parsing, status normalization, checklist extraction, UI impact detection |
| **FileSystem** | `src/utils/fs.js` | Atomic writes, safe reads, directory listing, path existence checks |
| **Logger** | `src/utils/logger.js` | Colored, icon-prefixed console output with debug mode |
| **Programmatic API** | `src/api.mjs` | Public API surface: `sync`, `drift`, `diff`, `status`, `phase` |
| **Built-in Rules** | `rules/plan-to-constitution.rule.mjs` | Pass A rules: plan artifacts → constitution |
| **Built-in Rules** | `rules/changes-and-stories.rule.mjs` | Pass A/B rules: stories, archive → constitution; constitution → change proposals |

---

## Drift Detection States

The `specfuse drift` command reports the state of each tracked artifact pair:

| State | Meaning | Remediation |
|---|---|---|
| `IN_SYNC` | Source and target match last-synced hashes | No action needed |
| `SOURCE_CHANGED` | Source was modified since last sync | Run `specfuse sync` |
| `TARGET_CHANGED` | Managed section was manually edited | Move edits outside managed markers, then sync |
| `BOTH_CHANGED` | Both source and target changed independently | Move manual edits outside markers, then sync |
| `NEVER_SYNCED` | This pair has never been synced | Run `specfuse sync` |
| `SOURCE_MISSING` | Source artifact does not exist | Create the source artifact first |

---

## Artifact Schema

The optional `.specfuse/artifact-schema.json` allows teams to customize generation instructions before creating artifacts. Each key (e.g. `change.proposal`, `plan.story`) can carry a list of instruction strings that are appended to the generated template as a `## Custom Instructions (Schema)` section.

Wildcard keys like `change.*` apply their instructions to all `change.*` sub-keys. Exact keys take precedence over wildcards.

---

## Watch Mode

`specfuse watch` uses `chokidar` to observe file changes under `.specfuse/plan/` and `.specfuse/changes/`. Within 400ms of a modification, it triggers a full sync cycle. This provides near-real-time synchronization during active development sessions.

---

## Git Hook Integration

`specfuse install-hooks` installs two git hooks:

- **Pre-commit**: runs `specfuse drift --fail` — exits 1 if any drift is detected, blocking commits with stale specs
- **Post-commit**: runs `specfuse sync` — automatically updates all managed sections after each commit

Hooks are removed by `specfuse uninstall-hooks`.
