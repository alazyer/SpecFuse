## 1. Reconcile source weaknesses and artifact roots

- [ ] 1.1 Recover the missing referenced weakness comment if available, merge any additional weakness IDs into this change, and update proposal/design/specs before implementation.
- [ ] 1.2 Audit artifact-root terminology across README, docs, `src/core/registry.js`, `src/core/sync-engine.js`, `src/core/workflow-advice.js`, command help text, and command messages; map each finding to W1.
- [ ] 1.3 Define a single helper or registry-backed source for runtime artifact path labels used by diagnostics/status/guide output.
- [ ] 1.4 Update misleading hard-coded root references so native SpecFuse operations consistently name `.specfuse/` paths and OpenSpec governance operations consistently name `openspec/` paths.

## 2. Add artifact-location diagnostics

- [ ] 2.1 Add or extend a diagnostic surface that can report canonical native roots, archive roots, and unexpected non-native active change roots.
- [ ] 2.2 Add tests for valid native-only roots, mixed native/non-native roots, and archive-vs-active labeling.
- [ ] 2.3 Update docs that explain how `.specfuse/` runtime artifacts and `openspec/` governance artifacts coexist in this repository.

## 3. Deepen command/API workflow seams

- [ ] 3.1 Choose one high-leverage workflow first, preferably change create/list/review/verify/archive, and identify duplicated business rules in CLI and API modules.
- [ ] 3.2 Extract shared workflow behavior into a core or utility seam that owns slug resolution, template/schema application, status normalization, artifact reads/writes, and idempotency rules.
- [ ] 3.3 Refactor the CLI adapter to call the shared seam while preserving human-readable output and exit behavior.
- [ ] 3.4 Refactor the API adapter to call the shared seam while preserving typed errors and presentation-free behavior.
- [ ] 3.5 Add semantic parity tests comparing CLI JSON/API results or shared core results for the refactored workflow.

## 4. Structure operational outcomes

- [ ] 4.1 Extend sync rule results with a machine-readable state/code that distinguishes changed, unchanged, skipped/conflicted, forced overwrite, resolved, and failed outcomes.
- [ ] 4.2 Replace message-prefix control flow in Pass A/Pass B decisions with structured state checks.
- [ ] 4.3 Add tests for Pass A failure, Pass A skipped conflict, and mixed failure+skip behavior.
- [ ] 4.4 Extend relevant API/JSON outputs to expose structured warning/error states while preserving existing prose fields for compatibility.

## 5. Make degraded reads observable

- [ ] 5.1 Audit silent empty fallbacks in change listing, archive listing, trace recording, lint file collection, and related command/API paths; classify each as empty-valid, absent-valid, unreadable, corrupt, or invalid.
- [ ] 5.2 Update the highest-risk fallbacks so unreadable/corrupt existing state becomes a structured warning or typed error rather than the same output as an empty valid state.
- [ ] 5.3 Add targeted tests for missing optional directories versus unreadable existing directories/files.

## 6. Validate and document the sweep

- [ ] 6.1 Run targeted tests covering updated root diagnostics, seam parity, sync result states, and degraded read classification.
- [ ] 6.2 Update OpenSpec/main specs during archive so new contracts for artifact-location consistency, workflow-surface seams, failure observability, sync-engine, and registry remain queryable.
- [ ] 6.3 Document residual risks or intentionally deferred weakness items for the Verifier, including any original comment weaknesses that were not implemented.

