# ADR-001: Managed Section Markers over JSON Store or Separate Files

## Status

Accepted

## Context

SpecFuse needs a way to write auto-generated content into Markdown artifacts (constitution, change proposals) while preserving human-authored content in the same files. The core challenge is **coexistence**: both SpecFuse and users edit the same files, and their changes must not conflict.

Three approaches were considered:

1. **Managed section markers** — HTML comment delimiters (`<!-- specfuse:name:start/end -->`) that wrap SpecFuse-owned content inside the Markdown file itself.
2. **JSON side-store** — A separate JSON file (e.g. `.specfuse/store.json`) holding all SpecFuse-generated content, with the Markdown files referencing it.
3. **Separate managed files** — Each managed section stored in its own dedicated file (e.g. `.specfuse/sections/plan-decisions.md`), with the constitution assembling them at read time.

## Decision

We chose **managed section markers** (option 1). All SpecFuse-generated content lives between `<!-- specfuse:section-name:start -->` and `<!-- specfuse:section-name:end -->` delimiters embedded directly in the Markdown artifacts.

## Rationale

### Why not a JSON side-store?

- **Readability loss**: Developers reading `constitution.md` or `proposal.md` in an editor or on GitHub would not see the actual rules — they'd see empty placeholder sections or references to a JSON blob elsewhere. This breaks the "single-file readability" that Markdown is valued for.
- **Merge complexity**: Git merges would need to reconcile two formats (Markdown + JSON) for the same logical content, increasing the risk of split-brain state.
- **Debugging friction**: When drift occurs, diagnosing what changed requires comparing the JSON store against the rendered Markdown, rather than just opening the file and reading it.

### Why not separate managed files?

- **Fragmentation**: A constitution with 5 managed sections would require 5 additional files plus a 6th "assembly" file. This makes the artifact directory harder to navigate and understand.
- **Assembly step**: Reading the constitution would require a merge step. If the assembly is skipped (e.g. someone opens the file in an editor), they see an incomplete document.
- **Version control noise**: Each sync could modify multiple small files, creating a larger diff footprint and more merge conflicts.

### Why managed markers win

- **Single-file truth**: The Markdown file is the complete, readable artifact. No assembly step, no side-store lookup.
- **Clear boundaries**: The markers are explicit and visually distinctive. Users know exactly which content SpecFuse owns and which they own.
- **Minimal diff**: A sync typically modifies only one section within one file, producing small, focused diffs.
- **No format mixing**: Everything stays in Markdown. Git merges, code review, and diff tools all work naturally.
- **Easy extraction**: The `upsertManagedSection`, `readManagedSection`, and `stripManagedSections` functions provide simple CRUD operations on the delimited blocks.

## Consequences

### Positive

- Users can read the full constitution or change proposal in any Markdown viewer without running a build step.
- SpecFuse and human content coexist safely in the same file.
- Drift detection is straightforward: hash the managed section content and compare against the last-synced hash.

### Negative

- If a user accidentally edits inside the markers, their changes will be overwritten on the next sync. The `drift` command detects this (`TARGET_CHANGED` state) and the remediation message tells the user to move edits outside the markers.
- The markers are HTML comments, which are not rendered in most Markdown viewers. Users viewing rendered Markdown may not see the boundary markers, potentially making it harder to understand where managed content begins and ends. This is mitigated by the `## [SpecFuse Managed] section-name` heading that accompanies each inserted section.
- Very large managed sections could make the file unwieldy. This is unlikely in practice since constitutional rules are typically concise bullet lists.

### Mitigations

- The `drift` command proactively detects `TARGET_CHANGED` and provides remediation guidance.
- The `specfuse doctor` diagnostic checks for malformed markers.
- `stripManagedSections()` allows tools to render just the user-authored content when needed.
