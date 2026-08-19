## Context

`package.json` exports 11 subpaths. Seven real `src/api/*.mjs` files are missing from the map: `ci.mjs`, `clean.mjs`, `config.mjs`, `history.mjs`, `sync-ops.mjs`, `template.mjs`, `utils.mjs`. Under Node ESM, an `exports` map is closed — unlisted subpaths throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The docs (`docs/ci-integration.md`, `docs/template-customization.md`) tell consumers to import subpaths that don't resolve.

Compounding this, `src/api/ci.mjs` imports from `../commands/ci.js`:

```js
import { ciDrift, ciValidate, ciCheck, ciInit } from '../commands/ci.js'
```

Every other API module (`plan.mjs`, `specify.mjs`, `change.mjs`, `schema.mjs`, `sync-ops.mjs`, `batch.mjs`) imports only from `src/core/*` and `src/utils/*`. The CI API is the lone inversion, coupling the programmatic surface to a CLI command file that mixes business logic with `formatAuto` presentation and `recordEvent` side effects.

## Goals / Non-Goals

**Goals:**

- Make every documented programmatic import path resolve by listing all public API modules in `exports`.
- Re-export the full documented namespace surface from the umbrella `src/api.mjs`.
- Decouple `src/api/ci.mjs` from `src/commands/ci.js`.
- Add contract tests so the exports map and the API layering cannot silently regress.

**Non-Goals:**

- Registering the orphaned CLI commands (owned by `register-orphaned-command-groups`). This change makes the *programmatic* API importable; that change makes the *CLI* commands reachable. The two are complementary and independent.
- Refactoring the command handlers or moving all business logic into core (the deeper seam extraction is the `sweep-architecture-weaknesses` W2 work). Here we only move/extract the minimum so the CI API does not import from the command layer.

## Decisions

### D1: List all public API modules in exports
Add the seven missing subpaths to `package.json` `exports`, mirroring the existing entry style (`"./api/ci.mjs": "./src/api/ci.mjs"`, etc.). `src/api/utils.mjs` is internal-leaning; it is exported too because the docs/examples may reference it and a closed exports map otherwise blocks it. If `utils.mjs` is deemed truly internal, the Planner MAY instead keep it unexported and update docs not to reference it — either resolution satisfies the contract as long as docs and exports agree.

### D2: Umbrella re-export completeness
`src/api.mjs` is extended to re-export `ci`, `clean`, `config`, `history`, `template` namespaces and the `resolve` function (already present) so `import { ... } from 'specfuse/api.mjs'` matches the docs. The default export object is extended with the same namespaces.

### D3: Decouple ci.mjs from the command layer
The CI business logic currently living in `src/commands/ci.js` (drift normalization, exit-code calculation, history recording) that the API needs is extracted into `src/core/` (or an existing core seam), and both `src/api/ci.mjs` and `src/commands/ci.js` import from there. The command file keeps only presentation (`formatAuto` output) and `process.exit` wiring. This mirrors how `change`, `plan`, etc. already split core from command. This step coordinates with the `sweep-architecture-weaknesses` W2 work; the Planner SHOULD sequence this after or alongside W2 to avoid double-extracting the same seam.

### D4: Contract tests, not just examples
Two tests are added: (1) an exports-map test that asserts every `src/api/*.mjs` resolves via `import('specfuse/api/<name>.mjs')` and that the umbrella exports every documented namespace; (2) a layering test that scans `src/api/*.mjs` source and fails if any imports from `src/commands/*`. The layering test is a static check over import statements (cheap, reliable).

## Trade-offs

- **Exporting `utils.mjs`** expands the public surface to include helpers that may not be stable. The alternative (keep internal + fix docs) is equally valid; D1 leaves the choice to the Planner with the constraint that docs and exports must agree.
- **Extracting CI core logic** is the one piece of real refactoring in this change. It is unavoidable to satisfy the layering requirement, and doing it now prevents the inverted dependency from entrenching. Accepted cost.
- **Contract tests add maintenance**. They are cheap (static import scan + dynamic import resolution) and high-value (catch the exact regressions that caused this gap).

## Risks

- Extracting CI core logic could change subtle behavior (e.g. history recording side-effects). Mitigation: the existing `src/tests/ci.test.js` and `ci-output.test.js` pin the behavior; the extraction is behavior-preserving.
- A future API module added without an exports entry would silently be unimportable again. Mitigation: the exports-map contract test fails closed on a new unexported module.
- Coordination with W2: if both this change and W2 extract the CI seam, they conflict. Mitigation: the handoff notes explicitly tell the Orchestrator/Planner to sequence this after W2 or to fold the CI extraction into W2.
