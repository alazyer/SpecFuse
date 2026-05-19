---
name: specfuse-plan
description: |
  Create and manage planning artifacts — PRD, architecture doc, and user stories.
  These replace the BMAD planning workflow entirely. All artifacts live under
  .specfuse/plan/ and are synced into .specfuse/constitution.md automatically.
  Triggers: "create prd", "write architecture doc", "add user story", "plan list",
  "specfuse plan", "what stories do we have"
allowed-tools: Bash, Read, Write
---

# SpecFuse Plan

You are working with the SpecFuse v3 planning workflow. All planning artifacts
live in `.specfuse/plan/` — no external tool required.

## Commands

### Create / view PRD
```bash
specfuse plan prd                    # Create .specfuse/plan/prd.md from template
specfuse plan prd --name "MyApp"     # With project name
```

### Create / view architecture doc
```bash
specfuse plan arch    # Create .specfuse/plan/architecture.md from template
```

### Add a user story
```bash
specfuse plan story "User Authentication"   # Creates story-001-user-authentication.md
specfuse plan story "Shopping Cart"         # Creates story-002-shopping-cart.md
```

### List all plan artifacts
```bash
specfuse plan list    # Shows PRD, arch, stories with status
```

## Key sections SpecFuse syncs into `.specfuse/constitution.md`

From `architecture.md` → `[plan-decisions]`:
- `## Architectural Decisions`
- `## Tech Stack`
- `## Constraints`
- `## Security`

From `prd.md` → `[plan-prd]`:
- `## Non-Functional Requirements`
- `## Technical Constraints`

From `stories/*.md` → `[user-stories]`:
- Story titles and first 3 acceptance criteria

## After editing plan artifacts

Run `specfuse sync` to propagate into `.specfuse/constitution.md`.
Run `specfuse diff` to preview what will change before syncing.

## Best practice

- Create PRD before architecture when starting fresh
- Add at least one story before creating the first change proposal
- Finish with `specfuse sync` and `specfuse drift`

## Emoji headings are supported

BMAD-style headings like `## 🏗️ Architectural Decisions` are matched correctly.
