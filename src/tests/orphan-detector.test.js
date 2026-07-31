/**
 * Tests for the orphan detection module.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, rmdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  findOrphanedFiles,
  findStaleRegistryEntries,
  findEmptyDirectories,
  removeOrphanedFiles,
  removeEmptyDirectories,
} from '../core/orphan-detector.js'
import { Registry } from '../core/registry.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-orphan-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })
  return root
}

// ─── findOrphanedFiles ────────────────────────────────────────────────────

describe('findOrphanedFiles', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns empty when no .specfuse directory', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'sf-orphan-empty-'))
    try {
      const result = await findOrphanedFiles(emptyRoot)
      assert.deepEqual(result.files, [])
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }
  })

  test('returns empty when all files are tracked', async () => {
    // Create registry.json and constitution.md — always tracked
    await writeFile(join(root, '.specfuse', 'registry.json'), '{}')
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution')
    const result = await findOrphanedFiles(root)
    // These are always tracked, should not be orphans
    assert.ok(!result.files.includes('.specfuse/registry.json'))
    assert.ok(!result.files.includes('.specfuse/constitution.md'))
  })

  test('detects orphaned files not tracked by any rule', async () => {
    // Create a file that's definitely not tracked
    await writeFile(join(root, '.specfuse', 'orphan-file.txt'), 'orphan')
    await writeFile(join(root, '.specfuse', 'registry.json'), '{}')

    const result = await findOrphanedFiles(root)
    assert.ok(result.files.some((f) => f.includes('orphan-file.txt')))
  })

  test('detects orphaned files in subdirectories', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'dead-change'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'dead-change', 'orphan.md'), '# Orphan')
    await writeFile(join(root, '.specfuse', 'registry.json'), '{}')

    const result = await findOrphanedFiles(root)
    assert.ok(result.files.some((f) => f.includes('orphan.md')))
  })
})

// ─── findStaleRegistryEntries ─────────────────────────────────────────────

describe('findStaleRegistryEntries', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns empty for fresh registry', async () => {
    const registry = new Registry(root)
    await registry.load()
    await registry.save()

    const result = await findStaleRegistryEntries(root)
    assert.deepEqual(result.syncs, [])
    assert.deepEqual(result.traces, [])
  })

  test('detects stale sync entries when no rules match', async () => {
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

    const result = await findStaleRegistryEntries(root)
    assert.ok(result.syncs.includes('old-source→old-target'))
  })

  test('detects stale trace entries with no active changes', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.data.traces = {
      'STORY-999': { active: [], implemented: false },
    }
    await registry.save()

    const result = await findStaleRegistryEntries(root)
    assert.ok(result.traces.includes('STORY-999'))
  })

  test('preserves implemented trace entries', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.data.traces = {
      'STORY-100': { active: [], implemented: true, implementedBy: 'archive-1' },
    }
    await registry.save()

    const result = await findStaleRegistryEntries(root)
    assert.ok(!result.traces.includes('STORY-100'))
  })

  test('detects stale trace entries referencing non-existent change dirs', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.data.traces = {
      'STORY-500': { active: ['nonexistent-change'], implemented: false },
    }
    await registry.save()

    const result = await findStaleRegistryEntries(root)
    assert.ok(result.traces.includes('STORY-500'))
  })
})

// ─── findEmptyDirectories ─────────────────────────────────────────────────

describe('findEmptyDirectories', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns empty when no .specfuse directory', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'sf-empty-test-'))
    try {
      const result = await findEmptyDirectories(emptyRoot)
      assert.deepEqual(result.directories, [])
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }
  })

  test('detects empty directories', async () => {
    // Create an empty directory in .specfuse/changes/
    await mkdir(join(root, '.specfuse', 'changes', 'empty-change'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'registry.json'), '{}')

    const result = await findEmptyDirectories(root)
    assert.ok(result.directories.some((d) => d.includes('empty-change')))
  })

  test('does not report directories with files as empty', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'active-change'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'active-change', 'proposal.md'), '# Active')
    await writeFile(join(root, '.specfuse', 'registry.json'), '{}')

    const result = await findEmptyDirectories(root)
    assert.ok(!result.directories.some((d) => d.includes('active-change')))
  })

  test('skips archive directory from empty check', async () => {
    // archive/ should not be reported even if empty
    const result = await findEmptyDirectories(root)
    assert.ok(!result.directories.some((d) => d.includes('archive')))
  })
})

// ─── removeOrphanedFiles ──────────────────────────────────────────────────

describe('removeOrphanedFiles', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('removes specified files', async () => {
    const filePath = join(root, '.specfuse', 'orphan.txt')
    await writeFile(filePath, 'orphan content')

    const result = await removeOrphanedFiles(root, ['.specfuse/orphan.txt'])
    assert.deepEqual(result.removed, ['.specfuse/orphan.txt'])
    assert.deepEqual(result.skipped, [])
  })

  test('skips files that no longer exist (TOCTOU)', async () => {
    const result = await removeOrphanedFiles(root, ['.specfuse/vanished.txt'])
    assert.deepEqual(result.removed, [])
    assert.deepEqual(result.skipped, ['.specfuse/vanished.txt'])
  })

  test('skips symlinks', async () => {
    // Symlinks should not be removed
    const target = join(root, '.specfuse', 'target.txt')
    await writeFile(target, 'target')
    const linkPath = join(root, '.specfuse', 'link.txt')
    const { symlink } = await import('fs/promises')
    await symlink(target, linkPath)

    const result = await removeOrphanedFiles(root, ['.specfuse/link.txt'])
    assert.deepEqual(result.removed, [])
    assert.ok(result.skipped.includes('.specfuse/link.txt'))
  })
})

// ─── removeEmptyDirectories ───────────────────────────────────────────────

describe('removeEmptyDirectories', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('removes empty directories', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'empty-change'), { recursive: true })
    const result = await removeEmptyDirectories(root, [
      '.specfuse/changes/empty-change',
    ])
    assert.deepEqual(result.removed, ['.specfuse/changes/empty-change'])
    assert.deepEqual(result.skipped, [])
  })

  test('skips directories that are no longer empty', async () => {
    const dir = join(root, '.specfuse', 'changes', 'not-empty')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'file.md'), 'content')

    const result = await removeEmptyDirectories(root, ['.specfuse/changes/not-empty'])
    assert.deepEqual(result.removed, [])
    assert.deepEqual(result.skipped, ['.specfuse/changes/not-empty'])
  })

  test('removes nested empty directories deepest-first', async () => {
    const parent = join(root, '.specfuse', 'changes', 'parent-dir')
    const child = join(parent, 'child-dir')
    await mkdir(child, { recursive: true })

    const result = await removeEmptyDirectories(root, [
      '.specfuse/changes/parent-dir/child-dir',
      '.specfuse/changes/parent-dir',
    ])
    assert.equal(result.removed.length, 2)
    // Child should be removed first (deeper path)
    assert.ok(result.removed[0].includes('child-dir'))
    assert.ok(result.removed[1].includes('parent-dir'))
  })
})
