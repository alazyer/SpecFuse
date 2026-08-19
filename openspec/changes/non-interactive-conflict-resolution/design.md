# Design — Non-interactive Conflict Resolution

## Context

`BOTH_CHANGED` conflict resolution is interactive-only: `resolve` (`resolve.js:104, :191`) and `sync --resolve` (`sync.js:87, :311-315`) call `promptChoice()`, which opens a readline interface on stdin with no TTY/CI guard. In CI the command hangs or errors. `--json` only inspects, never applies. There is no `--choice` flag. This blocks CI/automation — the very context SpecFuse's CI features target.

## Decision

**Add `--choice source|target|skip`; detect non-interactive contexts and fail fast; preserve the TTY prompt as the default.**

### Flag wiring

- `resolve <rule-id>` gains `--choice <source|target|skip>` (commander option at `cli.js:547-554`).
- `sync` gains `--choice <source|target|skip>` and an alias `--resolve-conflicts <choice>` if the Planner prefers; `--resolve` (boolean) remains for "prompt on conflict" (TTY only) and now composes with `--choice` for non-interactive.

### Choice → resolution mapping

`src/core/resolver.js` already accepts a `resolution` argument; the existing `applyResolution` handles `source`/`target`. `--choice source` and `--choice target` map directly onto the existing resolution types — **no new resolution logic**. `skip` is new: it means "leave the pair in `BOTH_CHANGED`, do not mutate it," which is implemented by *not* calling `applyResolution` for skipped pairs and continuing. The Planner confirms the exact resolution enum values in `resolver.js:50` (the `Invalid resolution type` throw is where the enum is enforced — `skip` may already exist or may need adding).

### Non-interactive detection

A single helper `isInteractive()`:
- `process.stdin.isTTY === true` → interactive.
- `process.env.CI` set OR `!process.stdin.isTTY` → non-interactive.

Decision matrix in the conflict path:

| `--choice` | Context | Behavior |
|---|---|---|
| provided | any | Apply choice, no prompt, no stdin read. |
| absent | interactive (TTY) | Existing prompt (no regression). |
| absent | non-interactive | Fail fast: exit non-zero, name conflicted rule(s), suggest `--choice`. |

`promptChoice()` (`resolve.js:191`) is only called in the "absent + interactive" cell. The non-interactive-abort path replaces the current "call promptChoice in CI and hang" behavior.

### `sync --resolve` multi-pair handling

`sync`'s `onConflict` callback (`sync.js:87`) currently always calls `promptChoice`. It SHALL:
- If `--choice` provided: apply it to every conflicted pair (source/target) or skip each (skip).
- If `--choice` absent and interactive: prompt per pair (existing behavior).
- If `--choice` absent and non-interactive: abort the sync with a non-zero exit listing all conflicted rules, applying no further mutations.

### `--json` composition

`--json --choice source` SHALL return a structured result of what was resolved (which rule, which choice, resulting state) and exit 0. `--json` without `--choice` in a non-interactive conflict SHALL return structured conflict data AND a non-zero exit with the "needs `--choice`" guidance (today `--json` exits 0 on inspection — this changes only for the unresolvable case; the inspect-only flow can be preserved with an explicit `--inspect` if the Planner wants to keep a zero-exit inspection).

## Trade-offs

- **Fail-fast vs. silent-default**: Failing fast (non-zero) in CI when a conflict is unresolvable is safer than silently picking `source` or `target`. The user must opt in via `--choice`. This matches how `git` behaves on conflicts in CI.
- **`skip` semantics**: `skip` is valuable for "apply the safe pairs, leave conflicts for human review" — the sync completes with a report of skipped pairs rather than aborting entirely. This is a new capability but a small, well-scoped addition.
- **`--json` exit code change**: Making non-interactive `--json` exit non-zero when a conflict needs resolution is a minor behavior change, but it is the correct one (CI gates on exit code). The Planner may add `--inspect` to preserve a zero-exit inspection path if needed.

## Non-goals

- Does not add a 3-way merge / auto-merge for conflicts (out of scope; `skip` + human review is the escape hatch).
- Does not change the interactive prompt's option set (still source/target/merge-manual; `skip` is exposed only via the flag, though the Planner may add it to the interactive prompt too).
- Does not change the conflict-detection or drift-state logic.

## Test strategy

- Non-TTY + no `--choice` → exits non-zero with guidance, no stdin read (assert no readline opened / stdin not consumed).
- `--choice source` on a `BOTH_CHANGED` rule → applied, registry `IN_SYNC`, no prompt.
- `--choice skip` in `sync --resolve` → safe pairs applied, conflicted pairs left `BOTH_CHANGED`, exit reports skipped.
- TTY + no `--choice` → prompt shown (existing tests unchanged).
- `--json --choice target` → structured result, exit 0.
- `CI=1` env treated identically to non-TTY.
