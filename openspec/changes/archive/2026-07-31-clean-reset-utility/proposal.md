---
status: active
created: 2026-07-28
---

# Change Proposal: Clean and Reset Utility

## Overview

Add a `specfuse clean` command that removes orphaned files, stale registry entries, and other accumulated cruft. This helps maintain a healthy project state and recover from edge cases.

## Problem

1. **Orphaned files** — Deleted changes may leave behind registry entries or partial files
2. **Stale state** — Registry can have entries for artifacts that no longer exist
3. **No recovery** — When things get into a bad state, no way to clean up without manual intervention
4. **No reset** — Cannot easily reset to a clean state while preserving important data

## Scope

**In scope:**
- `specfuse clean` — Remove orphaned files and stale registry entries
- `specfuse clean --dry-run` — Show what would be cleaned without doing it
- `specfuse clean --registry` — Clean only registry entries
- `specfuse clean --orphans` — Clean only orphaned files
- `specfuse reset` — Reset to initial state (preserves plan/ and archive/)
- `specfuse reset --hard` — Full reset including plan artifacts

**Out of scope:**
- Backup/restore functionality
- Selective cleaning by artifact type
- Undo for clean operations

## Acceptance Criteria

- [ ] `specfuse clean --dry-run` lists what would be removed without removing anything
- [ ] `specfuse clean` removes registry entries for non-existent artifacts
- [ ] `specfuse clean` removes empty directories in `.specfuse/changes/`
- [ ] `specfuse clean --orphans` removes files not tracked by any rule
- [ ] After `specfuse clean`, `specfuse doctor` reports no orphan-related warnings
- [ ] `specfuse reset` clears registry sync state but preserves plan/ and archive/
- [ ] `specfuse reset --hard` removes all artifacts except `.specfuse/` directory itself
- [ ] All clean commands support `--json` output
- [ ] Clean operations are logged to history

## Impact

- **Maintenance:** Easy to keep project clean
- **Recovery:** Can fix broken states without manual file editing
- **Onboarding:** New team members can reset if needed

## Risks

- Data loss if user runs clean without understanding
- Need clear warnings before destructive operations
- May remove files user intended to keep

## Related

- Extends `src/core/registry.js` with cleanup methods
- New command file: `src/commands/clean.js`
- New core module: `src/core/orphan-detector.js`
- New test file: `src/tests/clean.test.js`
