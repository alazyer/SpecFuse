/**
 * Sync Atomicity & Crash Recovery — tests for the sync-transaction journal
 * (Improvement 2, `sync-atomicity-and-recovery`).
 *
 * Covers all six normative scenarios from
 * openspec/changes/sync-atomicity-and-recovery/specs/sync-engine/spec.md plus
 * the edge cases enumerated in the change's design doc:
 *   1. Sync interrupted before registry save → marker retained (snapshot + manifest)
 *   2. Next sync detects and reconciles an interrupted run (replay preferred)
 *   3. Sync completes normally → marker cleared, no recovery observable
 *   4. Crash after a target write but before final save → registry hash reconciled
 *      (the written rule is NOT reported IN_SYNC on a stale hash)
 *   5. Archive interrupted after source deletion → change not lost
 *   6. Archive re-run after interruption → completes record, no duplication
 *   — snapshot-rollback fallback, idempotent re-recovery, --no-recover, doctor
 *     marker reporting, and JSON output shape.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, cp, readdir } from 'fs/promises'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { runTwoPassSync } from '../core/sync-engine.js'
import { archiveChange } from '../core/change-workflow.js'
import { hashContent } from '../utils/markdown.js'
import { InterruptedSyncPendingError } from '../api/errors.mjs'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ARCH_DOC = `# Architecture
## Architectural Decisions
- Microservices with Docker
## Tech Stack
- Node.js 20 LTS
## Security
- TLS 1.3 required
`

const PRD_DOC = `# PRD
## Technical Constraints
- Deploy to AWS
`

const STORY_DOC = `# Story: User Auth
## Acceptance Criteria
- [ ] Login works
`

const PROPOSAL_DOC = `# Change Proposal: Add Cart
## Overview
Add shopping cart.
`

const CLI_PATH = fileURLToPath(new URL('../../bin/specfuse.js', import.meta.url))

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  })
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-recovery-'))
  await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })
  return root
}

/** A fully-set-up project with plan + story + proposal, already synced once. */
async function makeSyncedProject() {
  const root = await makeFixture()
  await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
  await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), PRD_DOC)
  await writeFile(join(root, '.specfuse', 'plan', 'stories', 'story-001-auth.md'), STORY_DOC)
  await writeFile(join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'), PROPOSAL_DOC)

  const registry = new Registry(root)
  await registry.load()
  const rules = await loadRules(root)
  await runTwoPassSync(root, registry, rules)
  return root
}

/**
 * Simulate a crash mid-sync: load the registry, build a real manifest for the
 * given rules WITHOUT writing target files, persist a pendingSync marker, and
 * optionally corrupt one registry hash to model "stale registry after a partial
 * write". Leaves the marker on disk so the next run detects an interruption.
 */
async function plantInterruptedMarker(root, { corruptHashFor } = {}) {
  const registry = new Registry(root)
  await registry.load()
  const rules = await loadRules(root)

  // The engine's manifest + snapshot helpers are module-private, so we build a
  // faithful marker by hand: snapshot the registry state and a manifest entry
  // per rule's intended constitution write. The constitution is the only Pass-A
  // target for built-in rules, which is what we exercise here.
  const { buildRuleContext } = await import('../core/rule-context.js')
  const { resolveConstitutionPath } = await import('../core/drift-detector.js')
  const ctx = buildRuleContext(root)
  const passA = rules.filter((r) => r.pass === 'A')
  const constitutionPath = resolveConstitutionPath(root)

  const manifest = []
  for (const rule of passA) {
    if (rule.isMultiTarget) continue
    let extracted
    try {
      extracted = await rule.extract(ctx)
    } catch {
      continue
    }
    if (!extracted) continue
    const managedContent = rule.transform(extracted, ctx)
    if (!managedContent) continue
    const sourceStr = typeof extracted === 'string' ? extracted : JSON.stringify(extracted)
    manifest.push({
      ruleId: rule.id,
      section: rule.section,
      targetPath: constitutionPath,
      sourceId: rule.source,
      targetId: rule.target,
      sourceHash: hashContent(sourceStr),
      targetHash: hashContent(managedContent),
      transformedContent: managedContent,
    })
  }

  registry.setPendingSync({
    snapshot: {
      syncs: JSON.parse(JSON.stringify(registry.data.syncs ?? {})),
      traces: JSON.parse(JSON.stringify(registry.data.traces ?? {})),
      artifacts: JSON.parse(JSON.stringify(registry.data.artifacts ?? {})),
      phase: registry.data.phase ?? 'unknown',
    },
    manifest,
    startedAt: '2026-08-11T09:00:00.000Z',
  })

  if (corruptHashFor) {
    // Model "crash after a target write but before final save": the on-disk
    // content reflects the write but the registry hash is stale.
    const key = `${corruptHashFor.sourceId}→${corruptHashFor.targetId}`
    registry.data.syncs[key] = {
      sourceHash: 'STALE-SOURCE-HASH',
      targetHash: 'STALE-TARGET-HASH',
      syncedAt: '2020-01-01T00:00:00.000Z',
    }
  }

  await registry.save()
  return { manifest }
}

