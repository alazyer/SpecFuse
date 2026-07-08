## Context

SpecFuse's two-pass sync engine (`sync-engine.js`) extracts content from source artifacts, transforms it, and writes it into managed sections in target files. The drift detector (`drift-detector.js`) tracks sync state per source→target pair by comparing SHA-256 hashes stored in `registry.json`. When both the source file and the managed section in the target file have changed since the last sync (`BOTH_CHANGED`), the current `specfuse sync` command silently overwrites the managed section — potentially losing intentional manual edits inside the markers.

Current data flow:
- `drift-detector.js` computes `BOTH_CHANGED` by comparing `currentSourceHash !== lastSync.sourceHash && currentTargetHash !== lastSync.targetHash`, but discards the actual content after computing the hash.
- `sync-engine.js` has no drift-state awareness — `executeRule()` always overwrites.
- `drift --json` reports the state and message but not the conflicting content.
- No `specfuse resolve` command exists.

The conflict resolution design must integrate with the existing two-pass architecture, the rule-driven sync model, and the registry-based hash tracking.

## Goals / Non-Goals

**Goals:**
- Prevent silent data loss when `specfuse sync` encounters `BOTH_CHANGED` pairs
- Provide an interactive resolution workflow (`specfuse resolve`) with three choices: accept source, keep target, merge manually
- Expose conflict content in `specfuse drift --json` for external tool integration
- Add `--force` and `--resolve` flags to `specfuse sync` for controlled override behavior
- Keep the resolver logic in a pure core module (`src/core/resolver.js`) separate from CLI interaction
- Support programmatic API (`src/api.mjs`) access to conflict resolution

**Non-Goals:**
- Automatic three-way merge (too fragile for Markdown managed sections; manual merge via `$EDITOR` is safer)
- Conflict resolution for non-`BOTH_CHANGED` states (`SOURCE_CHANGED`, `TARGET_CHANGED` have unambiguous resolutions)
- UI beyond terminal interaction (no TUI frameworks — use simple prompts via readline)
- Resolving conflicts across rules in a single invocation (one rule at a time for clarity)
- Changing the registry schema — reuse existing `recordSync` mechanism

## Decisions

### D1: Drift-state guard goes in sync-engine, not in the command layer

**Decision**: The drift check happens inside `runTwoPassSync()` (or `executeRule()`) rather than in `syncCommand()`.

**Rationale**: The programmatic API (`api.mjs`) calls `runTwoPassSync()` directly. If the guard were only in the CLI command, API consumers would still silently overwrite. Placing it in the engine ensures consistent behavior across CLI and API.

**Alternative considered**: Guard in `syncCommand` only — rejected because it leaves the API unsafe.

### D2: Enrich drift results with content at detection time

**Decision**: `checkSingleRuleDrift()` and `checkMultiTargetDrift()` return `sourceContent` and `targetContent` fields for `BOTH_CHANGED` entries.

**Rationale**: The drift detector already reads both the source file and the managed section to compute hashes. Including the content costs no additional I/O. The resolve command and `drift --json` both need this data. Computing it lazily would require re-reading files and re-extracting managed sections.

**Alternative considered**: Lazy content retrieval in the resolve command — rejected because it duplicates I/O and requires the resolve command to re-implement drift detection logic.

### D3: Resolver is a pure function module, not a class

**Decision**: `src/core/resolver.js` exports pure functions: `computeConflict(rule, driftResult)` → conflict data, `applyResolution(rule, resolution, projectRoot, registry)` → writes result and updates registry.

**Rationale**: Matches the existing pattern (drift-detector, differ, rule-context are all function-based). No stateful lifecycle needed — each resolution is a one-shot operation. The interactive CLI layer handles user prompting and calls the pure functions.

**Alternative considered**: Resolver class with state — rejected as over-engineering for a stateless operation.

### D4: Manual merge via `$EDITOR` on a temporary file

**Decision**: For the "merge manually" option, write both versions (source and target) into a single temp file with clear markers, open `$EDITOR` on it, and read back the result.

**Rationale**: Simple, portable, and follows Unix convention (`git` uses `$EDITOR` for interactive rebase, commit messages). The temp file format uses `<<<<<<< SOURCE` / `=======` / `>>>>>>> TARGET` markers similar to git conflict markers, making it familiar to developers.

**Alternative considered**: Opening two files side-by-side — rejected because it requires editor-specific configuration and is harder to automate.

### D5: Sync guard defaults to skip, not error

**Decision**: When `specfuse sync` encounters a `BOTH_CHANGED` pair, it logs a warning, skips that rule, and continues with remaining rules. Exit code remains 0 (success for the rules that did sync).

**Rationale**: Partial sync is better than no sync. Other rules may be `IN_SYNC` or `SOURCE_CHANGED` and should still be processed. The user is notified via warning output and can address conflicts separately.

**Alternative considered**: Exit with error code — rejected because it breaks CI workflows where other rules are fine and only one pair is conflicted. The `--fail` behavior on `drift` already covers the "fail if anything is wrong" use case.

### D6: `--resolve` flag runs resolver inline within sync

**Decision**: `specfuse sync --resolve` checks for `BOTH_CHANGED` pairs and, for each one, pauses to run the interactive resolver before continuing the sync pass.

**Rationale**: Allows a single-command workflow: resolve all conflicts then complete sync. The resolver runs per-conflict-rule, one at a time, before the rule executes.

**Alternative considered**: `--resolve` as a separate pre-step that only resolves then exits — rejected because it requires two commands and the user might forget the sync step.

## Risks / Trade-offs

- **[Risk] Content enrichment increases JSON output size for `drift --json`** → Mitigation: `sourceContent`/`targetContent` only included for `BOTH_CHANGED` entries, which are rare in practice. Normal drift results remain lightweight.
- **[Risk] `$EDITOR` may not be set in all environments (CI, containers)** → Mitigation: The resolve command's "merge manually" option checks for `$EDITOR`/`$VISUAL` and falls back to `vi`. In non-interactive environments (CI), the `--json` output and programmatic API provide the conflict data without requiring an editor.
- **[Risk] Backward compatibility — existing scripts that depend on `sync` overwriting `BOTH_CHANGED` pairs will break** → Mitigation: `--force` flag preserves the old behavior with an explicit opt-in. The default change is a **BREAKING** behavioral change, but it prevents data loss which is strictly better.
- **[Risk] Registry doesn't store resolution history** → Mitigation: Not needed for v1. The `recordSync` call after resolution resets the pair to `IN_SYNC` with the new hashes. If audit trail is needed later, it can be added as a separate concern.
