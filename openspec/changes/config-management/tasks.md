# Tasks: Unified Configuration Management

## Phase 1: Config Schema (P1)

- [ ] **T1:** Define unified config schema in `src/core/config-manager.js`
- [ ] **T2:** Implement `loadConfig()` to read from all sources
- [ ] **T3:** Implement `getConfigValue(key)` with dot notation support
- [ ] **T4:** Implement `setConfigValue(key, value)` with type coercion
- [ ] **T5:** Implement `validateConfig()` against schema
- [ ] **T6:** Add unit tests for config manager (`config-manager.test.js`)

## Phase 2: CLI Commands (P1)

- [ ] **T7:** Create `src/commands/config.js` with list/get/set/validate handlers
- [ ] **T8:** Register `specfuse config` command group in `src/cli.js`
- [ ] **T9:** Implement `specfuse config list` with grouped output
- [ ] **T10:** Implement `specfuse config get <key>`
- [ ] **T11:** Implement `specfuse config set <key> <value>`
- [ ] **T12:** Implement `specfuse config validate`
- [ ] **T13:** Implement `specfuse config path`
- [ ] **T14:** Add CLI tests (`config.test.js`)

## Phase 3: API (P2)

- [ ] **T15:** Create `src/api/config.mjs` with `list()`, `get()`, `set()`, `validate()`
- [ ] **T16:** Export from `src/api.mjs`

## Phase 4: Documentation (P2)

- [ ] **T17:** Update README.md with config command reference
- [ ] **T18:** Document all config keys and their valid values
