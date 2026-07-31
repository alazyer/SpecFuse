/**
 * Tests for the clean and reset commands.
 *
 * These tests exercise the command handlers via JSON mode to avoid
 * interactive prompts and verify structured output.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { cleanCommand, resetCommand } from '../commands/clean.js'
import { Registry } from '../core/registry.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-clean-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })

  // Initialize a valid registry
  const registry = new Registry(root)
  await registry.load()
  await registry.save()

  return root
}

// Run cleanCommand in JSON mode and capture output
async function runClean(root, options = {}) {
  const captured = []
  const originalLog = console.log
  const originalExit = process.exit

  console.log = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  let exitCode = 0
  process.exit = (code) => {
    exitCode = code
    throw new Error(`EXIT:${code}`)
  }

  try {
    await cleanCommand(root, { ...options, json: true })
  } catch (e) {
    if (e.message?.startsWith('EXIT:')) {
      exitCode = parseInt(e.message.replace('EXIT:', ''), 10)
    } else {
      throw e
    }
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  // Find the JSON line in captured output
  const jsonLine = captured.find((line) => {
    try {
      const parsed = JSON.parse(line)
      return parsed && typeof parsed === 'object'
    } catch {
      return false
    }
  })

  if (!jsonLine) return { exitCode, result: null }
  return { exitCode, result: JSON.parse(jsonLine) }
}

// Run resetCommand in JSON mode and capture output
async function runReset(root, options = {}) {
  const captured = []
  const originalLog = console.log
  const originalExit = process.exit

  console.log = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  let exitCode = 0
  process.exit = (code) => {
    exitCode = code
    throw new Error(`EXIT:${code}`)
  }

  try {
    await resetCommand(root, { ...options, json: true })
  } catch (e) {
    if (e.message?.startsWith('EXIT:')) {
      exitCode = parseInt(e.message.replace('EXIT:', ''), 10)
    } else {
      throw e
    }
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  const jsonLine = captured.find((line) => {
    try {
      const parsed = JSON.parse(line)
      return parsed && typeof parsed === 'object'
    } catch {
      return false
    }
  })

  if (!jsonLine) return { exitCode, result: null }
  return { exitCode, result: JSON.parse(jsonLine) }
}

// ─── cleanCommand ─────────────────────────────────────────────────────────

describe('cleanCommand', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('dry-run reports orphans without removing them', async () => {
    // Create an orphan file
    await writeFile(join(root, '.specfuse', 'orphan.txt'), 'orphan')

    const { result } = await runClean(root, { dryRun: true, force: true })
    assert.ok(result)
    assert.equal(result.dryRun, true)
    assert.ok(result.files.removed.some((f) => f.includes('orphan.txt')))

    // File should still exist on disk (dry-run doesn't remove)
    const { pathExists } = await import('../utils/fs.js')
    assert.ok(pathExists(join(root, '.specfuse', 'orphan.txt')))
  })

  test('clean removes orphaned files when not dry-run', async () => {
    await writeFile(join(root, '.specfuse', 'orphan.txt'), 'orphan')

    const { result } = await runClean(root, { dryRun: false, force: true })
    assert.ok(result)
    assert.equal(result.dryRun, false)
    assert.ok(result.files.removed.some((f) => f.includes('orphan.txt')))

    // File should be gone
    const { pathExists } = await import('../utils/fs.js')
    assert.ok(!pathExists(join(root, '.specfuse', 'orphan.txt')))
  })

  test('clean --registry only cleans registry entries', async () => {
    // Set up stale sync entry
    const registry = new Registry(root)
    await registry.load()
    registry.data.syncs = {
      'old-source→old-target': {
        sourceHash: 'abc',
        targetHash: 'def',
        syncedAt: new Date().toISOString(),
      },
    }
    await registry.save()

    // Also create an orphan file — should NOT be cleaned with --registry only
    await writeFile(join(root, '.specfuse', 'orphan.txt'), 'orphan')

    const { result } = await runClean(root, { registry: true, dryRun: false, force: true })
    assert.ok(result)
    assert.ok(result.syncs.count > 0, 'Should have removed stale sync entries')
    assert.equal(result.files.removed.length, 0, 'Should not remove files with --registry only')
  })

  test('clean --orphans only cleans orphaned files and empty dirs', async () => {
    // Set up stale sync entry — should NOT be cleaned with --orphans only
    const registry = new Registry(root)
    await registry.load()
    registry.data.syncs = {
      'old-source→old-target': {
        sourceHash: 'abc',
        targetHash: 'def',
        syncedAt: new Date().toISOString(),
      },
    }
    await registry.save()

    // Create an orphan file
    await writeFile(join(root, '.specfuse', 'orphan.txt'), 'orphan')

    const { result } = await runClean(root, { orphans: true, dryRun: false, force: true })
    assert.ok(result)
    assert.ok(result.files.removed.some((f) => f.includes('orphan.txt')), 'Should remove orphaned files')
    assert.equal(result.syncs.count, 0, 'Should not clean registry with --orphans only')
  })

  test('clean reports nothing when project is tidy', async () => {
    const { result } = await runClean(root, { dryRun: false, force: true })
    assert.ok(result)
    assert.equal(result.files.removed.length, 0)
    assert.equal(result.syncs.count, 0)
    assert.equal(result.traces.count, 0)
    assert.equal(result.directories.removed.length, 0)
  })

  test('clean removes stale sync and trace entries from registry', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.data.syncs = {
      'stale-source→stale-target': {
        sourceHash: 'abc',
        targetHash: 'def',
        syncedAt: new Date().toISOString(),
      },
    }
    registry.data.traces = {
      'STORY-999': { active: [], implemented: false },
    }
    await registry.save()

    const { result } = await runClean(root, { dryRun: false, force: true })
    assert.ok(result)
    assert.ok(result.syncs.removed.includes('stale-source→stale-target'))
    assert.ok(result.traces.removed.includes('STORY-999'))

    // Verify registry is actually cleaned
    await registry.load()
    assert.ok(!registry.data.syncs?.['stale-source→stale-target'])
    assert.ok(!registry.data.traces?.['STORY-999'])
  })

  test('clean removes empty directories', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'empty-change'), { recursive: true })

    const { result } = await runClean(root, { dryRun: false, force: true })
    assert.ok(result)
    assert.ok(result.directories.removed.some((d) => d.includes('empty-change')))
  })

  test('clean logs to history', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.data.syncs = {
      'stale→target': { sourceHash: 'a', targetHash: 'b', syncedAt: new Date().toISOString() },
    }
    await registry.save()

    await runClean(root, { dryRun: false, force: true })

    // Reload registry and check history
    await registry.load()
    const cleanEvents = registry.getHistory({ type: 'clean' })
    assert.ok(cleanEvents.length > 0, 'Should have recorded a clean event in history')
  })
})

// ─── resetCommand ─────────────────────────────────────────────────────────

describe('resetCommand', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('reset --dry-run defaults to true and shows what would be reset', async () => {
    // Create some artifacts
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution')
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD')

    const { result } = await runReset(root, { dryRun: true })
    assert.ok(result)
    assert.equal(result.dryRun, true)
    assert.ok(result.removed.length > 0, 'Should list items to be removed')
  })

  test('reset (soft) preserves plan/ and archive/', async () => {
    // Create artifacts
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution')
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD')
    await mkdir(join(root, '.specfuse', 'changes', 'active-change'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'active-change', 'proposal.md'), '# Proposal')
    await mkdir(join(root, '.specfuse', 'changes', 'archive', '2026-01-01-done'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'archive', '2026-01-01-done', 'proposal.md'), '# Done')

    const { result } = await runReset(root, { dryRun: false, force: true })
    assert.ok(result)
    assert.equal(result.dryRun, false)
    assert.ok(result.preserved.includes('plan/'), 'Should preserve plan/')
    assert.ok(result.preserved.some((p) => p.includes('archive')), 'Should preserve archive/')

    // Verify plan/ and archive/ still exist
    const { pathExists } = await import('../utils/fs.js')
    assert.ok(pathExists(join(root, '.specfuse', 'plan', 'prd.md')))
    assert.ok(pathExists(join(root, '.specfuse', 'changes', 'archive', '2026-01-01-done', 'proposal.md')))
    // constitution should be removed
    assert.ok(!pathExists(join(root, '.specfuse', 'constitution.md')))
    // active changes should be removed
    assert.ok(!pathExists(join(root, '.specfuse', 'changes', 'active-change')))
  })

  test('reset --hard removes everything except .specfuse/ directory itself', async () => {
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution')
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD')
    await mkdir(join(root, '.specfuse', 'changes', 'archive', '2026-01-01-done'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'archive', '2026-01-01-done', 'proposal.md'), '# Done')

    const { result } = await runReset(root, { dryRun: false, force: true, hard: true })
    assert.ok(result)
    assert.equal(result.hard, true)
    assert.deepEqual(result.preserved, [])

    // .specfuse/ directory should still exist (but empty)
    const { pathExists, readFileSafe } = await import('../utils/fs.js')
    assert.ok(pathExists(join(root, '.specfuse')))
    // plan/ should be gone
    assert.ok(!pathExists(join(root, '.specfuse', 'plan', 'prd.md')))
    // archive/ should be gone
    assert.ok(!pathExists(join(root, '.specfuse', 'changes', 'archive', '2026-01-01-done', 'proposal.md')))
    // constitution should be gone
    assert.ok(!pathExists(join(root, '.specfuse', 'constitution.md')))
    // registry should be gone
    assert.ok(!pathExists(join(root, '.specfuse', 'registry.json')))
  })

  test('reset clears registry sync and trace state (soft)', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.data.syncs = { 'a→b': { sourceHash: '1', targetHash: '2', syncedAt: new Date().toISOString() } }
    registry.data.traces = { 'STORY-1': { active: ['change-x'], implemented: false } }
    registry.data.phase = 'building'
    await registry.save()

    await runReset(root, { dryRun: false, force: true })

    await registry.load()
    assert.deepEqual(registry.data.syncs, {})
    assert.deepEqual(registry.data.traces, {})
  })

  test('reset logs to history', async () => {
    await runReset(root, { dryRun: false, force: true })

    const registry = new Registry(root)
    await registry.load()
    // With hard reset, registry is gone, but with soft reset history should be recorded
    const resetEvents = registry.getHistory?.({ type: 'reset' }) ?? []
    assert.ok(resetEvents.length > 0, 'Should have recorded a reset event in history')
  })

  test('reset warns when no .specfuse directory exists', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'sf-reset-empty-'))
    try {
      const { result } = await runReset(emptyRoot, { dryRun: false, force: true })
      assert.ok(result)
      assert.equal(result.reset, false)
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }
  })
})
