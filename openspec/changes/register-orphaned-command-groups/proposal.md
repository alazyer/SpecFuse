## Why

Five fully-implemented command groups — `ci`, `template`, `clean`/`reset`, `config`, and `history` — have complete handler modules (`src/commands/ci.js`, `template.js`, `clean.js`, `config.js`, `history.js`), corresponding programmatic API modules, dedicated test files, OpenSpec capability specs, and user-facing documentation, yet none are registered in the CLI router (`src/cli.js`). From the user's perspective these are dead code: running `specfuse ci drift`, `specfuse template list`, `specfuse config get`, `specfuse history`, or `specfuse clean` produces "Unknown command" with a Levenshtein suggestion list that never includes the intended command.

This is the single largest functional gap in the project. Hundreds of lines of working, tested code are unreachable at runtime, while `docs/ci-integration.md` and `docs/template-customization.md` document command surfaces that cannot be invoked. The OpenSpec specs under `openspec/specs/` (e.g. `ci-command`, `template-cli`, `clean-command`, `config-command`, `history-command`) assert behavior that does not hold at runtime, making the governance artifacts untrustworthy.

The fix is a pure wiring change — import the existing command handlers in `src/cli.js` and register their subcommands — with no new business logic and no breaking changes to existing commands.

## What Changes

- Register the `ci` command group (`ci drift`, `ci validate`, `ci check`, `ci init`) in the CLI router, wiring it to `src/commands/ci.js`.
- Register the `template` command group (`template list`, `template show`, `template copy`, `template validate`) in the CLI router, wiring it to `src/commands/template.js`.
- Register the `clean` and `reset` commands in the CLI router, wiring them to `src/commands/clean.js`.
- Register the `config` command group (`config list`, `config get`, `config set`, `config validate`, `config path`) in the CLI router, wiring it to `src/commands/config.js`.
- Register the `history` command group in the CLI router, wiring it to `src/commands/history.js`.
- Add CLI-level integration tests asserting each newly registered command is invocable and exits 0 on a valid project, and that `specfuse --help` lists them.
- Resolve the documented default-output-path disagreement for `ci init` (code defaults to `.github/workflows/specfuse.yml`; docs and spec say `specfuse-ci.yml`) so the registered command matches its documentation.

## Capabilities

### New Capabilities

- `cli-registration`: Ensures every command handler module that ships in `src/commands/` is reachable through the `specfuse` CLI router, and that the CLI help surface and command suggestion list reflect all implemented commands.

### Modified Capabilities

- `ci-command`: Restores runtime reachability of the `specfuse ci` command group so its documented subcommands are invocable.
- `template-cli`: Restores runtime reachability of the `specfuse template` command group so its documented subcommands are invocable.
- `clean-command`: Restores runtime reachability of `specfuse clean` and `specfuse reset`.
- `config-command`: Restores runtime reachability of the `specfuse config` command group.
- `history-command`: Restores runtime reachability of the `specfuse history` command group.

## Impact

- **CLI router**: `src/cli.js` — add imports for the five command modules and register their `.command(...)` trees, mirroring the option shapes already accepted by each handler.
- **Command modules**: none modified for behavior; `src/commands/ci.js` default output path reconciled with docs.
- **Tests**: `src/tests/v4.test.js` or a new `src/tests/cli-registration.test.js` — add invocation + help assertions for the five groups.
- **Docs**: no structural changes required; `docs/ci-integration.md` and `docs/template-customization.md` already describe the commands (they become accurate once the commands are registered).
- **Dependencies**: None.
- **Breaking behavior**: None. This only makes unreachable commands reachable; existing commands and their options are unchanged.
