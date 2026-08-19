## Context

An audit of the CLI router (`src/cli.js`, ~735 lines) against the `src/commands/` directory found five command handler modules that are fully implemented, tested, and documented but never imported or registered:

| Group | Handler module | API module | Test file | OpenSpec spec |
|---|---|---|---|---|
| `ci` | `src/commands/ci.js` | `src/api/ci.mjs` | `src/tests/ci.test.js` | `openspec/specs/ci-command/` |
| `template` | `src/commands/template.js` | `src/api/template.mjs` | `src/tests/template.test.js` | `openspec/specs/template-cli/` |
| `clean`/`reset` | `src/commands/clean.js` | `src/api/clean.mjs` | `src/tests/clean.test.js` | `openspec/specs/clean-command/` |
| `config` | `src/commands/config.js` | `src/api/config.mjs` | `src/tests/config.test.js` | `openspec/specs/config-command/` |
| `history` | `src/commands/history.js` | `src/api/history.mjs` | `src/tests/history.test.js` | `openspec/specs/history-command/` |

`src/cli.js` imports 17 command modules and registers ~22 top-level commands. The five groups above are absent from both the import block and the `.command(...)` registrations. Each handler already accepts an options object shaped the same way the existing CLI adapters build them (`{ root, ...flags }`), so registration is mechanical.

A secondary defect lives in `src/commands/ci.js`: `ciInit()` defaults the output path to `.github/workflows/specfuse.yml` with a comment claiming "to match spec", but `docs/ci-integration.md` and the OpenSpec spec both say `specfuse-ci.yml`. Registering the command surfaces this three-way disagreement, so it is fixed in the same change.

## Goals / Non-Goals

**Goals:**

- Make the five orphaned command groups reachable through `specfuse` with no behavioral change to existing commands.
- Reconcile the `ci init` default output path with its documentation.
- Add a regression guard so a future handler cannot ship unregistered.

**Non-Goals:**

- Refactoring the command handlers or moving business logic into core (that is owned by the `sweep-architecture-weaknesses` W2 work).
- Adding `--json` flags to the newly registered commands (separate change; tracked by the package-exports/api-surface and DX findings).
- Changing the programmatic API surface (owned by the `package-exports-api-surface` change).

## Decisions

### D1: Mirror existing option shapes when wiring handlers
Each handler already exposes a function signature compatible with the `async (o) => handler(resolve(o.root), { ...flags })` adapter pattern used by every currently-registered command. Registration SHALL copy that pattern rather than re-shaping handler options, so no handler code changes.

### D2: Reconcile `ci init` path to the documented name
The default output filename SHALL be set to the value named in `docs/ci-integration.md` (`specfuse-ci.yml`), and the misleading "to match spec" comment SHALL be removed. The docs are the user-facing contract; the code comment was self-contradicting.

### D3: Registration guard test, not a build step
The "no orphaned handlers" requirement is enforced by a test that invokes each registered command on a fixture project and exits 0, plus a help-output assertion. A static "every export has a registration" check is fragile because command modules also export helpers; behavioral invocation is the reliable signal.

## Trade-offs

- **Option shapes are copied, not centralized.** This keeps the change minimal and avoids touching the W2 seam work. The cost is continued option-object duplication until W2 lands; that is an accepted, tracked debt.
- **Reconciling `ci init` to the docs name is a behavior change** for the (currently unreachable) command. Because the command has never been reachable, there are no existing users to break; aligning with docs is strictly safer than the current self-contradicting state.

## Risks

- A handler may assume a flag that the CLI adapter does not pass (e.g. an option only the API supplies). Mitigation: the invocation test exercises each command end-to-end on a fixture; missing options surface as a non-zero exit.
- `clean`/`reset` are destructive operations. Mitigation: their existing handlers already require confirmation or `--force`; registration does not change those guards, and the test uses a throwaway fixture with `--force` where required.