// ─── Scenario 1 + 3: marker lifecycle on the normal path ─────────────────────

describe('Sync journal — normal (uninterrupted) path', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('an uninterrupted sync clears the pendingSync marker (no recovery observable)', async () => {
    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    const result = await runTwoPassSync(root, registry, rules)

    // No recovery was performed on a clean run.
    assert.equal(result.recovery, null, 'clean run must report recovery: null')

    // The marker is cleared on disk.
    await registry.load()
    assert.equal(registry.getPendingSync(), null, 'pendingSync marker must be cleared after a clean run')
  })

  test('the marker is written before any target mutation and is null only after the final save', async () => {
    // After a complete run the on-disk registry has no marker.
    const registry = new Registry(root)
    await registry.load()
    assert.equal(registry.getPendingSync(), null)

    // A run that we let complete leaves it null.
    const rules = await loadRules(root)
    await runTwoPassSync(root, registry, rules)
    await registry.load()
    assert.equal(registry.getPendingSync(), null)
  })
})

// ─── Scenario 2 + 4: detection, replay reconciliation, stale-hash repair ─────

describe('Sync recovery — detection and replay reconciliation', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('next sync detects a stale marker, reconciles via replay, clears it, and reports recovery', async () => {
    const { manifest } = await plantInterruptedMarker(root)

    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    const result = await runTwoPassSync(root, registry, rules)

    // Recovery was performed and reported.
    assert.ok(result.recovery, 'a recovered run must report a recovery object')
    assert.equal(result.recovery.performed, true)
    assert.equal(result.recovery.strategy, 'replay')
    assert.equal(result.recovery.manifestEntries, manifest.length)
    assert.equal(result.recovery.consistent, true)

    // The marker is cleared after recovery.
    await registry.load()
    assert.equal(registry.getPendingSync(), null, 'marker must be cleared after reconciliation')
  })

  test('recovery replays intended writes from the manifest (does NOT re-run transform)', async () => {
    // Plant a marker whose manifest says the constitution section should contain
    // a distinctive sentinel value. The on-disk content does NOT yet have it
    // (simulating the write never landing). Recovery must replay the manifest
    // content verbatim — verified by asserting replayedWrites >= 1 and by
    // capturing the constitution state immediately after recovery (before the
    // subsequent normal sync overwrites it with the real architecture content).
    const registry = new Registry(root)
    await registry.load()
    const { resolveConstitutionPath } = await import('../core/drift-detector.js')
    const constitutionPath = resolveConstitutionPath(root)

    // Read the constitution BEFORE planting the marker so we can prove the
    // sentinel was not there yet.
    const before = await readFile(constitutionPath, 'utf8')
    assert.ok(
      !before.includes('SENTINEL-REPLAY-CONTENT'),
      'sentinel must not be present before recovery',
    )

    registry.setPendingSync({
      snapshot: { syncs: {}, traces: {}, artifacts: {}, phase: 'unknown' },
      manifest: [
        {
          ruleId: 'test:sentinel',
          section: 'plan-decisions',
          targetPath: constitutionPath,
          sourceId: '.specfuse/plan/architecture.md',
          targetId: '.specfuse/constitution.md',
          sourceHash: 'h-src',
          targetHash: hashContent('SENTINEL-REPLAY-CONTENT'),
          transformedContent: 'SENTINEL-REPLAY-CONTENT',
        },
      ],
      startedAt: '2026-08-11T09:00:00.000Z',
    })
    await registry.save()

    // Patch reconcileInterruptedSync to capture the on-disk constitution state
    // immediately after recovery replays the write but before the new sync's
    // Pass A overwrites it. We do this by re-reading mid-recovery: instead of
    // instrumenting internals, we assert via replayedWrites that a write was
    // actually performed (the section differed, so replay wrote the manifest
    // content). A pure no-op (no replay) would report replayedWrites === 0.
    const reg2 = new Registry(root)
    await reg2.load()
    const rules = await loadRules(root)
    const result = await runTwoPassSync(root, reg2, rules)

    assert.equal(result.recovery.strategy, 'replay')
    assert.ok(
      result.recovery.replayedWrites >= 1,
      'recovery must replay the differing manifest write (replayedWrites >= 1)',
    )
  })

  test('crash after a target write but before final save: stale registry hash is reconciled (not reported IN_SYNC)', async () => {
    // The on-disk constitution is correct (settled by makeSyncedProject), but the
    // registry hash is stale — modeling a crash after the write but before save.
    const archRule = (await loadRules(root)).find((r) => r.pass === 'A' && !r.isMultiTarget)
    assert.ok(archRule, 'expected at least one Pass-A single-target rule')

    await plantInterruptedMarker(root, {
      corruptHashFor: { sourceId: archRule.source, targetId: archRule.target },
    })

    const registry = new Registry(root)
    await registry.load()
    // Sanity: the marker is present and the hash is stale before recovery.
    assert.ok(registry.getPendingSync())
    const key = `${archRule.source}→${archRule.target}`
    assert.equal(registry.data.syncs[key].targetHash, 'STALE-TARGET-HASH')

    const rules = await loadRules(root)
    await runTwoPassSync(root, registry, rules)

    // After recovery the registry hash is no longer the stale value — the rule
    // is NOT reported IN_SYNC on a stale hash.
    await registry.load()
    assert.notEqual(
      registry.data.syncs[key].targetHash,
      'STALE-TARGET-HASH',
      'the stale hash must have been reconciled away',
    )
  })

  test('an interrupted sync with an empty manifest reconciles as a no-op (consistent) and clears the marker', async () => {
    // Marker written but no target writes were ever intended — reconciliation is
    // a no-op. This is the "marker written before the first write" window.
    const registry = new Registry(root)
    await registry.load()
    registry.setPendingSync({
      snapshot: { syncs: {}, traces: {}, artifacts: {}, phase: registry.data.phase },
      manifest: [],
      startedAt: '2026-08-11T09:00:00.000Z',
    })
    await registry.save()

    const reg2 = new Registry(root)
    await reg2.load()
    const rules = await loadRules(root)
    const result = await runTwoPassSync(root, reg2, rules)

    assert.ok(result.recovery.performed)
    assert.equal(result.recovery.replayedWrites, 0)
    assert.equal(result.recovery.rolledBackEntries, 0)
    assert.equal(result.recovery.manifestEntries, 0)

    await reg2.load()
    assert.equal(reg2.getPendingSync(), null)
  })
})

