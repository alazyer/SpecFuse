# Changelog

All notable changes to SpecFuse are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed — Sync idempotency & deterministic output

- **`specfuse sync` is now a true no-op when content is unchanged.** `executeRule`
  now compares the proposed transformed managed-section content to the existing
  on-disk managed section and skips the write (and the registry `recordSync`)
  when they are equal, reporting a structured `unchanged` outcome instead of
  `changed`. Re-running sync with unchanged sources writes no target files and
  does not bump `registry.json` `syncs[].syncedAt`.
- **Built-in rule `transform()` output is now deterministic.** The volatile
  `> Auto-synced ... on ${ctx.today()}` date-stamp header was removed from the
  diffed managed-section content of all built-in rules
  (`plan-to-constitution`, `changes-and-stories`). The authoritative synced
  timestamp already lives in `registry.json` `syncs[].syncedAt`, so a re-sync on
  a later day with identical sources is no longer a spurious change.
- **`unchanged` is now a first-class structured rule outcome** alongside
  `changed`/`forced_overwrite`/`skipped`/`skipped_conflict`/`failed`, surfaced in
  human CLI output, `specfuse sync --json`, and CI output (SARIF/GitHub
  annotations treated as a passing `notice`/`note`).
- **A non-determinism heuristic warning** is now emitted (in `--json`/verbose
  output) when a rule's output changes between two runs with identical source
  hashes, naming the rule as a likely non-deterministic transform.

> **⚠️ One-time managed-section rewrite.** The first `specfuse sync` after this
> change will rewrite every managed section once — to drop the in-content date
> stamp — and report `changed` for each rule on that first run. Subsequent syncs
> with unchanged sources are true no-ops (`unchanged`). This is expected and
> content-preserving except for the removed stamp; the timestamp is retained in
> the registry. Custom rules are not broken, only warned if they embed volatile
> metadata in diffed content.
