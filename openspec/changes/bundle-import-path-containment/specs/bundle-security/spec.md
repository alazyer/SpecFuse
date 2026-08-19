## ADDED Requirements

### Requirement: Bundle import rejects entries that escape the extraction root
Every file and directory written during bundle import SHALL resolve to a path inside the project's designated extraction root (`.specfuse/` under `projectRoot`). An entry whose resolved path escapes the extraction root — via `..` traversal, an absolute path, or a symlinked intermediate directory — SHALL be rejected with a structured `BundleValidationError` before any write occurs for that entry.

#### Scenario: Bundle entry with parent-directory traversal is rejected
- **WHEN** a bundle is imported and one of its entries has a name containing `../` sequences (e.g. `../../.ssh/authorized_keys`)
- **THEN** the import SHALL reject that entry with a structured `BundleValidationError` naming the offending entry and the target path it would have escaped to
- **AND** no file SHALL be written outside the extraction root
- **AND** the import SHALL abort without leaving partial writes or mutating the registry

#### Scenario: Bundle entry with an absolute path is rejected
- **WHEN** a bundle entry has an absolute path name (e.g. `/etc/passwd` or `C:\Windows\system32\...`)
- **THEN** the import SHALL reject that entry with a `BundleValidationError` before writing
- **AND** the absolute path SHALL not be used as a write target

#### Scenario: Well-formed bundle imports unchanged
- **WHEN** a bundle is imported whose every entry resolves inside the extraction root (the normal case: `plan/...`, `changes/...`)
- **THEN** the import SHALL proceed exactly as before — no entry is rejected, all files are written to their intended relative paths
- **AND** no behavioral or output change SHALL be visible to the user

### Requirement: Containment check covers every write site in extraction
The path-containment check SHALL be applied at every site in the extraction flow that writes to a path derived from an entry name, including directory creation, file write, and the rename strategy that substitutes the change name. No write SHALL bypass the containment check.

#### Scenario: Rename strategy also validates the substituted path
- **WHEN** a bundle is imported with the rename strategy and `entry.fileName.replace(changeName, newName)` is computed
- **THEN** the resulting path SHALL pass the same containment check as a plain entry
- **AND** a renamed entry that escapes the root SHALL be rejected identically to a `../` entry

### Requirement: Malicious-entry rejection is observable and non-destructive
When a malicious entry is detected, the rejection SHALL be reported as a structured error to both CLI and API consumers, and the import SHALL leave the project in a recoverable state.

#### Scenario: CLI reports the offending entry on rejection
- **WHEN** `specfuse import <bundle>` encounters an escaping entry
- **THEN** the CLI SHALL print an actionable error naming the offending entry and exit with a non-zero code
- **AND** the API `import()` call SHALL throw a `BundleValidationError` (an `instanceof` the SpecFuse error hierarchy)

#### Scenario: Partial state is recoverable
- **WHEN** an escaping entry is detected after some earlier entries in the same bundle were already written
- **THEN** the already-written entries SHALL remain in the extraction root (no partial-rollback requirement of the well-formed entries)
- **AND** no orphan temp files SHALL be left outside the extraction root
- **AND** the registry SHALL not have been mutated by the failed import
