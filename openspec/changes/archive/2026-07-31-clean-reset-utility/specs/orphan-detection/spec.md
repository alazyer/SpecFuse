# Spec: Orphan Detection

## SHALL Requirements

1. **SHALL** detect files not tracked by any rule.
2. **SHALL** detect registry entries for non-existent artifacts.
3. **SHALL** detect empty directories.

## SHOULD Requirements

4. **SHOULD** exclude `archive/` directory from empty directory check.
5. **SHOULD** handle symbolic links correctly.

## Test Scenarios

### Scenario: Orphaned file
**Given** file `.specfuse/orphan.md` not referenced by any rule
**When** `findOrphanedFiles()` is called
**Then** orphan.md is in result list

### Scenario: Stale registry entry
**Given** registry sync entry for `plan:old-artifact`
**And** `old-artifact.md` does not exist
**When** `findStaleRegistryEntries()` is called
**Then** entry is in result list
