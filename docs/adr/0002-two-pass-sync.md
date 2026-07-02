# ADR-002: Two-Pass Sync (Pass A then Pass B) over Single-Pass or Manual Sync

## Status

Accepted

## Context

SpecFuse must synchronize planning artifacts, stories, and archived changes into the constitution, and then propagate constitutional constraints into active change proposals. The question is: should this be done in one pass, two passes, or left entirely to manual user orchestration?

Three approaches were considered:

1. **Two-pass sync** — Pass A gathers all inbound content (plan artifacts, stories, archive) into the constitution. Only after Pass A completes does Pass B read the settled constitution and inject constraints into change proposals.
2. **Single-pass sync** — All rules run in one pass, in arbitrary order. Rules that read the constitution might see partially-updated content from rules that haven't yet written to it.
3. **Manual sync** — Users run separate commands for each sync direction (e.g. `specfuse sync inbound` then `specfuse sync outbound`), manually ensuring the order.

## Decision

We chose **two-pass sync** (option 1). Pass A rules run first and complete fully; Pass B rules run second, reading a constitution that reflects all Pass A updates.

## Rationale

### Why not single-pass?

- **Consistency risk**: In a single pass, a Pass B rule that reads the constitution might execute before a Pass A rule that updates it. The change proposal would receive stale or partial constitutional content — a split-brain state that is hard to detect and debug.
- **Ordering ambiguity**: Without explicit pass assignment, the rule execution order would depend on implementation details (file order, import order) rather than architectural intent. This makes the system fragile and hard to extend.
- **No error isolation**: If any rule fails in a single-pass system, there's no clean boundary to stop downstream writes. A failed inbound rule could leave the constitution in an inconsistent state, and outbound rules would still propagate that inconsistency.

### Why not manual sync?

- **User burden**: Requiring users to manually sequence `specfuse sync inbound` and `specfuse sync outbound` adds cognitive overhead and increases the risk of running them in the wrong order or forgetting one.
- **Drift accumulation**: If a user only runs inbound sync, change proposals remain stale. If they only run outbound sync, the constitution misses new planning content. Either direction alone leaves artifacts out of sync.
- **No automation**: Watch mode (`specfuse watch`) and git hooks (`specfuse install-hooks`) rely on a single command that does everything correctly in one invocation. Manual sync would require hooking two separate commands in sequence.

### Why two-pass wins

- **Guaranteed consistency**: Every Pass B rule sees the same, fully-updated constitution. No rule reads partial or stale content.
- **Error containment**: If any Pass A rule fails, Pass B is skipped entirely. This prevents writing stale constitutional headers into change proposals. The user gets a clear error and can fix the source before re-running.
- **Single command**: `specfuse sync` does both passes automatically. No manual sequencing required.
- **Extensibility**: New rules declare `pass: 'A'` or `pass: 'B'`, making their execution semantics explicit. Adding a new Pass A rule never breaks Pass B consistency.

## Consequences

### Positive

- Change proposals always receive a consistent set of constitutional constraints.
- Error handling is simple: Pass A failures block Pass B entirely.
- Watch mode and git hooks work with a single `specfuse sync` invocation.

### Negative

- Two-pass sync is slower than single-pass for small projects where consistency doesn't matter (e.g. no active change proposals). Pass B rules always run even if there are no targets.
- The pass model requires rule authors to think about which pass their rule belongs to. A rule that both reads and writes the constitution would need to be split or carefully assigned.
- There is no Pass C or higher. Rules that need to read change proposals (rather than just write to them) would need to run in Pass B and accept that other Pass B rules haven't yet completed. This is not a current use case but could become relevant if future rules need to cross-reference active changes.

### Mitigations

- Pass B rules that find no active change directories simply skip (returning `changed: false`). The overhead is minimal.
- The rule interface requires explicit `pass` declaration, making the assignment a conscious design choice rather than an accidental omission.
- If a Pass C becomes necessary, the engine can be extended with an additional filter step after Pass B completes, maintaining the same sequential guarantee.
