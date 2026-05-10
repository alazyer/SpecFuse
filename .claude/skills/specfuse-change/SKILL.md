---
name: specfuse-change
description: |
  Create and manage change proposals — the feature development workflow.
  Replaces OpenSpec entirely. Each change is a directory under .specfuse/changes/
  containing proposal.md, design.md, and tasks.md.
  Triggers: "new change", "create change proposal", "list changes", "archive change",
  "show change", "specfuse change", "what changes are in progress"
allowed-tools: Bash, Read, Write
---

# SpecFuse Change

You are managing change proposals with SpecFuse v3. Each change is a directory
(not a flat file) under `.specfuse/changes/`.

## Commands

### Create a new change proposal
```bash
specfuse change new "add-shopping-cart"   # Creates .specfuse/changes/add-shopping-cart/
```
Creates three files automatically:
- `proposal.md` — what and why (fill in: overview, scope, acceptance criteria)
- `design.md`   — how (data model, API design, sequences)
- `tasks.md`    — implementation tasks and review checklist

### List all changes
```bash
specfuse change list    # Shows active + last 5 archived changes
```

### Show a specific change
```bash
specfuse change show add-shopping-cart    # Shows proposal content + file status
```

### Archive a completed change
```bash
specfuse change archive add-shopping-cart
# Moves to .specfuse/changes/archive/2026-04-27-add-shopping-cart/
# Run `specfuse sync` after archiving to update .specfuse/constitution.md [implemented-features]
```

## Directory structure

```
.specfuse/changes/
├── add-shopping-cart/          ← active change
│   ├── proposal.md             ← what/why + constitutional header (auto-injected)
│   ├── design.md               ← technical design
│   └── tasks.md                ← implementation tasks
└── archive/
    └── 2026-04-27-user-auth/   ← completed change (date-stamped)
        └── proposal.md
```

## Constitutional header

After `specfuse sync`, every `proposal.md` gets a `[constitution-header]` managed
section injected automatically — containing all constitutional constraints from
`.specfuse/constitution.md`. This ensures every developer building a feature can see the
rules that apply.

**Never edit content inside `<!-- specfuse:constitution-header:start/end -->`.**

## Workflow

1. `specfuse change new <n>` — create proposal
2. `specfuse sync` — inject constitutional constraints into proposal.md
3. Edit `proposal.md`, `design.md`, `tasks.md`
4. Implement the change
5. `specfuse change archive <n>` — mark as done
6. `specfuse sync` — update `.specfuse/constitution.md [implemented-features]`

## Best practice

- Create the change only after plan artifacts and constitution exist
- Always run `specfuse sync` immediately after `change new`
- Treat `proposal.md` as the high-level intent, `design.md` as the how, and `tasks.md` as the execution checklist