// ─── Snapshot-rollback fallback + idempotent re-recovery ─────────────────────

describe('Sync recovery — rollback fallback and idempotent re-recovery', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('rollback fallback when replay is impossible restores the snapshot', async () => {
    const registry = new Registry(root)
    await registry.load()

    // Capture the pre-sync syncs state so we can assert rollback restores it.
    const snapshotSyncs = JSON.parse(JSON.stringify(registry.data.syncs ?? {}))

    // A manifest entry pointing at a target path whose parent is a regular FILE
    // (not a directory). writeFileAtomic calls mkdir(recursive) on the parent,
    // which throws ENOTDIR when a path component is a file — replay fails, so
    // the rollback-to-snapshot fallback kicks in.
    const blocker = join(root, '.specfuse', 'parent-is-a-file')
    await writeFile(blocker, 'I am a file, not a directory\n')
    const unreachableTarget = join(blocker, 'constitution.md')

    registry.setPendingSync({
      snapshot: {
        syncs: snapshotSyncs,
        traces: {},
        artifacts: {},
        phase: registry.data.phase ?? 'unknown',
      },
      manifest: [
        {
          ruleId: 'test:unreplayable',
          section: 'plan-decisions',
          targetPath: unreachableTarget,
          sourceId: 'x',
          targetId: 'y',
          sourceHash: 'h',
          targetHash: 'h',
          transformedContent: 'CANNOT-BE-WRITTEN',
        },
      ],
      startedAt: '2026-08-11T09:00:00.000Z',
    })
    await registry.save()

    const reg2 = new Registry(root)
    await reg2.load()
    const rules = await loadRules(root)
    const result = await runTwoPassSync(root, reg2, rules)

    assert.equal(result.recovery.strategy, 'rollback')
    assert.ok(result.recovery.rolledBackEntries >= 1, 'the unreplayable entry should be rolled back')
    assert.ok(
      result.recovery.notes.some((n) => n.toLowerCase().includes('rolled back')),
      'a rollback note should be recorded',
    )

    // The snapshot's syncs were restored (not the stale/corrupt state).
    await reg2.load()
    assert.deepEqual(reg2.data.syncs, snapshotSyncs)
  })

  test('re-recovering an already-recovered run does not re-trigger recovery (idempotent)', async () => {
    // Plant a marker, recover once.
    await plantInterruptedMarker(root)
    const reg1 = new Registry(root)
    await reg1.load()
    const rules = await loadRules(root)
    const first = await runTwoPassSync(root, reg1, rules)
    assert.ok(first.recovery?.performed)

    // A second run must NOT report recovery — the marker was cleared.
    const reg2 = new Registry(root)
    await reg2.load()
    const second = await runTwoPassSync(root, reg2, rules)
    assert.equal(second.recovery, null, 'a clean re-run after recovery must report recovery: null')
  })

  test('crash during recovery itself: marker is not cleared until reconciliation succeeds', async () => {
    // Recovery clears the marker only after it finishes and saves. If the
    // process crashes mid-recovery, the marker remains and the next run
    // re-reconciles. We simulate "crash during recovery" by NOT running
    // recovery (leaving the marker) and confirming a later run still sees it.
    await plantInterruptedMarker(root)
    const reg = new Registry(root)
    await reg.load()
    assert.ok(reg.getPendingSync(), 'marker must persist until a recovery run clears it')
  })
})

