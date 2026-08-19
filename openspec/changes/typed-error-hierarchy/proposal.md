## Why

`src/api/errors.mjs` defines a well-structured `SpecFuseApiError` hierarchy (`ArtifactNotFoundError`, `ChangeNotVerifiedError`, `SchemaNotFoundError`, `RegistryError`, `BundleValidationError`, etc.), and the module's own header states the contract: *"All API functions throw subclasses of SpecFuseApiError instead of calling process.exit or console.log. This allows consumers to catch specific error types and handle them programmatically."*

That contract is violated in ~15 call sites across core and the API layer itself:

- `src/core/artifact-schema.js` — 9 plain `throw new Error(...)` for schema validation/config errors (`:33, :40, :51, :56, :62, :78, :88, :92, :97`).
- `src/api/sync-ops.mjs` — 6 plain `throw new Error(...)` **in the API layer** (`:146, :148, :151, :167, :171, :178`), the layer whose contract is to throw typed errors.
- `src/core/template-resolver.js:347, :370` — plain `Error` for unknown template / missing file.
- `src/core/resolver.js:50` — plain `Error('Invalid resolution type: ...')`.
- `src/core/ci-output.js:309` — plain `Error('Unknown CI output format: ...')` despite a `CiUnsupportedModeError` existing in the taxonomy.
- `src/core/registry.js:402` — plain `Error('Registry not loaded.')` despite `RegistryError` existing.

Consequence: a programmatic consumer (`import { sync, ... } from 'specfuse/api.mjs'`) cannot `catch (e instanceof ArtifactNotFoundError)` for these paths — they get a bare `Error` and must string-match the message. This breaks the documented API contract and makes error-driven control flow (retry, skip, surface to user) impossible for exactly the failure modes consumers most need to discriminate (bad schema, missing artifact, unsupported CI mode, registry not loaded).

## What Changes

- Define an error-contract requirement: every throw originating in `src/api/*.mjs` (the API layer) and in core modules reached through the API SHALL be an `instanceof SpecFuseApiError` (or a subclass).
- Introduce the few missing typed subclasses needed to map the existing plain-throw sites, reusing existing classes where a fit already exists (e.g. `CiUnsupportedModeError` for the ci-output case, `RegistryError` for the registry-not-loaded case) and adding `SchemaValidationError` / `ArtifactSchemaError` for the artifact-schema cluster.
- Retrofit the ~15 plain `throw new Error(...)` sites to throw the appropriate typed subclass, preserving the human-readable message and attaching `cause` where the original throw wrapped an underlying error.
- Add a contract test (extending `src/tests/api-contract.test.js`) that statically scans `src/api/*.mjs` for `throw new Error(` and fails the suite — closing the gate so the contract cannot regress.

## Capabilities

### New Capabilities

- `error-contract`: Guarantees the API and core layers throw typed `SpecFuseApiError` subclasses (never plain `Error`), so programmatic consumers can discriminate failure modes by type.

### Modified Capabilities

- `api-surface`: Strengthens the API-layering contract to also cover error typing, not just import direction.

## Impact

- **Core modules**: `src/core/artifact-schema.js` (9 sites), `src/core/template-resolver.js` (2), `src/core/resolver.js` (1), `src/core/ci-output.js` (1), `src/core/registry.js` (1).
- **API layer**: `src/api/sync-ops.mjs` (6 sites) — these are the most contract-critical because the API layer's own header promises typed throws.
- **API/errors**: `src/api/errors.mjs` — add `SchemaValidationError` (or reuse `ArtifactNotFoundError`/`SchemaNotFoundError` where semantically correct); reuse `RegistryError`, `CiUnsupportedModeError`.
- **Tests**: extend `src/tests/api-contract.test.js` with a static `throw new Error(` scan over `src/api/*.mjs`; targeted unit tests asserting `instanceof` for the retrofitted sites.
- **Dependencies**: None.
- **Breaking behavior**: None intended. Callers that previously string-matched error messages still receive the same `.message`; callers that already used `instanceof` gain coverage. The only "break" is for code that relied on the thrown object being a *bare* `Error` and not a subclass — but `SpecFuseApiError extends Error`, so `instanceof Error` still holds.
