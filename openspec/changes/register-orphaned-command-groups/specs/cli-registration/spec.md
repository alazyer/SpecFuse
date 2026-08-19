## MODIFIED Requirements

### Requirement: CLI router registers every shipped command handler
The `specfuse` CLI router (`src/cli.js`) SHALL import and register every command handler module present in `src/commands/`, so that no implemented command is unreachable at runtime. The five currently orphaned groups — `ci`, `template`, `clean`/`reset`, `config`, and `history` — SHALL each be registered with subcommands matching their handler exports.

#### Scenario: ci command group is invocable
- **WHEN** a user runs `specfuse ci drift` (or `ci validate`, `ci check`, `ci init`) on an initialized project
- **THEN** the command SHALL execute the corresponding handler in `src/commands/ci.js` and SHALL NOT produce an "Unknown command" error
- **AND** `specfuse --help` SHALL list the `ci` command group

#### Scenario: template command group is invocable
- **WHEN** a user runs `specfuse template list` (or `template show`, `template copy`, `template validate`)
- **THEN** the command SHALL execute the corresponding handler in `src/commands/template.js` and SHALL NOT produce an "Unknown command" error
- **AND** `specfuse --help` SHALL list the `template` command group

#### Scenario: clean and reset commands are invocable
- **WHEN** a user runs `specfuse clean` or `specfuse reset`
- **THEN** the command SHALL execute the corresponding handler in `src/commands/clean.js` and SHALL NOT produce an "Unknown command" error

#### Scenario: config command group is invocable
- **WHEN** a user runs `specfuse config get registry.phase` (or `config list`, `config set`, `config validate`, `config path`)
- **THEN** the command SHALL execute the corresponding handler in `src/commands/config.js` and SHALL NOT produce an "Unknown command" error

#### Scenario: history command is invocable
- **WHEN** a user runs `specfuse history` (and its subcommands if any)
- **THEN** the command SHALL execute the corresponding handler in `src/commands/history.js` and SHALL NOT produce an "Unknown command" error

#### Scenario: Help output reflects all commands
- **WHEN** a user runs `specfuse --help`
- **THEN** the help text SHALL include `ci`, `template`, `clean`, `reset`, `config`, and `history` alongside the already-registered commands

### Requirement: ci init default output path matches documentation
The `ci init` command SHALL default its generated workflow output path to the filename documented in `docs/ci-integration.md`, so that running the documented command produces the file the docs tell users to expect.

#### Scenario: ci init writes the documented workflow file
- **WHEN** a user runs `specfuse ci init` without an explicit output path
- **THEN** the generated GitHub Actions workflow SHALL be written to the path named in `docs/ci-integration.md` (reconciling the current code default of `.github/workflows/specfuse.yml` against the documented `specfuse-ci.yml`)
- **AND** the command output SHALL report the exact path written

## NEW Requirements

### Requirement: No command handler is left unregistered
The repository SHALL include a test that fails if any module in `src/commands/` exporting a command handler is not reachable through the CLI router, preventing future orphan-command regressions.

#### Scenario: An orphaned command handler is added
- **WHEN** a developer adds a new module under `src/commands/` that exports a command entry point but does not register it in `src/cli.js`
- **THEN** the registration guard test SHALL fail on the next test run

#### Scenario: All currently shipped handlers are registered
- **WHEN** the registration guard test runs on the current codebase
- **THEN** it SHALL assert that `ci`, `template`, `clean`, `config`, and `history` are invocable through `specfuse <command>` and exit 0 on a valid fixture project