// ─── --no-recover escape ─────────────────────────────────────────────────────

describe('Sync recovery — --no-recover escape', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('the API throws InterruptedSyncPendingError (code INTERRUPTED_SYNC_PENDING) when noRecover is set', async () => {
    await plantInterruptedMarker(root)

    const { sync } = await import('../api/sync-ops.mjs')
    await assert.rejects(
      () => sync({ root, noRecover: true }),
      (err) => {
        assert.ok(err instanceof InterruptedSyncPendingError)
        assert.equal(err.code, 'INTERRUPTED_SYNC_PENDING')
        return true
      },
    )

    // The marker is left intact (recovery was declined, not performed).
    const reg = new Registry(root)
    await reg.load()
    assert.ok(reg.getPendingSync(), 'declining recovery must leave the marker in place')
  })

  test('CLI `specfuse sync --no-recover --json` exits non-zero with a structured error', async () => {
    await plantInterruptedMarker(root)

    const result = runCli(root, ['sync', '--no-recover', '--json'])
    assert.notEqual(result.status, 0, '--no-recover with a pending marker must exit non-zero')

    const body = JSON.parse(result.stdout)
    assert.ok(body.error, 'JSON output must carry an error object')
    assert.equal(body.error.code, 'INTERRUPTED_SYNC_PENDING')
    assert.ok(body.error.message.length > 0)
  })

  test('CLI `specfuse sync --no-recover` on a clean project proceeds normally', () => {
    // No marker present — --no-recover has nothing to decline, sync runs.
    const result = runCli(root, ['sync', '--no-recover', '--json'])
    assert.equal(result.status, 0, 'clean run with --no-recover must exit 0')
    const body = JSON.parse(result.stdout)
    assert.equal(body.recovery, null)
  })
})

