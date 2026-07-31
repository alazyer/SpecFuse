# Tasks: History and Audit Log

## Phase 1: Core History (P1)

- [ ] **T1:** Add `history: []` to registry schema in `src/core/registry.js`
- [ ] **T2:** Implement `recordEvent(type, summary, details)` in Registry class
- [ ] **T3:** Implement `getHistory(options)` with filtering (since, until, limit, type)
- [ ] **T4:** Add history pruning when `history.length > maxHistory`
- [ ] **T5:** Add unit tests for history storage (`registry.test.js` updates)

## Phase 2: Event Recording (P1)

- [ ] **T6:** Record sync events in `src/core/sync-engine.js`
- [ ] **T7:** Record archive events in `src/api/change.mjs`
- [ ] **T8:** Record validate events in `src/commands/validate.js`
- [ ] **T9:** Record drift events in `src/commands/drift.js`
- [ ] **T10:** Record init events in `src/commands/init.js`

## Phase 3: CLI Commands (P1)

- [ ] **T11:** Create `src/commands/history.js` with list/filter handlers
- [ ] **T12:** Register `specfuse history` command in `src/cli.js`
- [ ] **T13:** Implement `specfuse history` with default limit 20
- [ ] **T14:** Implement `specfuse history sync` and `specfuse history archive`
- [ ] **T15:** Implement `--since`, `--until`, `--limit` flags
- [ ] **T16:** Implement `--json` output
- [ ] **T17:** Add CLI tests (`history.test.js`)

## Phase 4: API (P2)

- [ ] **T18:** Create `src/api/history.mjs` with `list()`, `get()` functions
- [ ] **T19:** Export from `src/api.mjs`

## Phase 5: Documentation (P2)

- [ ] **T20:** Update README.md with history command reference
- [ ] **T21:** Document event types and their details
