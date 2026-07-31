# Tasks: Clean and Reset Utility

## Phase 1: Orphan Detection (P1)

- [ ] **T1:** Create `src/core/orphan-detector.js` with detection logic
- [ ] **T2:** Implement `findOrphanedFiles(projectRoot, rules)` 
- [ ] **T3:** Implement `findStaleRegistryEntries(projectRoot, registry)`
- [ ] **T4:** Implement `findEmptyDirectories(projectRoot)`
- [ ] **T5:** Add unit tests for orphan detection (`orphan-detector.test.js`)

## Phase 2: Clean Operations (P1)

- [ ] **T6:** Create `src/commands/clean.js` with clean/reset handlers
- [ ] **T7:** Register `specfuse clean` and `specfuse reset` in `src/cli.js`
- [ ] **T8:** Implement `specfuse clean --dry-run` (default behavior)
- [ ] **T9:** Implement `specfuse clean` with confirmation prompt
- [ ] **T10:** Implement `--registry`, `--orphans` flags for selective cleaning
- [ ] **T11:** Log clean operations to history
- [ ] **T12:** Add CLI tests (`clean.test.js`)

## Phase 3: Reset Operations (P1)

- [ ] **T13:** Implement `specfuse reset --dry-run` (default behavior)
- [ ] **T14:** Implement `specfuse reset` preserving plan/ and archive/
- [ ] **T15:** Implement `specfuse reset --hard` removing all artifacts
- [ ] **T16:** Add confirmation prompts for destructive operations

## Phase 4: API (P2)

- [ ] **T17:** Create `src/api/clean.mjs` with `clean()`, `reset()` functions
- [ ] **T18:** Export from `src/api.mjs`

## Phase 5: Documentation (P2)

- [ ] **T19:** Update README.md with clean/reset command reference
- [ ] **T20:** Document safety features and confirmation prompts
