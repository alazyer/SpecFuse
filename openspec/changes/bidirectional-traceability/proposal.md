## Why

SpecFuse's sync engine flows data in one direction: plan artifacts → constitution → change proposals. There is no way to trace **which change implemented which story**, or **which stories remain unimplemented**. Teams lose visibility into feature coverage over time — the constitution's `[user-stories]` section lists stories, and `[implemented-features]` lists archived changes, but the two are disconnected. A bidirectional traceability layer is needed to link stories ↔ changes ↔ archive and surface coverage gaps.

## What Changes

- Add `stories:` frontmatter field to `proposal.md` template so proposals can reference the story IDs they implement
- Add `specfuse trace` command that shows the traceability matrix: which stories have active changes, which are implemented (linked to archived changes), and which have no changes yet (coverage gaps)
- Add `specfuse trace --coverage` flag for a summary report: N/M stories have active or archived changes, X stories are uncovered
- Auto-detect story references in proposals during `specfuse sync` and record the links in `registry.json` under a new `traces` key
- When a change is archived, mark linked stories as "implemented" in the trace data

## Capabilities

### New Capabilities
- `traceability`: Core traceability engine — computes story-to-change mappings, coverage metrics, and manages trace link lifecycle (record, mark-implemented, query)
- `trace-command`: CLI command for `specfuse trace` and `specfuse trace --coverage` — displays traceability matrix and coverage report

### Modified Capabilities
- `registry`: Add `traces` storage key to persist story↔change links in registry.json
- `sync-engine`: Auto-detect `stories:` frontmatter in proposals and record trace links during sync
- `change-archive`: Mark linked stories as "implemented" when a change is archived

## Impact

- **Files created**: `src/core/traceability.js`, `src/commands/trace.js`, `src/tests/trace.test.js`
- **Files modified**: `src/core/registry.js`, `src/core/sync-engine.js`, `src/cli.js`, `src/commands/change/index.js`, `templates/change/proposal.md`
- **Registry schema**: New `traces` key in `registry.json` (non-breaking — absent key treated as empty)
- **Template**: `proposal.md` gains optional `stories:` frontmatter field (backward-compatible — existing proposals without it work unchanged)
- **No breaking changes**: All new behavior is additive and degrades gracefully when `stories:` is absent
