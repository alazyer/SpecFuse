## Why

When a `BOTH_CHANGED` drift conflict arises, SpecFuse offers two ways to resolve it — but neither works in CI or any non-interactive context:

1. **`specfuse resolve <rule-id>`** — when run without `--json`, it calls `promptChoice()` (`src/commands/resolve.js:104`), which opens a readline `createInterface` on stdin (`resolve.js:191`) with **no TTY/`CI` check**. In CI, stdin is empty or closed, so the command either errors or hangs waiting on input that never comes. With `--json` it only *dumps* the conflict data and exits (`resolve.js:70-73`) — it cannot *apply* a resolution.
2. **`specfuse sync --resolve`** — builds an `onConflict` callback that calls `promptChoice()` (`src/commands/sync.js:87`, `:311-315`), again with no non-interactive fallback. A CI sync that hits a conflict blocks.

There is **no `--choice` / `--non-interactive` flag** anywhere in the resolve command options (`cli.js:547-554`: only `--root`, `--json`). So a pipeline that wants to resolve a `BOTH_CHANGED` conflict with a deterministic policy (e.g. "always accept source in CI") has no way to do so without an interactive terminal. The pre-commit drift hook (`install-hooks`) runs in a non-interactive context and will simply fail on any conflict instead of being resolvable.

This blocks CI/automation adoption — the exact use case SpecFuse's CI integration features (`specfuse ci`, `--fail`, GitHub Actions) are built for.

## What Changes

- Define a non-interactive resolution contract: `resolve` and `sync --resolve` SHALL accept a `--choice <source|target|skip>` flag that applies a resolution without prompting, and SHALL detect non-interactive (non-TTY / `CI` env) contexts and fail fast with an actionable message when a conflict needs resolution but no `--choice` was provided (instead of hanging on stdin).
- Add `--choice source|target|skip` to the `resolve` command and to `sync`'s conflict-handling options. `skip` leaves the pair in `BOTH_CHANGED` and continues (useful for "apply what's safe, leave conflicts for human review").
- When `--choice` is provided, the command SHALL apply that resolution to every conflicted pair (single pair for `resolve <rule-id>`; all conflicts for `sync --resolve`) without reading stdin.
- When no `--choice` is provided AND the context is non-interactive (no TTY on stdin, or `CI` is set), the command SHALL exit non-zero with a message naming the conflicted rule(s) and the available `--choice` values — never block on stdin.
- When no `--choice` is provided AND stdin IS a TTY, the existing interactive prompt behavior is preserved (no regression).
- `--json` output SHALL remain available for both the inspect (`--json` without `--choice`) and apply (`--json --choice source`) flows, returning a structured result of what was resolved.

## Capabilities

### New Capabilities

- `non-interactive-resolution`: Allows resolving `BOTH_CHANGED` conflicts deterministically in CI and automation via a `--choice` flag, with fail-fast behavior when a conflict is unresolvable non-interactively.

### Modified Capabilities

- `conflict-resolution`: The `resolve` command gains `--choice` and non-interactive detection; the interactive prompt becomes the TTY-only default rather than the only path.

## Impact

- **CLI**: `src/commands/resolve.js` (`:70-73` JSON path, `:104` promptChoice, `:191` createInterface) and the command registration at `cli.js:547-554`; `src/commands/sync.js` (`:87`, `:311-315` onConflict callback) and the sync command options.
- **Core**: `src/core/resolver.js` — `applyResolution` already takes a `resolution` argument; the new `--choice` maps to the existing resolution types, so no new resolution logic is needed, only wiring.
- **API**: `src/api/sync-ops.mjs` `resolve()` — accept a `choice` option alongside the existing interactive flow; expose the non-interactive path programmatically.
- **Tests**: non-TTY/CI context → no `--choice` → exits non-zero with actionable message (no hang); `--choice source` applies without prompt; `--choice skip` leaves pair conflicted; TTY path unchanged.
- **Dependencies**: None.
- **Breaking behavior**: None intended. Interactive users see no change. The only behavior change is that a previously-hanging CI invocation now fails fast with guidance — which is strictly better.
