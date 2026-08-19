## Context

The sweep request asks Stage 1 to convert weaknesses from a referenced comment into a specification package. The assigned issue and parent issue had no visible comments, so the source weakness list could not be recovered from the Multica timeline. Current code reality still exposes clear weakness clusters:

- **W1: Artifact location consistency** — the product positions `.specfuse/` as the native workspace, but OpenSpec specs and archives live under `openspec/`, command messages still mention `openspec/changes/`, and code comments in `registry.js` contradict the actual constitution path. This makes artifact ownership harder for users, tools, and agents to reason about.
- **W2: Command/API/core seam deepening** — CLI command modules and API modules often implement parallel versions of workflow behavior. Some CLI modules own business logic and presentation together, while API modules re-create similar flows with typed errors. That weakens locality and raises drift risk.
- **W3: Failure and observability contracts** — several modules convert missing/corrupt/invalid state into empty lists, logged warnings, message-text sentinels, or process exits. This makes automation infer outcomes from prose and makes failure handling inconsistent across CLI and API surfaces.

## Goals / Non-Goals

**Goals:**

- Create implementation-ready requirements and scenarios for W1, W2, and W3.
- Keep the target architecture aligned with SpecFuse's existing layered model: CLI presentation, programmatic API, core engine, utilities, and rules.
- Preserve user-authored Markdown and existing managed-section semantics.
- Require Planner tasks to map every implementation step to a weakness ID and a capability requirement.
- Make verification possible through targeted unit/integration tests and JSON/API assertions.

**Non-Goals:**

- No application implementation code in this Stage 1 artifact package.
- No migration from `.specfuse/` to only `openspec/`, or from `openspec/` to only `.specfuse/`, without a Planner-approved compatibility path.
- No new external dependencies, persistent database, or remote service.
- No broad rewrite of the CLI or all API modules at once; changes should be incremental and bounded by the three weakness clusters.
- No UI/visual design changes beyond terminal/API output semantics.

## Decisions

### D1: Treat `.specfuse/` as the product-native workspace and `openspec/` as spec-governance compatibility

**Decision**: The remediation SHALL not blur product artifacts and governance artifacts. Runtime SpecFuse commands continue to operate on `.specfuse/`, while OpenSpec artifacts remain under `openspec/` for this repository's planning/spec workflow. User-facing messages and registry path comments must name the correct root for the operation being described.

**Rationale**: The README and native CLI already establish `.specfuse/` as the product workspace. The repository also uses OpenSpec to govern changes. Preserving both avoids a risky migration while requiring messages, docs, and diagnostics to be explicit.

**Alternative considered**: Collapse all artifacts into one root. Rejected for this sweep because it would be a migration project, not a focused weakness remediation.

### D2: Deepen workflow behavior behind core modules before thinning CLI/API surfaces

**Decision**: Shared workflow behavior should move behind core modules or existing utility modules before CLI/API callers are changed. CLI modules should become presentation adapters; API modules should become structured adapters that call the same underlying module.

**Rationale**: One adapter is a hypothetical seam; two adapters make the seam real. SpecFuse already has CLI and API adapters for many workflows, but the behavior is not consistently behind a deep module. Core-first extraction increases locality and reduces behavior drift.

**Alternative considered**: Patch individual CLI/API differences in place. Rejected because it preserves the shallow-module problem and makes future changes harder to verify.

### D3: Structured result state is the source of truth; prose messages are presentation

**Decision**: Sync, lint, batch, change, and diagnostic flows should return structured states such as `changed`, `skipped`, `conflicted`, `failed`, and machine-readable codes. Human-readable messages may still exist, but code must not infer failure by matching message prefixes.

**Rationale**: Current sync pass failure detection checks whether a message starts with `Error:`. That couples control flow to prose and makes localization/output edits risky. Structured states improve CLI/API parity and testability.

**Alternative considered**: Keep message matching and add tests around the exact string. Rejected because it cements the weakness instead of remediating it.

### D4: Missing or corrupt optional state may degrade, but the degradation must be observable

**Decision**: Optional directories can still produce empty results, but user-facing and API surfaces must distinguish "none found" from "source unavailable/corrupt/unreadable" when the operation depends on that distinction.

**Rationale**: SpecFuse intentionally supports incremental project setup. The architecture should not make missing optional directories fatal, but it should not hide meaningful corruption, permissions problems, or path-model mismatches.

**Alternative considered**: Fail fast for every missing artifact. Rejected because it would break the existing onboarding flow and optional-artifact model.

## Risks / Trade-offs

- **[Risk] Scope creep across many modules** -> Mitigation: Planner must sequence by weakness cluster and require file ownership boundaries for each step.
- **[Risk] Existing tests may assert current prose output** -> Mitigation: Keep human text stable when possible; add/adjust JSON and API assertions first.
- **[Risk] Artifact-root terminology remains confusing because both `.specfuse/` and `openspec/` are valid in this repo** -> Mitigation: Specs require operation-specific root labels and explicit compatibility notes.
- **[Risk] Core extraction can create pass-through modules** -> Mitigation: Apply the deletion test: a new module is acceptable only if deleting it would force business rules back into multiple adapters.
- **[Risk] Missing referenced comment may omit intended weaknesses** -> Mitigation: Keep an explicit open question and require Planner to merge any recovered weakness list before implementation begins.

## Migration Plan

1. Planner should first confirm whether the missing referenced comment can be recovered. If recovered, merge its weakness IDs into this package before implementation.
2. Implement low-risk terminology and diagnostics fixes before deeper module extraction.
3. Introduce structured result fields alongside existing messages to avoid breaking CLI output.
4. Refactor one workflow surface at a time so CLI and API adapters can be tested against the same core behavior.
5. Update docs/specs only after behavior contracts are implemented and verified.

## Open Questions

- The triggering weakness comment/thread was not visible in the assigned issue or parent issue history. Does the Orchestrator have the original weakness list, and should it supersede or augment W1-W3?
- Should compatibility between `.specfuse/changes` and `openspec/changes` be documented only for this repository, or should SpecFuse expose a product-level compatibility command?
- Should CLI non-JSON exit-code behavior change when partial sync/lint results include skipped work, or should stricter failure remain confined to existing flags and JSON/API consumers?

