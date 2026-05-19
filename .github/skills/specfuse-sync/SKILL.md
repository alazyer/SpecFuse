---
name: specfuse-sync
description: |
  Run SpecFuse two-pass sync — the core operation that keeps all artifacts current.
  Pass A: plan artifacts → .specfuse/constitution.md. Pass B: .specfuse/constitution.md → change proposals.
  Triggers: "sync specs", "update constitution", "specfuse sync", "push plan decisions"
allowed-tools: Bash, Read
---

# SpecFuse Sync v3

Runs the two-pass sync engine. No external tools required.

## Command
```bash
specfuse sync                              # Run all 5 rules
specfuse sync --rule plan:arch→constitution:plan-decisions   # Single rule
```

## What runs

**Pass A (inbound → `.specfuse/constitution.md`):**
1. `.specfuse/plan/architecture.md` → `.specfuse/constitution.md [plan-decisions]`
2. `.specfuse/plan/prd.md`          → `.specfuse/constitution.md [plan-prd]`
3. `.specfuse/plan/stories/`        → `.specfuse/constitution.md [user-stories]`
4. `.specfuse/changes/archive/`     → `.specfuse/constitution.md [implemented-features]`

**Pass B (outbound — constitution →):**
5. `.specfuse/constitution.md` → `.specfuse/changes/*/proposal.md [constitution-header]`

Pass B always sees a fully-settled constitution from Pass A — no two-sync lag.

## After archiving a change
Always run `specfuse sync` after `specfuse change archive` to update `[implemented-features]`.

## Verify
```bash
specfuse drift    # All pairs should show IN_SYNC after one sync
```

## Best practice

- Run `specfuse diff` before sync if you want a preview
- Run `specfuse drift` after sync if you need verification
- Re-run sync after creating or archiving a change
