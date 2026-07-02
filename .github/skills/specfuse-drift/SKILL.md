---
name: specfuse-drift
description: |
  Detect spec drift across all tracked artifact pairs. Run before committing
  or after modifying plan artifacts or .specfuse/constitution.md.
  Triggers: "check drift", "are specs in sync", "specfuse drift"
allowed-tools: Bash, Read
---

# SpecFuse Drift v4

```bash
specfuse drift          # Human-readable drift report
specfuse drift --json   # Machine-readable JSON
specfuse drift --fail   # Exit code 1 if any drift (CI gate)
```

## Drift states

| State | Meaning | Action |
|-------|---------|--------|
| IN_SYNC | Current | None needed |
| SOURCE_CHANGED | Plan artifact edited after last sync | `specfuse sync` |
| TARGET_CHANGED | Managed section manually edited | Move edits outside markers |
| NEVER_SYNCED | Artifact exists but never synced | `specfuse sync` |
| SOURCE_MISSING | Plan artifact not yet created | `specfuse plan prd/arch/story` |

## Artifact pairs tracked
- `.specfuse/plan/architecture.md` → `.specfuse/constitution.md [plan-decisions]`
- `.specfuse/plan/prd.md` → `.specfuse/constitution.md [plan-prd]`
- `.specfuse/plan/stories/` → `.specfuse/constitution.md [user-stories]`
- `.specfuse/changes/archive/` → `.specfuse/constitution.md [implemented-features]`
- `.specfuse/constitution.md` → `.specfuse/changes/*/proposal.md [constitution-header]`

## Best practice

- Run drift after sync-sensitive edits
- Use `--fail` in CI to block stale managed content
