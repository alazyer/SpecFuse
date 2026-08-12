## 1. Extend the package exports map

- [x] 1.1 Add the seven missing subpaths to `package.json` `exports`: `./api/ci.mjs`, `./api/clean.mjs`, `./api/config.mjs`, `./api/history.mjs`, `./api/sync-ops.mjs`, `./api/template.mjs`, `./api/utils.mjs` (or, for `utils.mjs`, decide internal-vs-public and align docs accordingly).
- [x] 1.2 Verify each added subpath resolves with a real `import()` from a consumer-style test.

## 2. Complete the umbrella re-export

- [x] 2.1 In `src/api.mjs`, re-export the `ci`, `clean`, `config`, `history`, and `template` namespaces (and confirm `resolve` is exported).
- [x] 2.2 Extend the default export object with the same namespaces.
- [x] 2.3 Confirm `docs/template-customization.md` `import { template } from 'specfuse/api.mjs'` now resolves.

## 3. Decouple the CI API from the command layer

- [x] 3.1 Extract the CI business logic currently in `src/commands/ci.js` (drift normalization, exit-code calculation, history recording) into a `src/core/` seam (coordinate with `sweep-architecture-weaknesses` W2 to avoid double-extraction).
- [x] 3.2 Update `src/api/ci.mjs` to import from `src/core/*` instead of `../commands/ci.js`; ensure it returns structured data and throws `SpecFuseApiError` subclasses.
- [x] 3.3 Reduce `src/commands/ci.js` to presentation (`formatAuto`) + `process.exit` wiring, importing the shared core seam.

## 4. Contract tests

- [x] 4.1 Add an exports-map test: every `src/api/*.mjs` resolves via `import('specfuse/api/<name>.mjs')`; the umbrella exports every documented namespace; the default export exposes them.
- [x] 4.2 Add an API-layering test: scan `src/api/*.mjs` import statements and fail if any imports from `src/commands/*`.
- [x] 4.3 Add a docs-accuracy check: the import examples in `docs/ci-integration.md` and `docs/template-customization.md` resolve as written.

## 5. Verify

- [x] 5.1 Run `pnpm test`; confirm new contract tests pass and no regressions in `api.test.js`/`ci.test.js`/`ci-output.test.js`.
- [x] 5.2 Confirm `import { drift, validate, check, init } from 'specfuse/api/ci.mjs'` works from a fresh consumer project.
- [x] 5.3 Confirm `specfuse/api.mjs` umbrella exposes `ci`, `clean`, `config`, `history`, `template`, `resolve`.
