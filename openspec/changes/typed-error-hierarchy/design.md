# Design — Typed Error Hierarchy

## Context

`src/api/errors.mjs` already defines a `SpecFuseApiError extends Error` hierarchy and documents the contract that API functions throw subclasses of it. ~15 call sites across core and the API layer itself violate this by throwing plain `Error`, so programmatic consumers cannot `catch (e instanceof SpecificError)` for those paths and must string-match messages — fragile and undocumented.

## Decision

**Map each plain-throw site to an existing or new typed subclass; add a static contract test that closes the gate.**

### Mapping (Planner to finalize, but the intent is):

| Site | Plain throw | Maps to |
|---|---|---|
| `src/api/sync-ops.mjs:146,148,151,167,171,178` | 6× `throw new Error(...)` | Per-site: `ArtifactNotFoundError` for missing artifact/phase, a new `InvalidArgumentError` (or reuse `BatchFilterError`'s sibling) for bad args — Planner picks the closest existing class; if none fits, add ONE minimal subclass. |
| `src/core/artifact-schema.js:33,40,51,56,62,78,88,92,97` | 9× schema validation | New `SchemaValidationError extends SpecFuseApiError` (carries `artifactId`, the failing field, and the message). Reuse `SchemaNotFoundError` only where the schema *file* is missing (already handled separately). |
| `src/core/template-resolver.js:347,370` | unknown template / missing file | `ArtifactNotFoundError` (template is an artifact) with `artifactType: 'template'`. |
| `src/core/resolver.js:50` | invalid resolution type | New or reuse: `InvalidArgumentError` (bad `--choice`/resolution type). |
| `src/core/ci-output.js:309` | unknown CI format | Reuse existing `CiUnsupportedModeError` (already in the taxonomy — confirm name in errors.mjs). |
| `src/core/registry.js:402` | registry not loaded | Reuse existing `RegistryError`. |

The goal is **minimal new classes**. Only add a class if no existing one is semantically correct; the audit shows at most one or two new classes (`SchemaValidationError`, possibly `InvalidArgumentError`).

### Preserve message + cause

Every retrofit preserves the original human-readable `.message`. Where the plain throw wrapped an underlying error (e.g. `new Error(\`...: ${err.message}\`)`), the typed throw passes `{ cause: err }` so the root cause is inspectable via `error.cause` (standard since Node 16.9).

## Contract test (the gate)

Extend `src/tests/api-contract.test.js` (which already enforces the exports-map and layering contracts) with a new test: scan every `src/api/*.mjs` for the literal `throw new Error(` and fail if any match. This is a regex/source-scan, consistent with the existing `extractImportSources` helper in that file.

Scope the static scan to `src/api/*.mjs` only (the layer the contract names). Core modules are covered by targeted `instanceof` unit tests rather than a source scan, because core modules legitimately may throw in paths not reached through the API, and a blanket ban there would be over-constraining. The Planner may add a softer "core throws typed or plain-but-not-reached" note if useful.

## Trade-offs

- **Reuse vs. new classes**: Prefer reusing existing classes even if the semantic fit is slightly loose, to avoid taxonomy bloat. `SchemaValidationError` is the one clear addition because schema-validation failures are a distinct, recurring category (9 sites).
- **Static scan in test**: A source-text scan is brittle against obfuscation but SpecFuse writes plain `throw new Error(...)` directly, so it is reliable here. The existing contract test already uses the same source-scan approach, so this is consistent.
- **No behavioral change for string-matching callers**: `SpecFuseApiError extends Error`, so `instanceof Error` and `.message` access are unchanged. Only callers that did `e.constructor === Error` (rare and discouraged) would behave differently — acceptable.

## Non-goals

- Does not retrofit `console.log`/`process.exit` patterns in `src/commands/*` (that is a CLI-layer concern; the contract test scopes to `src/api/`).
- Does not add an error code enum to every error (the `observability-codes` taxonomy already exists and is consumed separately by `lint.js`; wiring all errors to codes is out of scope here).
- Does not change error messages or exit codes — only the thrown type.

## Test strategy

- Contract test: `throw new Error(` scan over `src/api/*.mjs` fails closed.
- Per-site `instanceof` assertions: e.g. calling the API with a missing artifact throws `ArtifactNotFoundError`; loading a malformed artifact schema throws `SchemaValidationError`; calling registry.save() before load throws `RegistryError`.
- Regression: existing tests that assert on `.message` continue to pass (message text unchanged).
