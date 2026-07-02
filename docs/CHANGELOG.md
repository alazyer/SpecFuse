# Changelog

All notable changes to SpecFuse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0-alpha.5] — 2026-05-20

### Features

- Add customizable artifact schema system (`specfuse schema init`, `specfuse schema show`)
- Support per-artifact generation instructions in `.specfuse/artifact-schema.json`
- Wildcard artifact keys (e.g. `change.*`) apply instructions to all matching sub-keys
- Schema instructions are appended to generated templates as `## Custom Instructions (Schema)` sections
- Artifact schema validation: requires version 1, rejects unsupported versions and malformed configurations

## [4.0.0-alpha.4] — 2026-05-19

### Features

- Add `specfuse guide` command (alias: `specfuse start`) for role-based onboarding
- Four persona modes: `new-user`, `planner`, `developer`, `qa`
- Phase-aware guidance: recommended next steps change based on detected project lifecycle phase
- `--json` flag on guide command for machine-readable output (editor/agent integration)
- Levenshtein-based CLI error suggestions for unknown commands and subcommands
- Recursive suggestion handling for nested command groups (e.g. `specfuse plan design flow`)
- Smart step pruning: guide omits steps for artifacts that already exist

## [4.0.0-alpha.3] — 2026-05-19

### Features

- Introduce design system planning workflow (`specfuse plan design system/flow/screen`)
- Design artifacts live in `.specfuse/plan/design/` (system.md, flows/, screens/)
- `specfuse plan design list` shows all design artifact status
- Enhance change management: review and verify lifecycle states (`draft → active → reviewed → verified → archived`)
- `specfuse change review` generates review.md with constitutional checklist + acceptance criteria checklist
- `specfuse change verify` generates verify.md with confirmation checklist
- Verification gate on archival: `specfuse change archive` requires `verify.md` status `pass` (unless `--force`)
- Change show command displays managed constitutional headers and artifact file presence
- Change list shows review status, verification progress, and UI impact per change
- Frontmatter parsing for proposal, review, and verify documents (gray-matter integration)

## [4.0.0-alpha.2] — 2026-05-10

### Features

- SpecFuse v3/v4 setup: `.specfuse/` directory scaffold, registry, and constitution
- Core commands: `init`, `sync`, `drift`, `diff`, `watch`, `status`, `doctor`, `install-hooks`
- Planning commands: `plan prd`, `plan arch`, `plan story`, `plan list`
- Constitution management: `specify init`, `specify add`, `specify show`
- Change proposals: `change new`, `change list`, `change show`, `change archive`
- Two-pass sync engine: Pass A (inbound → constitution) then Pass B (constitution → outbound)
- Built-in sync rules: architecture → constitution, PRD → constitution, stories → constitution, archive → constitution, constitution → change proposals
- Managed section protocol: `<!-- specfuse:name:start/end -->` markers for coexisting SpecFuse and user content
- Drift detection: six states (IN_SYNC, SOURCE_CHANGED, TARGET_CHANGED, BOTH_CHANGED, NEVER_SYNCED, SOURCE_MISSING)
- Programmatic API: `import { sync, drift, diff, status, phase } from 'specfuse/api.mjs'`
- Atomic file writes (temp file → rename) for safe sync operations
- Git hook support: pre-commit drift check and post-commit sync
- Watch mode: auto-sync on file changes with 400ms debounce (chokidar)
- Registry persistence: `.specfuse/registry.json` tracks phase, sync records, loaded rules
- User plugin rules: `.specfuse/rules.mjs` for custom sync rules (skipped in CI unless `--allow-plugins`)

### Breaking Changes

- v4 uses a different artifact ID scheme than v3. Pre-v4 registries are migrated non-destructively but reset sync state because artifact IDs changed.

## [4.0.0-alpha] — 2026-04-29

### Features

- Initial SpecFuse codebase
- Project scaffolding and basic structure
- Template files for planning and change artifacts

---

[4.0.0-alpha.5]: https://github.com/alazyer/llm-gateway/commit/710559c
[4.0.0-alpha.4]: https://github.com/alazyer/llm-gateway/commit/ade921d
[4.0.0-alpha.3]: https://github.com/alazyer/llm-gateway/commit/2a7f86f
[4.0.0-alpha.2]: https://github.com/alazyer/llm-gateway/commit/d842178
[4.0.0-alpha]: https://github.com/alazyer/llm-gateway/commit/6bed10a
