# Design: History and Audit Log

## Architecture

### Event Log Structure

Events are stored in `registry.json` under a new `history` key:

```json
{
  "version": "4.0.0",
  "history": [
    {
      "id": "evt-001",
      "timestamp": "2026-07-28T10:30:00Z",
      "type": "sync",
      "summary": "Synced 3 rules: arch→constitution, prd→constitution, constitution→changes",
      "details": {
        "passA": { "changed": 2, "skipped": 1 },
        "passB": { "changed": 1, "skipped": 0 }
      }
    },
    {
      "id": "evt-002",
      "timestamp": "2026-07-28T11:00:00Z",
      "type": "archive",
      "summary": "Archived change: add-login",
      "details": {
        "changeName": "add-login",
        "archiveDir": "2026-07-28-add-login"
      }
    }
  ]
}
```

### Event Types

| Type | When Recorded | Details |
|------|---------------|---------|
| `init` | `specfuse init` | Project name, force flag |
| `sync` | `specfuse sync` | Rules run, changes made |
| `archive` | `specfuse change archive` | Change name, archive dir |
| `validate` | `specfuse validate` | Check counts, pass/fail |
| `drift` | `specfuse drift` | Drift states found |
| `clean` | `specfuse clean` | Items removed |

### New Files

1. **`src/commands/history.js`** — CLI command
2. **`src/core/history.js`** — History management logic
3. **`src/api/history.mjs`** — Programmatic API

### History Storage

- Events appended to registry on each operation
- Default limit: 100 events (configurable)
- Oldest events pruned when limit exceeded
- History preserved across `init --force`

### CLI Design

```
specfuse history [options]
specfuse history sync [options]
specfuse history archive [options]

Options:
  --since <date>    Show events since date
  --until <date>    Show events until date
  --limit <n>       Show last N events (default: 20)
  --json            JSON output
  --verbose         Include full details
```

## Implementation Notes

1. **Event IDs:** Sequential `evt-NNN` format, reset when history is cleared.

2. **Timestamps:** ISO 8601 format, UTC timezone.

3. **Pruning:** When `history.length > maxHistory`, remove oldest events.

4. **Performance:** History read is O(n) for filtering, O(1) for append.

5. **Migration:** On registry load, add empty `history: []` if missing.
