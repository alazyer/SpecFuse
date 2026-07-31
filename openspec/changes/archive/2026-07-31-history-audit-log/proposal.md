---
status: active
created: 2026-07-28
---

# Change Proposal: History and Audit Log

## Overview

Add a `specfuse history` command that shows a chronological log of sync operations, archives, and other significant events. This provides visibility into what changed, when, and why.

## Problem

1. **No visibility** — Users cannot see what sync did over time, only the current state
2. **No audit trail** — No record of who archived what change and when
3. **No debugging** — When something goes wrong, no way to see what operations led to the current state
4. **No metrics** — Cannot answer "how many syncs this week?" or "when was this story implemented?"

## Scope

**In scope:**
- `specfuse history` — Show recent events (syncs, archives, validations)
- `specfuse history sync` — Show sync history only
- `specfuse history archive` — Show archive history only
- `specfuse history --since <date>` — Filter by date range
- `specfuse history --json` — Machine-readable output
- Registry enhancement to store event log

**Out of scope:**
- Remote history storage
- History export/import
- Undo/redo functionality

## Acceptance Criteria

- [ ] After running `specfuse sync`, a history entry is recorded with timestamp, operation type, and summary
- [ ] After running `specfuse change archive <name>`, a history entry records the archive event
- [ ] `specfuse history` shows the last 20 events by default
- [ ] `specfuse history --since 2026-07-01` shows events since that date
- [ ] `specfuse history sync` shows only sync events
- [ ] `specfuse history --json` outputs valid JSON with `{timestamp, type, summary, details}` objects
- [ ] History survives `specfuse init --force` (preserved in registry)
- [ ] History entries include: timestamp, operation type, affected artifacts, user (if available), summary

## Impact

- **Users:** Can see what operations have been performed
- **Teams:** Can track when changes were archived
- **Debugging:** Can trace issues back to specific operations

## Risks

- Registry file grows over time with history entries
- Need to balance detail vs. storage
- Clock skew in distributed teams

## Related

- Extends `src/core/registry.js` with history storage
- New command file: `src/commands/history.js`
- New test file: `src/tests/history.test.js`
