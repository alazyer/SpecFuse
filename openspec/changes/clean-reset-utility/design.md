# Design: Clean and Reset Utility

## Architecture

### Orphan Detection

An orphan is a file or registry entry that is no longer referenced by any rule:

1. **Orphaned files:** Files in `.specfuse/` not tracked by any rule
2. **Orphaned entries:** Registry syncs/traces for non-existent artifacts
3. **Empty directories:** Directories with no files (except `archive/`)

### Clean Operations

| Operation | Description | Destructive |
|-----------|-------------|-------------|
| `clean registry` | Remove stale sync/trace entries | Yes |
| `clean orphans` | Remove untracked files | Yes |
| `clean empty-dirs` | Remove empty directories | Yes |
| `clean all` | All of the above | Yes |

### Reset Operations

| Operation | Description | Preserves |
|-----------|-------------|-----------|
| `reset` | Clear sync state, traces | plan/, archive/ |
| `reset --hard` | Remove all artifacts | .specfuse/ dir |

### New Files

1. **`src/commands/clean.js`** — Clean/reset CLI handlers
2. **`src/core/orphan-detector.js`** — Orphan detection logic
3. **`src/api/clean.mjs`** — Programmatic API

### CLI Design

```
specfuse clean [--dry-run] [--registry] [--orphans] [--json]
specfuse reset [--hard] [--dry-run] [--json]

Options:
  --dry-run    Show what would be done without doing it
  --force      Skip confirmation prompt
```

### Dry Run Output

```
Would remove:
  - registry sync entry: plan:old-artifact→constitution (source missing)
  - registry trace entry: STORY-999 (story file not found)
  - empty directory: .specfuse/changes/empty-change/

Total: 3 items
Run without --dry-run to apply.
```

## Implementation Notes

1. **Safety:** Default behavior requires `--force` or interactive confirmation.

2. **Logging:** All clean operations are logged to history before execution.

3. **Dry run:** `--dry-run` is the default for `reset` commands.

4. **Selective:** User can clean specific categories with flags.

5. **Preservation:** `reset` always preserves `plan/` and `archive/` unless `--hard`.

### Orphan Detection Algorithm

```
1. Scan all files under .specfuse/
2. For each file, check if any rule has it as source or target
3. If no rule references it → orphan
4. Scan registry.syncs for entries where source/target no longer exists
5. Scan registry.traces for entries where story file no longer exists
```
