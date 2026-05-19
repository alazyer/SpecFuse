# SpecFuse

> Self-contained Spec-Driven Development for planning, constitution management, and change delivery.

SpecFuse is a Node.js CLI for running a complete spec-driven workflow **without external BMAD, Spec-Kit, or OpenSpec dependencies**.

It gives you a native workflow for:

- planning with PRDs, architecture docs, design system docs, flows, screen specs, and user stories
- maintaining a project constitution as the source of truth
- creating and archiving change proposals with review and verification artifacts
- keeping artifacts synchronized with two-pass sync and drift detection

## Why SpecFuse exists

SpecFuse v4 turns the ideas behind multi-tool spec workflows into a **single local system**.

Instead of stitching together separate tools, SpecFuse keeps everything in one place:

- planning artifacts in `.specfuse/plan/`
- change proposals in `.specfuse/changes/`
- sync state in `.specfuse/registry.json`
- constitutional rules in `.specfuse/constitution.md`

Managed sections are updated automatically, while user-authored content outside managed markers stays yours.

## Features

- **Self-contained workflow** — no external SDD CLI required
- **Planning commands** — create PRD, architecture docs, design artifacts, and user stories
- **Constitution management** — generate, inspect, and extend project rules
- **Change workflow** — create proposal/design/tasks bundles, generate review/verify artifacts, and archive completed work with a verification gate
- **Two-pass sync engine** — plan/archive artifacts flow into the constitution, then constitutional constraints flow into active change proposals
- **Drift detection** — find stale or manually edited managed sections
- **Live watch mode** — auto-sync on file changes
- **Git hook support** — pre-commit drift checks and post-commit sync
- **Programmatic API** — import `specfuse/api.mjs`

## Requirements

- **Node.js** `>=20`
- **pnpm** recommended for local development

## Install

### Use from source

```bash
pnpm install
pnpm test
pnpm dev -- --help
```

### Global CLI usage

If you publish or install it globally, the binary is:

```bash
specfuse
```

## Quick start

```bash
specfuse init --name "My Project"
specfuse plan prd && specfuse plan arch
specfuse specify init && specfuse sync
```

Use `specfuse guide --persona <new-user|planner|developer|qa>` (or `specfuse start`) any time to get phase-aware next steps tailored to your role.
Add `--json` when you want machine-readable onboarding guidance for editor/agent workflows.

## Workflow overview

### 1. Initialize a project

```bash
specfuse init --name "My Project"
```

This scaffolds the internal workspace layout:

```text
.specfuse/
├── plan/
│   ├── prd.md
│   ├── architecture.md
│   ├── design/
│   │   ├── system.md
│   │   ├── flows/
│   │   └── screens/
│   └── stories/
├── changes/
│   └── archive/
├── constitution.md      (created by `specfuse specify init`)
├── registry.json
└── rules.mjs
```

## 2. Plan

Create and manage planning artifacts:

```bash
specfuse plan prd --name "My Project"
specfuse plan arch
specfuse plan design system
specfuse plan design flow "Checkout happy path"
specfuse plan design screen "Checkout summary"
specfuse plan story "Checkout"
specfuse plan list
```

Planning artifacts live in:

- `.specfuse/plan/prd.md`
- `.specfuse/plan/architecture.md`
- `.specfuse/plan/design/system.md`
- `.specfuse/plan/design/flows/*.md`
- `.specfuse/plan/design/screens/*.md`
- `.specfuse/plan/stories/*.md`

## 3. Specify

Create and maintain the constitution:

```bash
specfuse specify init
specfuse specify add "Testing Requirements" --content "- Unit tests required for new logic"
specfuse specify show
```

The constitution lives at:

- `.specfuse/constitution.md`

## 4. Sync

Run two-pass synchronization:

```bash
specfuse sync
specfuse diff
specfuse drift
```

### Pass A

Updates the constitution from:

- `.specfuse/plan/architecture.md`
- `.specfuse/plan/design/system.md`
- `.specfuse/plan/prd.md`
- `.specfuse/plan/stories/`
- `.specfuse/changes/archive/`

### Pass B

Injects constitutional constraints into:

- `.specfuse/changes/*/proposal.md`

That means one sync keeps the constitution current **and** propagates its rules to active work.

## 5. Change workflow

Create, inspect, and archive changes:

```bash
specfuse change new "add-shopping-cart"
specfuse change review add-shopping-cart
specfuse change verify add-shopping-cart
specfuse change list
specfuse change show add-shopping-cart
specfuse change archive add-shopping-cart
specfuse sync
```

Each active change is a directory containing:

- `proposal.md`
- `design.md`
- `tasks.md`
- `review.md` (generated on demand)
- `verify.md` (generated on demand, required for verified archival)

## Command reference

### Core

- `specfuse init`
- `specfuse guide`
- `specfuse sync`
- `specfuse diff`
- `specfuse drift`
- `specfuse watch`
- `specfuse status`
- `specfuse doctor`
- `specfuse install-hooks`
- `specfuse uninstall-hooks`

Handy aliases:

- `specfuse start` → `specfuse guide`
- `specfuse check` → `specfuse drift`
- `specfuse plan ls` → `specfuse plan list`
- `specfuse change ls` → `specfuse change list`

### Planning

- `specfuse plan prd`
- `specfuse plan arch`
- `specfuse plan design system`
- `specfuse plan design flow [title]`
- `specfuse plan design screen [title]`
- `specfuse plan design list`
- `specfuse plan story [title]`
- `specfuse plan list`

### Constitution

- `specfuse specify init`
- `specfuse specify add <section>`
- `specfuse specify show`

### Changes

- `specfuse change new <name>`
- `specfuse change list`
- `specfuse change show <name>`
- `specfuse change review <name>`
- `specfuse change verify <name>`
- `specfuse change archive <name>`

## Managed sections

SpecFuse only writes inside managed markers:

```html
<!-- specfuse:section-name:start -->
...
<!-- specfuse:section-name:end -->
```

Do not edit inside those markers directly. Put custom content outside them.

## Drift states

`specfuse drift` reports the state of tracked artifact pairs:

- `IN_SYNC`
- `SOURCE_CHANGED`
- `TARGET_CHANGED`
- `BOTH_CHANGED`
- `NEVER_SYNCED`
- `SOURCE_MISSING`

## Programmatic API

SpecFuse also exports a small API:

```js
import { sync, drift, diff, status, phase } from 'specfuse/api.mjs';
```

This is useful for editor tooling, automation, or custom orchestration.

## Development

Run locally with pnpm:

```bash
pnpm install
pnpm test
node bin/specfuse.js --help
```

## Notes

- `docs/README.md` is **not required right now**. The root `README.md` is the right place for project overview, usage, and setup.
- If the docs folder grows into tutorials, design notes, or migration guides later, then adding `docs/README.md` would make sense.

## License

MIT
