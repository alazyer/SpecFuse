---
name: specfuse-status
description: |
  Full project dashboard — phase, artifact health, rules, drift, hooks.
  Triggers: "specfuse status", "project overview", "what phase am I in"
allowed-tools: Bash, Read
---

# SpecFuse Status v3

```bash
specfuse status    # Full dashboard
```

Shows: project name, development phase, plan artifact health, `.specfuse/constitution.md` status,
active/archived change counts, loaded sync rules, git hooks status, drift summary.

## Phases
- `planning` — plan/ has content but no constitution yet
- `feature-dev` — `.specfuse/constitution.md` exists
- `maintenance` — archive/ has completed changes
- `unknown` — run `specfuse init`

## Best practice

- Use `specfuse status` first when opening an unfamiliar repository
- Pair it with `specfuse doctor` if setup looks incomplete
