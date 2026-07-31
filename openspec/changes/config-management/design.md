# Design: Unified Configuration Management

## Architecture

### Config Schema

```typescript
interface SpecFuseConfig {
  // From registry.json
  registry: {
    phase: 'unknown' | 'planning' | 'feature-dev' | 'maintenance'
    projectName: string
    hooksInstalled: boolean
    maxHistory: number
  }

  // From artifact-schema.json
  schema: {
    version: number
    artifacts: Record<string, { instructions: string[] }>
  }

  // From .specfuse/rules.mjs (if exists)
  rules: {
    plugins: boolean
    pluginCount: number
    pluginIds: string[]
  }
}
```

### Config Key Notation

Keys use dot notation to navigate the schema:
- `registry.phase` → current phase
- `schema.version` → artifact schema version
- `rules.plugins` → whether plugins are loaded

### New Files

1. **`src/commands/config.js`** — CLI command handlers
2. **`src/core/config-manager.js`** — Config read/write logic
3. **`src/api/config.mjs`** — Programmatic API

### Config Sources

| Source | Keys | Mutable |
|--------|------|---------|
| `registry.json` | `registry.*` | Yes |
| `artifact-schema.json` | `schema.*` | Yes |
| `.specfuse/rules.mjs` | `rules.*` | No (file-based) |

### CLI Design

```
specfuse config list [--json]
specfuse config get <key>
specfuse config set <key> <value>
specfuse config validate [--json]
specfuse config path [--json]
```

### Validation Rules

| Key | Valid Values |
|-----|--------------|
| `registry.phase` | `unknown`, `planning`, `feature-dev`, `maintenance` |
| `schema.version` | Positive integer |
| `registry.maxHistory` | Positive integer, max 1000 |

## Implementation Notes

1. **Read-only keys:** Keys under `rules.*` are read-only (computed from rules.mjs).

2. **Type coercion:** `set` command coerces values: `"123"` → `123`, `"true"` → `true`.

3. **Validation:** `validate` checks all keys against schema before any operations.

4. **Atomic writes:** Config changes write entire file atomically.

5. **Migration:** On first use, add `maxHistory: 100` to registry if missing.
