## 1. Register the ci command group

- [ ] 1.1 Import `ciDrift`, `ciValidate`, `ciCheck`, `ciInit` from `../commands/ci.js` in `src/cli.js`.
- [ ] 1.2 Register a `ci` command tree with `drift`, `validate`, `check`, and `init` subcommands, mirroring the option shapes the handlers already accept (e.g. `--root`, `--fail`, `--json`, output-path flags for `init`).
- [ ] 1.3 Reconcile `ciInit()` default output path in `src/commands/ci.js` to the filename documented in `docs/ci-integration.md` (`specfuse-ci.yml`); remove the misleading "to match spec" comment.

## 2. Register the template command group

- [ ] 2.1 Import the template handlers from `../commands/template.js` in `src/cli.js`.
- [ ] 2.2 Register a `template` command tree with `list`, `show`, `copy`, and `validate` subcommands.

## 3. Register the clean / reset commands

- [ ] 3.1 Import `cleanCommand`, `resetCommand` from `../commands/clean.js` in `src/cli.js`.
- [ ] 3.2 Register `clean` and `reset` top-level commands with their existing option/confirmation flags.

## 4. Register the config command group

- [ ] 4.1 Import the config handlers from `../commands/config.js` in `src/cli.js`.
- [ ] 4.2 Register a `config` command tree with `list`, `get`, `set`, `validate`, and `path` subcommands.

## 5. Register the history command group

- [ ] 5.1 Import the history handlers from `../commands/history.js` in `src/cli.js`.
- [ ] 5.2 Register the `history` command (and any subcommands) with their existing option shapes.

## 6. Add registration guard tests

- [ ] 6.1 Add a test that invokes `specfuse <command>` for `ci drift`, `template list`, `config list`, `history`, and `clean` on a fixture project and asserts exit 0.
- [ ] 6.2 Add a test asserting `specfuse --help` output lists `ci`, `template`, `clean`, `reset`, `config`, and `history`.
- [ ] 6.3 Add the registration-guard test asserting that any module under `src/commands/` exporting a command entry point is reachable through the router (document a clear failure message when an orphan is detected).

## 7. Verify

- [ ] 7.1 Run `pnpm test` and confirm the new registration tests pass alongside the existing suite (678+ tests).
- [ ] 7.2 Run `node bin/specfuse.js ci init` (and one subcommand per group) on a throwaway fixture and confirm no "Unknown command" errors and the documented output path is produced.
- [ ] 7.3 Confirm `docs/ci-integration.md` and `docs/template-customization.md` examples now run as written.
