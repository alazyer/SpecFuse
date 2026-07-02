---
name: specfuse-specify
description: |
  Create and manage .specfuse/constitution.md — the single source of truth for project constraints.
  Replaces Spec-Kit entirely. Constitution is created at project root, populated from
  plan artifacts, and kept current by specfuse sync.
  Triggers: "create constitution", "update constitution", "add rule", "show constitution",
  "specfuse specify", "what are our project rules"
allowed-tools: Bash, Read, Write
---

# SpecFuse Specify

You are managing `.specfuse/constitution.md` with SpecFuse v4. This file is the single
authoritative source of constraints, standards, and architectural rules.

## Commands

### Create constitution.md (from plan artifacts if available)
```bash
specfuse specify init             # Create .specfuse/constitution.md, auto-sync from plan
specfuse specify init --force     # Recreate from template even if exists
specfuse specify init --no-sync   # Create template only, don't auto-sync
```

### Add a custom rule section
```bash
specfuse specify add "API Standards"
specfuse specify add "Testing Requirements" --content "- Unit test coverage >= 80%"
```

### View the current constitution
```bash
specfuse specify show    # Pretty-prints user sections + managed section summary
```

## Structure of `.specfuse/constitution.md`

**User-defined sections** (edit freely):
- `## Core Principles`
- `## Technical Constraints`
- `## Code Standards`
- `## Security Rules`
- `## Performance Budgets`
- Any section added via `specfuse specify add`

**SpecFuse managed sections** (auto-generated, don't edit inside markers):
- `[plan-decisions]` — from `.specfuse/plan/architecture.md`
- `[plan-prd]` — from `.specfuse/plan/prd.md`
- `[user-stories]` — from `.specfuse/plan/stories/`
- `[implemented-features]` — from `.specfuse/changes/archive/`

**Never edit inside `<!-- specfuse:*:start/end -->` markers** — changes will be
overwritten on next `specfuse sync`.

## After updating constitution

Run `specfuse sync` to propagate constitutional constraints into all active
change proposals (`.specfuse/changes/*/proposal.md`).

## Best practice

- Use `specfuse specify init` after PRD and architecture exist
- Put custom rules outside managed markers only
- Re-run `specfuse drift` after major constitutional edits
