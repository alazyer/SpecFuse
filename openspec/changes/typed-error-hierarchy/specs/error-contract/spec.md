## ADDED Requirements

### Requirement: API layer throws only typed errors
Every error thrown by a function in `src/api/*.mjs` SHALL be an `instanceof SpecFuseApiError` (a direct instance or a subclass). Plain `throw new Error(...)` SHALL NOT appear in any `src/api/*.mjs` module.

#### Scenario: API function throws a discriminable error type
- **WHEN** an API function in `src/api/sync-ops.mjs` encounters a failure (e.g. an invalid argument, a missing artifact, or an unsupported mode)
- **THEN** the thrown value SHALL be an `instanceof SpecFuseApiError`
- **AND** a consumer SHALL be able to discriminate the failure mode via `instanceof` on a specific subclass (e.g. `ArtifactNotFoundError`)

#### Scenario: Contract test forbids plain Error in the API layer
- **WHEN** the test suite is run
- **THEN** a contract test SHALL scan every `src/api/*.mjs` module and FAIL if any contains a `throw new Error(` statement (bare `Error`, not a `SpecFuseApiError` subclass)

### Requirement: Core error sites reached through the API throw typed errors
Core modules whose functions are invoked through the public API SHALL throw `SpecFuseApiError` subclasses for their documented failure modes, not plain `Error`. This covers schema validation, template resolution, conflict resolution type errors, CI output format errors, and registry-not-loaded errors.

#### Scenario: Artifact-schema validation throws a typed schema error
- **WHEN** `loadArtifactSchema` or `applyArtifactSchemaInstructions` in `src/core/artifact-schema.js` encounters a malformed schema (non-array instructions, empty key, wrong type)
- **THEN** the thrown value SHALL be an `instanceof SpecFuseApiError` subclass carrying the artifact ID and the validation problem
- **AND** the human-readable message SHALL be preserved

#### Scenario: Registry-not-loaded throws a typed registry error
- **WHEN** `Registry.save()` (or any registry method requiring a loaded state) is called before `Registry.load()`
- **THEN** the thrown value SHALL be an `instanceof RegistryError` (not a plain `Error`)

#### Scenario: Unsupported CI output format throws a typed mode error
- **WHEN** `src/core/ci-output.js` is asked to emit an unknown CI output format
- **THEN** the thrown value SHALL be an `instanceof` the existing CI-mode error class (e.g. `CiUnsupportedModeError`)
- **AND** the unsupported format name SHALL be available on the error

### Requirement: Retrofitted errors preserve cause and message
Where a plain `throw new Error(msg)` wrapped or followed an underlying error, the retrofitted typed throw SHALL preserve the original message text and attach the underlying error as `cause` where one exists.

#### Scenario: Wrapped underlying error retains cause
- **WHEN** a retrofitted site previously threw `new Error(\`...: ${err.message}\`)` wrapping an underlying `err`
- **THEN** the typed throw SHALL set `cause: err` so consumers can inspect the root cause
- **AND** the `.message` SHALL remain human-readable and include the relevant context
