## Why

SpecFuse has accumulated architecture weaknesses that make future changes harder to plan safely: the same workflow behavior is split across CLI, API, core, utility, and two artifact roots, while several failure paths rely on console/process behavior or success-shaped skip states. The referenced weakness comment was not present in the issue or parent comment history, so this package reconciles the sweep request against current code reality and flags that missing source as an open question for the Planner.

## What Changes

- Define a remediation contract for **W1: artifact location consistency** so active and archived change/spec artifacts use one canonical workspace model, and diagnostics expose mismatches instead of hiding them.
- Define a remediation contract for **W2: command/API/core seam deepening** so CLI handlers and programmatic API functions share behavior through deep core modules rather than duplicating workflow logic.
- Define a remediation contract for **W3: failure and observability contracts** so user-facing commands, programmatic APIs, and sync/lint/list operations expose structured, testable error and warning states without broad silent fallbacks.
- Require acceptance criteria and validation evidence to map back to weakness IDs, so later planning, implementation, and verification can trace each fix to the sweep goal.
- Preserve existing CLI behavior unless the spec explicitly calls out a behavior change; no dependency or data-store changes are required.

## Capabilities

### New Capabilities

- `artifact-location-consistency`: Ensures SpecFuse has a single canonical artifact-location contract for active changes, archived changes, OpenSpec compatibility artifacts, diagnostics, and user-facing messages.
- `workflow-surface-seams`: Ensures workflow behavior sits behind deep core interfaces that both CLI commands and programmatic APIs can reuse without presentation leakage or duplicated business rules.
- `failure-observability-contracts`: Ensures operational failures, skipped work, and degraded states are structured, visible, and consistent across CLI and API surfaces.

### Modified Capabilities

- `sync-engine`: Strengthens sync-result semantics so skipped, conflicted, and failed rules are distinguishable by state rather than inferred from message text.
- `registry`: Strengthens registry/artifact path reporting so consumers can identify canonical artifact roots and inconsistent legacy locations.

## Impact

- **Core modules**: `src/core/registry.js`, `src/core/sync-engine.js`, `src/core/drift-detector.js`, `src/core/rule-loader.js`, `src/core/workflow-advice.js`, `src/core/linter.js`
- **Command modules**: `src/commands/change/index.js`, `src/commands/batch.js`, `src/commands/sync.js`, `src/commands/drift.js`, `src/commands/lint.js`, `src/commands/guide.js`
- **API modules**: `src/api/change.mjs`, `src/api/batch.mjs`, `src/api/sync-ops.mjs`, `src/api/errors.mjs`, related namespaced API modules where behavior is duplicated
- **Docs/specs**: `docs/architecture.md`, README workflow references, OpenSpec specs for the new and modified capabilities
- **Dependencies**: None expected
- **Breaking behavior**: None intended; any proposal to change command exit codes or output shapes must be gated behind existing JSON/programmatic contracts or explicitly documented by the Planner

