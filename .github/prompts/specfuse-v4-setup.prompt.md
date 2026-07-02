---
mode: agent
description: Initialize SpecFuse v4, scaffold plan/spec/change artifacts, and leave the project in a ready-to-build state with sync and drift checks completed.
---

# SpecFuse v4 — Complete Setup

Set up a fresh SpecFuse v4 workflow end-to-end. SpecFuse v4 is fully self-contained — no BMAD, Spec-Kit, or OpenSpec required.

## What to do

1. Run `specfuse init --name "<project-name>"`
2. Create or open planning artifacts:
	- `specfuse plan prd --name "<project-name>"`
	- `specfuse plan arch`
	- `specfuse plan story "<first-story>"`
3. Create the constitution with `specfuse specify init`
4. Run `specfuse sync`
5. Create the first change with `specfuse change new "<first-change>"`
6. Run `specfuse sync` again so constitutional constraints are injected into the change proposal
7. Finish with `specfuse drift` and report whether all pairs are `IN_SYNC`

## Expected outcome

- `.specfuse/plan/` contains PRD, architecture, and at least one story
- `.specfuse/constitution.md` exists and contains managed sections if plan artifacts were present
- `.specfuse/changes/<name>/` exists with `proposal.md`, `design.md`, and `tasks.md`
- active change proposal has a managed `constitution-header`
- final output includes a short summary of what was created and what still needs manual authoring

## Step 1 — Initialize

```bash
specfuse init --name "MyProject"
```

Creates:
```
.specfuse/
├── plan/           ← planning artifacts
├── changes/        ← change proposals
├── constitution.md ← project constitution / source of truth
└── registry.json   ← SpecFuse state
```

## Step 2 — Plan (replaces BMAD)

```bash
specfuse plan prd           # Create Product Requirements Doc
specfuse plan arch          # Create architecture doc
specfuse plan story "Login" # Add user story
specfuse plan list          # View all
```

All artifacts in `.specfuse/plan/`. Edit them directly in your IDE.

## Step 3 — Specify (replaces Spec-Kit)

```bash
specfuse specify init       # Create .specfuse/constitution.md from plan artifacts
specfuse specify add "Testing Requirements"  # Add custom rule section
specfuse specify show       # View current constitution
```

## Step 4 — Sync

```bash
specfuse sync               # Two-pass sync: plan → constitution → change proposals
specfuse diff               # Preview pending changes without writing
specfuse drift              # Verify all IN_SYNC
```

## Step 5 — Change (replaces OpenSpec)

```bash
specfuse change new "add-login"      # Create change proposal
specfuse sync                         # Inject constitutional constraints
# ... implement the feature ...
specfuse change archive "add-login"   # Mark done
specfuse sync                         # Update implemented-features
```

## Key facts

- All artifacts under `.specfuse/` — commit everything
- `.specfuse/constitution.md` is the single source of truth
- No external tool CLIs needed
- `specfuse watch` for live auto-sync during development
- `specfuse install-hooks` for git pre-commit/post-commit automation
