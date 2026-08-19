# Tasks — Non-interactive Conflict Resolution

## 1. Non-interactive detection helper
- [ ] 1.1 Add `isInteractive()` (stdin TTY + `CI` env check) in `src/utils/fs.js` or `src/commands/resolve.js`.
- [ ] 1.2 Confirm/extend the resolution enum in `src/core/resolver.js` so `skip` is a recognized non-mutating choice.

## 2. `resolve` command
- [ ] 2.1 Add `--choice <source|target|skip>` to the `resolve` command registration (`cli.js:547-554`).
- [ ] 2.2 In `src/commands/resolve.js`: if `--choice` set → apply via existing `applyResolution`, print diff for review, update registry, no prompt.
- [ ] 2.3 If no `--choice` and non-interactive → exit non-zero, name conflicted rule, suggest `--choice`; do NOT call `promptChoice`.
- [ ] 2.4 If no `--choice` and TTY → existing prompt (no regression).

## 3. `sync --resolve`
- [ ] 3.1 Add `--choice <source|target|skip>` to the `sync` command.
- [ ] 3.2 In `src/commands/sync.js` `onConflict` (`:87`, `:311-315`): apply `--choice` to each conflict; `skip` leaves pair `BOTH_CHANGED` and continues.
- [ ] 3.3 No `--choice` + non-interactive → abort sync non-zero listing all conflicted rules; no mutations beyond already-applied safe pairs.
- [ ] 3.4 No `--choice` + TTY → per-pair prompt (unchanged).

## 4. API surface (`src/api/sync-ops.mjs`)
- [ ] 4.1 `resolve()` accepts a `choice` option; applies non-interactively without prompting.
- [ ] 4.2 Document `choice` in the API JSDoc.

## 5. `--json` composition
- [ ] 5.1 `--json --choice <c>` → structured result of resolved pair(s), exit 0.
- [ ] 5.2 Non-interactive `--json` with unresolvable conflict → structured conflict data + non-zero exit with `--choice` guidance (Planner: decide if an `--inspect` escape hatch is warranted for zero-exit inspection).

## 6. Tests & docs
- [ ] 6.1 Tests: non-TTY/no-choice → non-zero + guidance, no stdin read; `--choice source/target` applied; `--choice skip` leaves conflicted; TTY prompt unchanged; `CI=1` == non-TTY.
- [ ] 6.2 Update `README.md` drift/resolution section: conflicts can be resolved non-interactively with `--choice`; CI fails fast with guidance when a conflict is unresolved.
