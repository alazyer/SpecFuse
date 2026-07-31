## Context

SpecFuse v4 manages plan artifacts (PRD, architecture, stories), a constitution, and change proposals. The sync engine extracts content from plan artifacts, merges it into the constitution, and then injects constitutional constraints into change proposal headers. However, there is no link between **which change implements which story** — stories live under `.specfuse/plan/stories/` and changes live under `.specfuse/changes/`, with no cross-reference.

The existing `registry.json` already stores sync records (`sourceHash`/`targetHash` pairs) and artifact metadata. This is the natural place to store trace links.

Current data flow:
1. Stories created via `specfuse plan story` → stored in `.specfuse/plan/stories/STORY-*.md`
2. Changes created via `specfuse change new` → stored in `.specfuse/changes/<name>/`
3. Sync runs extract stories → constitution, constitution → change headers
4. Archive moves changes to `.specfuse/changes/archive/YYYY-MM-DD-<name>/`

The gap: no way to know which stories have active changes, which are implemented, or which are uncovered.

## Goals / Non-Goals

**Goals:**
- Link stories to change proposals via `stories:` frontmatter in proposal.md
- Store trace links in `registry.json` under a `traces` key
- Provide `specfuse trace` command to display the traceability matrix
- Provide `specfuse trace --coverage` for a concise coverage summary
- Auto-detect story references during `specfuse sync` and record trace links
- Mark linked stories as "implemented" when a change is archived

**Non-Goals:**
- Partial story coverage (a story is either covered or not — no percentage tracking)
- Trace links across projects (single project scope)
- Custom trace link types (only story↔change for now)
- UI/dashboard for traceability (CLI-only for this change)

## Decisions

### D1: Store trace links in `registry.json` under `traces` key

**Choice**: Add a `traces` object to `registry.json` keyed by story ID.

**Rationale**: Registry already stores sync state and artifact metadata. Adding traces here keeps all SpecFuse state in one place and avoids introducing a new file. The registry is already loaded/saved by sync and archive flows.

**Alternatives considered**:
- Separate `traceability.json` file: adds another file to manage, redundant with registry lifecycle
- Inline in proposal frontmatter only: no aggregate view, requires scanning all proposals to build matrix

**Structure**:
```json
{
  "traces": {
    "STORY-001": {
      "active": ["add-login"],
      "implemented": false
    },
    "STORY-003": {
      "active": ["add-login", "user-profiles"],
      "implemented": true,
      "implementedBy": "2026-07-08-add-login"
    }
  }
}
```

### D2: `stories:` frontmatter field in proposal.md template

**Choice**: Add optional `stories: ~` field (default null/empty) to the proposal template.

**Rationale**: Frontmatter is already parsed by `parseFrontmatterDocument()` in `change-artifacts.js`. Setting default to `~` (null) keeps backward compatibility — existing proposals without the field continue to work.

**Format**: Comma-separated story IDs, e.g., `stories: STORY-001, STORY-003`

### D3: Auto-detection during sync (not a separate command)

**Choice**: Scan active change proposals for `stories:` frontmatter during `specfuse sync` and record links.

**Rationale**: Sync already iterates over active changes for multi-target rules. Adding trace link recording here ensures the registry stays current without requiring a separate "rebuild traces" step. The trace link recording is a lightweight operation (parse frontmatter, update registry).

### D4: Mark stories "implemented" on archive

**Choice**: When `changeArchive` runs, look up the proposal's `stories:` field, and for each story ID, set `implemented: true` and `implementedBy` in the traces record.

**Rationale**: Archive is the natural moment when a change transitions from "active" to "done". Moving a story from `active` to `implemented` at this point keeps the trace data consistent with the change lifecycle.

### D5: Separate `traceability.js` core module

**Choice**: Create a dedicated `src/core/traceability.js` module with pure functions for building the trace matrix and coverage report.

**Rationale**: Keeps the trace logic testable and separate from both the CLI command and the sync/archive integration. The command file (`trace.js`) handles formatting, while the core module handles data computation.

## Risks / Trade-offs

- **[Stale traces if sync not run]** → Trace links are only updated during sync or archive. If someone edits `stories:` frontmatter manually without running sync, traces may be stale. Mitigation: `specfuse trace` always re-scans proposals on disk (not just registry) to compute the live matrix, treating registry traces as a cache for "implemented" status only.
- **[Story ID typos]** → No validation that story IDs in `stories:` frontmatter actually exist in `.specfuse/plan/stories/`. Mitigation: `specfuse trace` reports unknown story IDs as warnings.
- **[Registry schema bump]** → Adding `traces` is non-breaking (absent key = empty traces), so no schema version bump needed. The `_migrate()` function handles missing keys gracefully.
