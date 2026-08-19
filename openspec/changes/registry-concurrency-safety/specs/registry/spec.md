## MODIFIED Requirements

### Requirement: Concurrent registry writes are serialized
Registry load-mutate-save sequences SHALL be guarded by an advisory lock so that only one writer process proceeds at a time. A second writer SHALL wait for the lock up to a configurable timeout, then fail with a structured `RegistryLockedError` identifying the holding process, rather than silently overwriting the first writer's result.

#### Scenario: Watch and manual sync run concurrently
- **WHEN** `specfuse watch` is running and the user runs `specfuse sync` in a second terminal while a watch-triggered sync is in progress
- **THEN** the second process SHALL wait for the lock to release and then proceed with the current registry state (including the first process's mutations)
- **AND** neither process's mutations SHALL be silently lost

#### Scenario: Lock is held beyond the timeout
- **WHEN** a second writer cannot acquire the lock within the configured timeout (e.g. a crashed process left a stale lock)
- **THEN** the operation SHALL fail with a structured `RegistryLockedError` identifying the holding process and lock file path
- **AND** the CLI SHALL print an actionable message (including how to clear a stale lock)

#### Scenario: Stale lock from a crashed process
- **WHEN** a lock file exists but its holding process is no longer running (verified by pid)
- **THEN** the next writer SHALL detect the stale lock, reclaim it, and proceed
- **AND** `specfuse doctor` SHALL report any stale lock

### Requirement: Corrupt registry is quarantined, not silently reset
When `Registry.load()` encounters an unparseable `registry.json`, it SHALL quarantine the corrupt file (rename it aside with a timestamped suffix), initialize a fresh registry, and report the corruption as a structured `RegistryError` to CLI and API consumers — never as a silent console warning that resets state without trace.

#### Scenario: registry.json is corrupt
- **WHEN** `registry.json` contains unparseable JSON (e.g. truncated by an interrupted write or a git merge conflict)
- **THEN** the corrupt file SHALL be quarantined to `registry.json.corrupt-<timestamp>` for manual recovery
- **AND** a fresh registry SHALL be initialized
- **AND** the CLI and API SHALL report a structured error/warning naming the quarantined file path

#### Scenario: API consumer sees a typed error, not a reset
- **WHEN** a programmatic caller invokes an API function whose `Registry.load()` hits corrupt JSON
- **THEN** the caller SHALL receive a structured `RegistryError` (a `SpecFuseApiError` subclass), not a silent empty state
- **AND** the quarantined file path SHALL be available on the error for recovery

### Requirement: Version migration is non-destructive and reported
When `Registry.load()` encounters a registry whose schema version differs from the current `SCHEMA_VERSION`, it SHALL preserve the old registry (quarantine/backup before migrating), migrate fields field-by-field where a migration is defined, and report what was migrated — rather than wiping `syncs`/`traces`/`artifacts` on any version mismatch.

#### Scenario: Upgrade migrates an older registry
- **WHEN** a registry with an older schema version is loaded after a SpecFuse upgrade
- **THEN** the old file SHALL be backed up before migration
- **AND** fields with defined migrations SHALL be transformed in place
- **AND** fields without a defined migration SHALL be preserved (not wiped to `{}`)
- **AND** the CLI/API SHALL report the version transition and what was migrated

#### Scenario: Partially-corrupt valid JSON
- **WHEN** the registry parses as JSON but has an unexpected shape (e.g. `syncs` is a string instead of an object)
- **THEN** the loader SHALL quarantine the malformed registry and report a structured error, rather than silently running on partially-corrupt state that produces phantom drift

### Requirement: Batch archive uses a single locked transaction
The `batch.mjs` `archive()` flow SHALL perform its registry mutations and history recording within a single locked load-mutate-save transaction, rather than creating two `Registry` instances that each load/save independently (the current pattern at batch.mjs:158-183).

#### Scenario: Batch archive records traces and history atomically
- **WHEN** `batchArchive` runs and succeeds for multiple changes
- **THEN** the trace updates and the history event SHALL be written in one locked transaction
- **AND** a concurrent writer SHALL not be able to interleave between the trace write and the history write

## NEW Requirements

### Requirement: Registry health is observable
`specfuse doctor` SHALL report registry lock state, the presence of any quarantined corrupt/migrated registry files, and the current schema version, so operators can detect concurrency hazards and recover from corruption.

#### Scenario: Doctor reports lock and quarantine state
- **WHEN** a user runs `specfuse doctor`
- **THEN** the report SHALL include the registry schema version, any active/stale lock, and any quarantined registry files with a recovery hint
