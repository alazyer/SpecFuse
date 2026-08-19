## MODIFIED Requirements

### Requirement: All API modules are exported through the package exports map
Every API module under `src/api/` intended for public consumption SHALL be listed as a subpath in `package.json` `exports`, so that `import ... from 'specfuse/api/<name>.mjs'` resolves for every module the README and docs reference. The currently missing subpaths — `./api/ci.mjs`, `./api/clean.mjs`, `./api/config.mjs`, `./api/history.mjs`, `./api/sync-ops.mjs`, `./api/template.mjs`, `./api/utils.mjs` — SHALL be added.

#### Scenario: Documented CI API import resolves
- **WHEN** a consumer runs `import { drift, validate, check, init } from 'specfuse/api/ci.mjs'` (as documented in `docs/ci-integration.md`)
- **THEN** the import SHALL resolve without `ERR_PACKAGE_PATH_NOT_EXPORTED`
- **AND** each named export SHALL be a callable function

#### Scenario: Documented template API import resolves
- **WHEN** a consumer runs `import { template } from 'specfuse/api.mjs'` (as documented in `docs/template-customization.md`)
- **THEN** the import SHALL resolve and `template` SHALL be a namespaced API object with the documented methods

#### Scenario: Every src/api module is exported
- **WHEN** the exports-map contract test iterates over `src/api/*.mjs`
- **THEN** each public module SHALL have a corresponding entry in `package.json` `exports`
- **AND** the test SHALL fail if a new API module is added without an exports entry

### Requirement: Umbrella api.mjs re-exports the full documented surface
`src/api.mjs` SHALL re-export every namespaced API (`plan`, `specify`, `change`, `schema`, `batch`, `graph`, `bundle`, `lint`, `ci`, `clean`, `config`, `history`, `template`, `resolve`) so a single `import { ... } from 'specfuse/api.mjs'` provides the complete programmatic surface the README and docs describe.

#### Scenario: Full surface importable from the umbrella
- **WHEN** a consumer imports the umbrella module
- **THEN** all documented namespaces SHALL be present as exports
- **AND** the default export SHALL expose every namespace as a property

### Requirement: API modules do not import from the command layer
No module under `src/api/*.mjs` SHALL import from `src/commands/*`. API modules SHALL source behavior from `src/core/*` and `src/utils/*` only, preserving the documented layering (core → API → CLI), so the programmatic API is not coupled to CLI presentation or `process.exit`.

#### Scenario: ci API does not reach into the command layer
- **WHEN** `src/api/ci.mjs` is imported
- **THEN** it SHALL NOT import from `../commands/ci.js` or any other `src/commands/*` module
- **AND** the CI API functions SHALL return structured data and throw `SpecFuseApiError` subclasses, matching the other API modules' contract

#### Scenario: ci init unsupported mode throws typed API error
- **WHEN** a consumer calls `init({ github: false })` from `specfuse/api/ci.mjs`
- **THEN** the call SHALL reject with a `SpecFuseApiError` subclass (not a plain `Error`)
- **AND** the error payload SHALL be machine-readable for API consumers (for example by exposing stable fields on the error instance)

#### Scenario: Contract test guards the layering
- **WHEN** the API-layering contract test scans `src/api/*.mjs` imports
- **THEN** it SHALL fail if any API module imports from `src/commands/*`
