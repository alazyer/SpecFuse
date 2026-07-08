## Why

When `specfuse drift` reports `BOTH_CHANGED` — meaning both the source artifact and the managed section in the target file were modified independently since the last sync — the only remediation advice is "Move manual edits outside managed markers, then run `specfuse sync`." Running `specfuse sync` in this state silently overwrites the managed section with re-extracted content, potentially losing intentional edits that were placed inside the markers. There is no tooling to inspect, compare, or interactively resolve these conflicts, and no machine-readable data for external tools (editors, CI) to build their own resolution UI.

## What Changes

- **New `specfuse resolve` command** — Interactive conflict resolution for `BOTH_CHANGED` drift pairs: shows a side-by-side diff of source-extracted vs. current managed-section content, presents three resolution options (accept source / keep target / merge manually via `$EDITOR`), writes the chosen resolution, and updates the registry so the pair returns to `IN_SYNC`.
- **Safe sync guard** — `specfuse sync` SHALL warn and skip `BOTH_CHANGED` pairs by default (not silently overwrite). New `--force` flag restores the old overwrite behavior. New `--resolve` flag runs the interactive resolver before continuing sync.
- **Machine-readable conflict data** — `specfuse drift --json` SHALL include `sourceContent` and `targetContent` fields for `BOTH_CHANGED` entries, enabling external tools to present their own resolution UI.
- **New `resolver` core module** — Pure-logic conflict resolution engine (compute conflict data, apply resolution choice) separate from the interactive CLI presentation.

## Capabilities

### New Capabilities
- `conflict-resolution`: Interactive and programmatic resolution of `BOTH_CHANGED` drift conflicts, including the `specfuse resolve` command, resolver core module, and machine-readable conflict data in drift output.

### Modified Capabilities
- `sync-engine`: Sync execution SHALL check drift state per rule and skip `BOTH_CHANGED` pairs by default, with `--force` and `--resolve` flag support.

## Impact

- **Core modules**: `src/core/sync-engine.js` (add drift-state guard), `src/core/drift-detector.js` (enrich BOTH_CHANGED results with content), new `src/core/resolver.js`
- **CLI**: `src/cli.js` (register `resolve` command), new `src/commands/resolve.js`, `src/commands/sync.js` (add `--force` / `--resolve` flags)
- **API**: `src/api.mjs` — new `resolve()` export for programmatic use
- **Registry**: `src/core/registry.js` — no schema change; `recordSync` already handles state transition when resolver writes a resolution
- **Dependencies**: No new external dependencies (`diff` package already available for conflict diff generation; `child_process` for `$EDITOR` spawn is built-in)
- **Tests**: New `src/tests/resolve.test.js`; updates to `src/tests/v4.test.js` for sync guard behavior