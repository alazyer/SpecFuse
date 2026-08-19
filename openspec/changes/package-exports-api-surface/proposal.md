## Why

`package.json` declares an `exports` map with 11 subpaths, but seven real API module files under `src/api/` are NOT in the map: `ci.mjs`, `clean.mjs`, `config.mjs`, `history.mjs`, `sync-ops.mjs`, `template.mjs`, and `utils.mjs`. In Node.js ESM the `exports` map is a hard gate — any subpath not listed throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. So the documented programmatic imports fail at the package boundary:

- `docs/ci-integration.md:125` instructs `import { drift, validate, check, init } from 'specfuse/api/ci.mjs'` — this throws, because `./api/ci.mjs` is not exported.
- `docs/template-customization.md:181` instructs `import { template } from 'specfuse/api.mjs'` — but `template` is not re-exported from `src/api.mjs` (it exports `plan, specify, schema, batch, graph, bundle, lint` — not `template`, `ci`, `clean`, `config`, or `history`).
- `src/api/ci.mjs` imports from `../commands/ci.js` (a CLI command layer), inverting the dependency every other API module follows (core → API → CLI). The CI API is the only one that reaches down into a command file, making it fragile and violating the architectural contract documented in ADR 0003 and `docs/architecture.md`.

The result: the programmatic API surface that SpecFuse advertises in its README, docs, and OpenSpec specs is partially unreachable. Editor integrations, CI automation, and bundling tooling that import the documented subpaths get runtime errors.

## What Changes

- Define a package-exports contract: every API module under `src/api/` that is intended for public consumption SHALL be listed in `package.json` `exports`, so documented import paths resolve.
- Add the seven missing subpaths (`./api/ci.mjs`, `./api/clean.mjs`, `./api/config.mjs`, `./api/history.mjs`, `./api/sync-ops.mjs`, `./api/template.mjs`, `./api/utils.mjs`) to the `exports` map.
- Re-export the full API surface (`ci`, `clean`, `config`, `history`, `template`) from the umbrella `src/api.mjs` so `import { ... } from 'specfuse/api.mjs'` works as the docs claim.
- Fix the inverted `ci.mjs` dependency so the CI API imports from `src/core/*` (or a shared core seam) rather than `src/commands/ci.js`, matching every other API module's layering.
- Add a contract test asserting every documented import path resolves and that no API module imports from `src/commands/*`.

## Capabilities

### New Capabilities

- `api-surface`: Ensures the programmatic API surface SpecFuse documents is actually importable through the package `exports` map, and that the umbrella `api.mjs` re-exports the full documented surface.

### Modified Capabilities

- `ci-command`: Decouples the CI API from the CLI command layer so `specfuse/api/ci.mjs` follows the same core→API layering as the other API modules.

## Impact

- **Package**: `package.json` — extend the `exports` map with the seven missing subpaths.
- **API modules**: `src/api.mjs` — re-export `ci`, `clean`, `config`, `history`, `template`; `src/api/ci.mjs` — stop importing from `../commands/ci.js`, source the same behavior from `src/core/*` (this overlaps with the `sweep-architecture-weaknesses` W2 seam work and SHOULD be coordinated with it).
- **Tests**: `src/tests/api.test.js` — assert all documented import paths resolve and the umbrella export is complete; assert no `src/api/*.mjs` imports from `src/commands/*`.
- **Docs**: confirm `docs/ci-integration.md` and `docs/template-customization.md` examples run as written.
- **Dependencies**: None.
- **Breaking behavior**: None for existing importers (the change only adds export subpaths and re-exports). The `ci.mjs` layering fix is internal and preserves the public function signatures.
