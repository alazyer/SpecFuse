## 1. Registry Trace Storage

- [x] 1.1 Add `traces` key support to `Registry` class — `getTraces()`, `recordTrace(changeName, storyIds)`, `markStoryImplemented(storyId, archiveName)`, `removeTraceLinks(changeName)` methods
- [x] 1.2 Update `_fresh()` to include `traces: {}` in default registry schema

## 2. Proposal Template

- [x] 2.1 Add `stories: ~` frontmatter field to `templates/change/proposal.md`

## 3. Core Traceability Engine

- [x] 3.1 Create `src/core/traceability.js` — implement `buildTraceMatrix(projectRoot)` that scans stories directory, active changes, and archived changes to build the traceability matrix
- [x] 3.2 Implement `computeCoverage(matrix)` that returns total/active/implemented/uncovered counts and percentage
- [x] 3.3 Implement `recordTraceLinks(projectRoot, registry)` that scans active proposals and calls `registry.recordTrace()` for each referenced story ID
- [x] 3.4 Implement unknown story ID detection — warn when a referenced story ID has no file in `.specfuse/plan/stories/`

## 4. Trace Command

- [x] 4.1 Create `src/commands/trace.js` — implement `traceCommand(projectRoot, options)` with `--coverage` and `--json` flags
- [x] 4.2 Format traceability matrix output with status indicators (active/implemented/uncovered/unknown)
- [x] 4.3 Format coverage report with counts, percentages, and success indicator

## 5. Sync Integration

- [x] 5.1 Add trace link recording step to `runTwoPassSync()` in `src/core/sync-engine.js` — after Pass B, scan active proposals and record trace links via registry

## 6. Archive Integration

- [x] 6.1 Add trace update to `changeArchive()` in `src/commands/change/index.js` — read proposal `stories:` frontmatter and mark linked stories as implemented in registry

## 7. CLI Registration

- [x] 7.1 Register `specfuse trace` command in `src/cli.js` with `--coverage` and `--json` options

## 8. Tests

- [x] 8.1 Create `src/tests/trace.test.js` — test `buildTraceMatrix()`, `computeCoverage()`, `recordTraceLinks()`, registry trace methods, and trace command output