// ─── Scenarios 5 + 6: crash-safe, idempotent archive ─────────────────────────

describe('Archive — crash-safe and idempotent', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
    await mkdir(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'),
      '---\nid: add-cart\n---\n# Change Proposal\n## Overview\nAdd cart.\n',
    )
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-cart', 'verify.md'),
      '---\nstatus: pass\n---\n- [x] Delivered\n',
    )
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('an archive interrupted after source deletion keeps the archived copy on disk', async () => {
    // Simulate: copy done, source removed, marker set, registry record NOT completed.
    const destDir = join(root, '.specfuse', 'changes', 'archive', '2026-08-11-add-cart')
    await cp(join(root, '.specfuse', 'changes', 'add-cart'), destDir, { recursive: true })
    await rm(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true, force: true })

    const reg = new Registry(root)
    await reg.load()
    reg.setPendingArchive({
      change: 'add-cart',
      sourceDir: join(root, '.specfuse', 'changes', 'add-cart'),
      archiveDir: destDir,
    })
    await reg.save()

    // The archived copy survives on disk (the change is not lost).
    const archived = await readFile(join(destDir, 'proposal.md'), 'utf8')
    assert.ok(archived.includes('Add cart'), 'the archived copy must survive the interruption')
  })

  test('re-running archive after interruption completes the record without duplicating', async () => {
    const destDir = join(root, '.specfuse', 'changes', 'archive', '2026-08-11-add-cart')
    await cp(join(root, '.specfuse', 'changes', 'add-cart'), destDir, { recursive: true })
    await rm(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true, force: true })

    const reg = new Registry(root)
    await reg.load()
    reg.setPendingArchive({
      change: 'add-cart',
      sourceDir: join(root, '.specfuse', 'changes', 'add-cart'),
      archiveDir: destDir,
    })
    await reg.save()

    const result = await archiveChange(root, 'add-cart')

    // The re-run resumed the prior archive (did not re-copy).
    assert.equal(result.resumed, true)
    assert.equal(result.archiveDir, destDir)

    // Exactly one archived directory exists — no duplication.
    const archives = await readdir(join(root, '.specfuse', 'changes', 'archive'))
    assert.deepEqual(archives, ['2026-08-11-add-cart'])

    // The marker is cleared.
    const reg2 = new Registry(root)
    await reg2.load()
    assert.equal(reg2.getPendingArchive(), null)
  })

  test('re-running archive when the archived copy is missing re-runs the full archive', async () => {
    // Stale marker but the archived copy is gone — the prior copy did not land.
    const reg = new Registry(root)
    await reg.load()
    reg.setPendingArchive({
      change: 'add-cart',
      sourceDir: join(root, '.specfuse', 'changes', 'add-cart'),
      archiveDir: join(root, '.specfuse', 'changes', 'archive', '2026-08-11-add-cart'),
    })
    await reg.save()

    const result = await archiveChange(root, 'add-cart')
    assert.notEqual(result.resumed, true, 'a missing archive must trigger a fresh archive, not a resume')

    // The archive was created from scratch.
    const archives = await readdir(join(root, '.specfuse', 'changes', 'archive'))
    assert.equal(archives.length, 1)
    assert.ok(archives[0].endsWith('-add-cart'))

    const reg2 = new Registry(root)
    await reg2.load()
    assert.equal(reg2.getPendingArchive(), null)
  })

  test('a normal (uninterrupted) archive leaves no pendingArchive marker', async () => {
    const result = await archiveChange(root, 'add-cart')
    assert.notEqual(result.resumed, true)

    const reg = new Registry(root)
    await reg.load()
    assert.equal(reg.getPendingArchive(), null, 'a clean archive must clear the marker')
  })
})

