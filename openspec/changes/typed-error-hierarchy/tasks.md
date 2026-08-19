# Tasks — Typed Error Hierarchy

## 1. Error-class additions
- [ ] 1.1 Add `SchemaValidationError extends SpecFuseApiError` in `src/api/errors.mjs` (carries `artifactId`, failing field). Export it from `src/api.mjs`.
- [ ] 1.2 If no existing class fits bad-argument cases, add `InvalidArgumentError` (or confirm `BatchFilterError`/another suffices) — Planner decision; keep new classes minimal.
- [ ] 1.3 Confirm `CiUnsupportedModeError` (or equivalent) exists in `src/api/errors.mjs` for the ci-output site; add if missing.

## 2. Retrofit API layer (`src/api/sync-ops.mjs`)
- [ ] 2.1 Replace the 6 `throw new Error(...)` sites (`:146, :148, :151, :167, :171, :178`) with typed subclasses, preserving messages and attaching `cause` where an underlying error exists.

## 3. Retrofit core modules
- [ ] 3.1 `src/core/artifact-schema.js` — 9 sites → `SchemaValidationError` (or `SchemaNotFoundError` where the schema file is missing).
- [ ] 3.2 `src/core/template-resolver.js:347, :370` → `ArtifactNotFoundError` (artifactType: 'template').
- [ ] 3.3 `src/core/resolver.js:50` → typed invalid-argument/resolution error.
- [ ] 3.4 `src/core/ci-output.js:309` → `CiUnsupportedModeError` (reuse).
- [ ] 3.5 `src/core/registry.js:402` → `RegistryError` (reuse).

## 4. Contract test (gate)
- [ ] 4.1 Extend `src/tests/api-contract.test.js`: scan every `src/api/*.mjs` for `throw new Error(` and fail on any match.
- [ ] 4.2 Add per-site `instanceof` assertions (API: missing artifact, bad arg; core: malformed schema, registry-not-loaded, unknown CI format).

## 5. Regression & docs
- [ ] 5.1 Run full suite; confirm no `.message` assertions broke (messages preserved).
- [ ] 5.2 One-line note in `README.md` Programmatic API section: errors are typed `SpecFuseApiError` subclasses, catchable by `instanceof`.
