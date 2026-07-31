# Spec: Orphan Detection



## Purpose



Captured from archived OpenSpec changes after implementation.



## Requirements



### Requirement: Orphan Detection
The system SHALL provide the implemented orphan detection capability.

- SHALL detect files not tracked by any rule.
- SHALL detect registry entries for non-existent artifacts.
- SHALL detect empty directories.
- SHOULD exclude `archive/` directory from empty directory check.
- SHOULD handle symbolic links correctly.

#### Scenario: Orphaned file
- **GIVEN** file `.specfuse/orphan.md` not referenced by any rule
- **WHEN** `findOrphanedFiles()` is called
- **THEN** orphan.md is in result list
#### Scenario: Stale registry entry
- **GIVEN** registry sync entry for `plan:old-artifact`
- **AND** `old-artifact.md` does not exist
- **WHEN** `findStaleRegistryEntries()` is called
- **THEN** entry is in result list
