## ADDED Requirements

### Requirement: Canonical artifact roots are operation-specific
SpecFuse SHALL expose and document the canonical artifact root for each operation so native product commands, OpenSpec governance artifacts, and archived compatibility artifacts are not conflated.

#### Scenario: Native change command reports native root
- **WHEN** a user runs a native SpecFuse change command that creates, lists, shows, reviews, verifies, or archives a change
- **THEN** command output, help text, warnings, and API return values SHALL refer to `.specfuse/changes` as the native change root
- **AND** they SHALL NOT refer to `openspec/changes` unless the operation is explicitly reading or writing OpenSpec governance artifacts

#### Scenario: OpenSpec governance artifact reports OpenSpec root
- **WHEN** an OpenSpec workflow command or artifact describes this repository's specification package
- **THEN** it SHALL refer to `openspec/changes/<change-name>` and `openspec/specs/<capability>` as governance artifact paths
- **AND** it SHALL NOT imply those paths are the native runtime workspace for `specfuse change` commands

### Requirement: Artifact path registry describes actual runtime paths
The registry and related documentation SHALL describe artifact locations using paths that match the runtime constants.

#### Scenario: Registry path comments and constants are compared
- **WHEN** maintainers inspect `ARTIFACT_PATHS` and adjacent documentation
- **THEN** the documented path for the constitution SHALL match the runtime path `.specfuse/constitution.md`
- **AND** every documented default artifact path SHALL match the value returned by registry path resolution

#### Scenario: Status or guide output includes artifact roots
- **WHEN** a status, guide, or diagnostic command reports where artifacts live
- **THEN** it SHALL derive the path from the same artifact path contract used by core code
- **AND** it SHALL not duplicate hard-coded path prose that can drift from the registry constants

### Requirement: Legacy or unexpected artifact roots are observable
SpecFuse SHALL surface mismatches when both native and non-native roots contain change artifacts that could confuse users or automation.

#### Scenario: Both native and unexpected change roots contain active changes
- **WHEN** diagnostics inspect a project that has active changes under `.specfuse/changes` and unexpected active changes under a non-native root
- **THEN** the diagnostic result SHALL report both roots with a warning code
- **AND** it SHALL identify which root is canonical for native SpecFuse commands

#### Scenario: No unexpected artifact root exists
- **WHEN** diagnostics inspect a project that only uses the canonical native roots for runtime artifacts
- **THEN** no artifact-root mismatch warning SHALL be emitted

### Requirement: Archive and active path semantics are distinct
SpecFuse SHALL distinguish active change roots from archive roots in user-facing and API output.

#### Scenario: Listing active and archived changes
- **WHEN** a user lists changes through CLI or API
- **THEN** active changes SHALL be labeled as active artifacts under `.specfuse/changes/<slug>`
- **AND** archived changes SHALL be labeled as archived artifacts under `.specfuse/changes/archive/<archive-name>`
- **AND** output SHALL NOT require callers to infer active vs archived state from a path suffix alone

