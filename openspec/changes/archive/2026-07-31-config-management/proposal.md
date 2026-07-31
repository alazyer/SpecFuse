---
status: active
created: 2026-07-28
---

# Change Proposal: Unified Configuration Management

## Overview

Add a `specfuse config` command that provides a unified interface for viewing and managing all SpecFuse configuration: artifact schema, registry settings, and plugin rules. Currently configuration is scattered across multiple files with no consistent interface.

## Problem

1. **Scattered config** — Settings live in `artifact-schema.json`, `registry.json`, and `.specfuse/rules.mjs`
2. **No visibility** — Users don't know what settings exist or where to find them
3. **No validation** — No way to validate config before runtime errors occur
4. **No migration** — When upgrading, no way to see what config needs updating

## Scope

**In scope:**
- `specfuse config list` — Show all configuration keys and values
- `specfuse config get <key>` — Get a specific config value
- `specfuse config set <key> <value>` — Set a config value
- `specfuse config validate` — Validate all configuration
- `specfuse config path` — Show where config files are located
- Unified config schema with type checking

**Out of scope:**
- Remote config storage
- Config profiles or environments
- Encrypted secrets

## Acceptance Criteria

- [ ] `specfuse config list` shows all config keys grouped by source (schema, registry, rules)
- [ ] `specfuse config get phase` returns the current project phase
- [ ] `specfuse config get schema.version` returns the artifact schema version
- [ ] `specfuse config set phase feature-dev` updates the phase in registry
- [ ] `specfuse config validate` exits 0 when all config is valid
- [ ] `specfuse config validate` exits 1 and reports errors for invalid config
- [ ] `specfuse config path` outputs paths to all config files
- [ ] Config keys use dot notation: `schema.version`, `registry.phase`, `rules.plugins`
- [ ] All commands support `--json` output

## Impact

- **Users:** Single command to understand and manage all settings
- **Debugging:** Can quickly verify config is correct
- **Automation:** Scripts can read/write config programmatically

## Risks

- Breaking change if existing tools parse config files directly
- Need to handle config file permissions
- Migration from scattered to unified may be confusing

## Related

- Extends `src/core/registry.js`, `src/core/artifact-schema.js`
- New command file: `src/commands/config.js`
- New core module: `src/core/config-manager.js`
- New test file: `src/tests/config.test.js`
