## Context

`executeRule` (sync-engine.js:66-216) runs `extract` → `transform` → `writeFileAtomic` unconditionally and sets `changed: true` whenever the rule runs. It never compares the new content to the existing managed section. The `differ` module already knows how to detect no-ops (`diffSection` uses `hasChanges: a !== b` at differ.js:263), but the sync engine does not reuse that check.

Several built-in rules make the problem worse by embedding `ctx.today()` in `transform()` output:

- `rules/plan-to-constitution.rule.mjs:46` — `> Auto-synced from ... by SpecFuse on ${ctx.today()}`

Because the date is part of the diffed content, a re-sync on a different day is never a no-op, even with identical sources. The actual "when was this synced" information is already recorded in the registry under `syncs[].syncedAt`, so the in-content date stamp is redundant and purely harmful for idempotency.

This change makes sync a true no-op when content is unchanged and makes transforms deterministic, which also unblocks the `sync-atomicity-and-recovery` change's replay strategy (replay can reuse recorded transformed content safely when transforms are deterministic).

## Goals / Non-Goals

**Goals:**

- `specfuse sync` re-run is a true no-op when sources are unchanged: no writes, `unchanged` outcome, no spurious drift.
- Built-in rule transforms are deterministic (stable across days).
- `unchanged` is a first-class structured outcome in CLI/JSON/SARIF output.
- Warn rule authors when a custom rule is non-deterministic.

**Non-Goals:**

- Concurrency locking (owned by `registry-concurrency-safety`).
- Cross-file transaction/recovery (owned by `sync-atomicity-and-recovery`); this change makes recovery's replay safe but does not implement recovery.
- Changing the two-pass A/B model or rule execution order.
- Removing all uses of `ctx.today()` everywhere — only its use in diffed managed-section content is in scope.

## Decisions

### D1: Compare-before-write in executeRule
After `transform`, `executeRule` SHALL compute the proposed managed-section content and compare it to the existing managed section read from the target file. If equal, it SHALL skip the write, leave the registry's hashes unchanged, and return an `unchanged` outcome. If different, it writes and returns `changed`. The comparison is on the rendered managed-section string, not the whole file, so non-managed edits are irrelevant.

### D2: Remove volatile date from diffed content
The built-in rules' `> Auto-synced ... on ${ctx.today()}` header is removed from `transform()` output. The authoritative synced timestamp remains `registry.json` `syncs[].syncedAt`. If a human-visible "last synced" note is still desired, it moves to a non-diffed location (e.g. `specfuse status`/`doctor` reads `syncedAt`) rather than the managed section. This keeps the managed section a pure function of source content.

### D3: Non-determinism warning for custom rules
The engine cannot statically prove a custom `transform()` is deterministic. Instead, after a sync, if a rule's output changed between two runs with identical source hashes, the engine SHALL emit a warning (structured, in `--json`) naming the rule as a likely non-deterministic transform. This is a heuristic safety net, not enforcement.

### D4: `unchanged` as a structured state
The per-rule outcome enum is extended to include `unchanged` alongside `changed`/`skipped`/`forced`/`failed`. This composes with the `sweep-architecture-weaknesses` W3 structured-outcomes work: `unchanged` is another structured state, and its introduction is additive.

## Trade-offs

- **Removing the in-content date stamp** is a small content change to existing managed sections on the next sync (the stamp disappears). This is acceptable: managed sections are machine-managed, the timestamp is preserved in the registry, and users are warned not to edit managed markers. The first sync after this change WILL rewrite managed sections once (to drop the stamp); subsequent syncs are no-ops. This one-time rewrite is noted in the change and in the CHANGELOG entry the Planner/Coder should add.
- **Compare-before-write** adds a read of the existing managed section per rule. This read already happens in drift/diff; the cost is negligible and the write-avoidance saves IO.
- **Non-determinism is detected reactively, not prevented.** Accepted; preventing it would require a rule sandbox or static analysis, which is out of scope.

## Risks

- A rule whose `transform` legitimately varies by run (e.g. a timestamp the user wants in-content) would now be flagged. Mitigation: the warning is informational; the rule still runs. Documented in the rule-authoring guide.
- The one-time managed-section rewrite (D2) could surprise a user who diffs after upgrading. Mitigation: CHANGELOG note + the rewrite is content-preserving except for the removed stamp.
- Interaction with recovery replay: determinism is what makes replay safe. The Planner SHOULD sequence this change before or alongside `sync-atomicity-and-recovery`, so the recovery change can assume deterministic transforms.