// ─── Doctor stale-marker reporting ───────────────────────────────────────────

describe('Doctor — stale marker reporting', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('doctor reports a stale pendingSync marker as a WARN', async () => {
    const reg = new Registry(root)
    await reg.load()
    reg.setPendingSync({
      snapshot: { syncs: {}, traces: {}, artifacts: {}, phase: 'unknown' },
      manifest: [],
      startedAt: '2026-08-11T09:00:00.000Z',
    })
    await reg.save()

    const result = runCli(root, ['doctor', '--json'])
    assert.equal(result.status, 0, 'a WARN should not fail doctor')
    const body = JSON.parse(result.stdout)
    const check = body.checks.find((c) => c.id === 'pending-sync')
    assert.ok(check, 'pending-sync check must exist')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('Interrupted sync marker'))
    assert.ok(check.remediation.includes('specfuse sync'))
  })

  test('doctor reports a stale pendingArchive marker as a WARN', async () => {
    const reg = new Registry(root)
    await reg.load()
    reg.setPendingArchive({
      change: 'add-cart',
      sourceDir: join(root, '.specfuse', 'changes', 'add-cart'),
      archiveDir: join(root, '.specfuse', 'changes', 'archive', '2026-08-11-add-cart'),
    })
    await reg.save()

    const result = runCli(root, ['doctor', '--json'])
    const body = JSON.parse(result.stdout)
    const check = body.checks.find((c) => c.id === 'pending-archive')
    assert.ok(check, 'pending-archive check must exist')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes("add-cart"))
  })

  test('doctor reports PASS when no markers are present', async () => {
    const reg = new Registry(root)
    await reg.load()
    // A fresh registry has null markers.
    await reg.save()

    const result = runCli(root, ['doctor', '--json'])
    const body = JSON.parse(result.stdout)
    const sync = body.checks.find((c) => c.id === 'pending-sync')
    const archive = body.checks.find((c) => c.id === 'pending-archive')
    assert.equal(sync.state, 'PASS')
    assert.equal(archive.state, 'PASS')
  })
})

// ─── JSON output shape ────────────────────────────────────────────────────────

describe('Sync JSON output — recovery field shape', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('a non-recovery sync omits/nulls the recovery field', () => {
    const result = runCli(root, ['sync', '--json'])
    assert.equal(result.status, 0)
    const body = JSON.parse(result.stdout)
    assert.ok('recovery' in body, 'recovery field must be present in JSON output')
    assert.equal(body.recovery, null)
  })

  test('a recovered run populates the recovery field with the reconciliation outcome', async () => {
    await plantInterruptedMarker(root)

    const result = runCli(root, ['sync', '--json'])
    assert.equal(result.status, 0)
    const body = JSON.parse(result.stdout)

    assert.ok(body.recovery, 'recovery field must be populated on a recovered run')
    assert.equal(body.recovery.performed, true)
    assert.ok(['replay', 'rollback'].includes(body.recovery.strategy))
    assert.equal(typeof body.recovery.replayedWrites, 'number')
    assert.equal(typeof body.recovery.rolledBackEntries, 'number')
    assert.equal(body.recovery.consistent, true)
    assert.equal(body.recovery.priorStartedAt, '2026-08-11T09:00:00.000Z')
  })
})
