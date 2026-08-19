# Tasks — diff --apply registry sync

## 1. Apply path records sync state (Shape A recommended)
- [ ] 1.1 Extend `applyDiff` in `src/core/differ.js` to accept the loaded `Registry` (and enough rule/pair context to identify each pair).
- [ ] 1.2 After each successful `writeFileAtomic`, call the same `registry.recordSync(...)` the sync engine uses (`src/core/sync-engine.js:281-282`).
- [ ] 1.3 On `written: false`, do NOT call `recordSync` for that pair — leave prior state.
- [ ] 1.4 Save the registry exactly once after all pairs are applied (single `registry.save()`).

## 2. CLI wiring (`src/commands/diff.js`)
- [ ] 2.1 Pass the already-loaded registry (`diff.js:21-22`) into the three `applyDiff` call sites (`:63, :85, :109`).
- [ ] 2.2 Ensure one `registry.save()` after apply completes; surface any save error.

## 3. API wiring (`src/api/sync-ops.mjs`)
- [ ] 3.1 Wrap the `applyDiff` call at `:82-83` in the advisory lock (mirror the `resolve` path at `:156`).
- [ ] 3.2 Record syncs and save once inside the locked section.

## 4. Tests
- [ ] 4.1 Drifted project → `diff --apply` → `drift` reports `IN_SYNC` for applied pair.
- [ ] 4.2 One pair fails to write → that pair NOT recorded; other applied pairs recorded.
- [ ] 4.3 `diff` (no `--apply`) → registry untouched, drift state unchanged.
- [ ] 4.4 API apply holds the lock; recorded sync survives a concurrent mock watch save.
- [ ] 4.5 Single `registry.save()` invocation per apply (spy/assert call count == 1).

## 5. Docs
- [ ] 5.1 Update `README.md` diff section: `--apply` now reconciles the registry (no separate `sync` needed afterward).
