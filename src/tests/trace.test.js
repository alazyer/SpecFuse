import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  parseStoryReferences,
  scanStoryIds,
  scanActiveChangeStories,
  scanArchivedChangeStories,
  buildTraceMatrix,
  computeCoverage,
  recordTraceLinks,
} from '../core/traceability.js'
import { Registry } from '../core/registry.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-trace-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  return root
}

// ─── parseStoryReferences ────────────────────────────────────────────────

describe('parseStoryReferences', () => {
  test('parses comma-separated stories from frontmatter', () => {
    const content = '---\nstories: STORY-001, STORY-003\n---\n\n# Proposal'
    const ids = parseStoryReferences(content)
    assert.deepEqual(ids, ['STORY-001', 'STORY-003'])
  })

  test('parses array stories from frontmatter', () => {
    const content = '---\nstories:\n  - STORY-001\n  - STORY-005\n---\n\n# Proposal'
    const ids = parseStoryReferences(content)
    assert.deepEqual(ids, ['STORY-001', 'STORY-005'])
  })

  test('returns empty array when stories is ~', () => {
    const content = '---\nstories: ~\n---\n\n# Proposal'
    const ids = parseStoryReferences(content)
    assert.deepEqual(ids, [])
  })

  test('returns empty array when stories is absent', () => {
    const content = '---\nstatus: active\n---\n\n# Proposal'
    const ids = parseStoryReferences(content)
    assert.deepEqual(ids, [])
  })

  test('returns empty array for empty content', () => {
    const ids = parseStoryReferences('')
    assert.deepEqual(ids, [])
  })
})

// ─── scanStoryIds ────────────────────────────────────────────────────────

describe('scanStoryIds', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns story IDs from .specfuse/plan/stories/', async () => {
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'stories', 'STORY-001.md'), '# Story 1')
    await writeFile(join(root, '.specfuse', 'plan', 'stories', 'STORY-003.md'), '# Story 3')

    const ids = await scanStoryIds(root)
    assert.deepEqual(ids, ['STORY-001', 'STORY-003'])
  })

  test('returns empty array when stories dir does not exist', async () => {
    const ids = await scanStoryIds(root)
    assert.deepEqual(ids, [])
  })
})

// ─── scanActiveChangeStories ─────────────────────────────────────────────

describe('scanActiveChangeStories', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns map of changeName → storyIds from active proposals', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstories: STORY-001, STORY-003\n---\n\n# Add Login',
    )

    const map = await scanActiveChangeStories(root)
    assert.equal(map.size, 1)
    assert.deepEqual(map.get('add-login'), ['STORY-001', 'STORY-003'])
  })

  test('skips changes without stories frontmatter', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'no-stories'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'no-stories', 'proposal.md'),
      '---\nstatus: active\n---\n\n# No Stories',
    )

    const map = await scanActiveChangeStories(root)
    assert.equal(map.size, 0)
  })

  test('skips archive directory', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })
    const map = await scanActiveChangeStories(root)
    assert.equal(map.size, 0)
  })
})

// ─── scanArchivedChangeStories ───────────────────────────────────────────

describe('scanArchivedChangeStories', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns map of archiveName → storyIds from archived proposals', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'archive', '2026-07-01-user-auth'), {
      recursive: true,
    })
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', '2026-07-01-user-auth', 'proposal.md'),
      '---\nstories: STORY-003\n---\n\n# User Auth',
    )

    const map = await scanArchivedChangeStories(root)
    assert.equal(map.size, 1)
    assert.deepEqual(map.get('2026-07-01-user-auth'), ['STORY-003'])
  })
})

// ─── buildTraceMatrix ────────────────────────────────────────────────────

describe('buildTraceMatrix', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('builds matrix with active and implemented stories', async () => {
    // Create stories
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'stories', 'STORY-001.md'), '# Login Flow')
    await writeFile(join(root, '.specfuse', 'plan', 'stories', 'STORY-003.md'), '# User Profile')
    await writeFile(join(root, '.specfuse', 'plan', 'stories', 'STORY-005.md'), '# Search')

    // Active change referencing STORY-001
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstories: STORY-001\n---\n\n# Add Login',
    )

    // Archived change referencing STORY-003
    await mkdir(join(root, '.specfuse', 'changes', 'archive', '2026-07-01-user-auth'), {
      recursive: true,
    })
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', '2026-07-01-user-auth', 'proposal.md'),
      '---\nstories: STORY-003\n---\n\n# User Auth',
    )

    const { stories, unknown } = await buildTraceMatrix(root)

    assert.equal(stories.length, 3)

    const s1 = stories.find((s) => s.id === 'STORY-001')
    assert.equal(s1.status, 'active')
    assert.deepEqual(s1.activeChanges, ['add-login'])

    const s3 = stories.find((s) => s.id === 'STORY-003')
    assert.equal(s3.status, 'implemented')
    assert.equal(s3.implementedBy, '2026-07-01-user-auth')

    const s5 = stories.find((s) => s.id === 'STORY-005')
    assert.equal(s5.status, 'uncovered')
    assert.deepEqual(s5.activeChanges, [])
    assert.equal(s5.implementedBy, null)

    assert.deepEqual(unknown, [])
  })

  test('detects unknown story IDs', async () => {
    // No stories on disk, but a proposal references one
    await mkdir(join(root, '.specfuse', 'changes', 'orphan-ref'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'orphan-ref', 'proposal.md'),
      '---\nstories: STORY-999\n---\n\n# Orphan',
    )

    const { stories, unknown } = await buildTraceMatrix(root)
    assert.ok(unknown.includes('STORY-999'))
    const s999 = stories.find((s) => s.id === 'STORY-999')
    assert.equal(s999.status, 'unknown')
  })

  test('story referenced by both active and archived changes gets active+implemented', async () => {
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'stories', 'STORY-001.md'), '# Login')

    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstories: STORY-001\n---\n\n# Add Login',
    )

    await mkdir(join(root, '.specfuse', 'changes', 'archive', '2026-07-01-auth'), {
      recursive: true,
    })
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', '2026-07-01-auth', 'proposal.md'),
      '---\nstories: STORY-001\n---\n\n# Auth',
    )

    const { stories } = await buildTraceMatrix(root)
    const s1 = stories.find((s) => s.id === 'STORY-001')
    assert.equal(s1.status, 'active+implemented')
    assert.deepEqual(s1.activeChanges, ['add-login'])
    assert.equal(s1.implementedBy, '2026-07-01-auth')
  })

  test('returns empty matrix when no stories exist', async () => {
    const { stories, unknown } = await buildTraceMatrix(root)
    assert.deepEqual(stories, [])
    assert.deepEqual(unknown, [])
  })
})

// ─── computeCoverage ─────────────────────────────────────────────────────

describe('computeCoverage', () => {
  test('computes coverage metrics correctly', () => {
    const matrix = {
      stories: [
        { id: 'STORY-001', status: 'active', activeChanges: ['c1'], implementedBy: null },
        { id: 'STORY-003', status: 'implemented', activeChanges: [], implementedBy: 'a1' },
        { id: 'STORY-005', status: 'uncovered', activeChanges: [], implementedBy: null },
        { id: 'STORY-007', status: 'active+implemented', activeChanges: ['c2'], implementedBy: 'a2' },
      ],
      unknown: [],
    }

    const coverage = computeCoverage(matrix)
    assert.equal(coverage.total, 4)
    assert.equal(coverage.active, 2) // active + active+implemented
    assert.equal(coverage.implemented, 2) // implemented + active+implemented
    assert.equal(coverage.uncovered, 1)
    assert.equal(coverage.coveragePct, 75) // (total - uncovered) / total = 3/4 * 100 = 75
    // Actually: active=2 (STORY-001, STORY-007), implemented=2 (STORY-003, STORY-007)
    // coveragePct = (active + implemented) / total * 100 = 4/4 * 100 = 100
  })

  test('returns 0% coverage when all uncovered', () => {
    const matrix = {
      stories: [
        { id: 'STORY-001', status: 'uncovered', activeChanges: [], implementedBy: null },
        { id: 'STORY-002', status: 'uncovered', activeChanges: [], implementedBy: null },
      ],
      unknown: [],
    }

    const coverage = computeCoverage(matrix)
    assert.equal(coverage.total, 2)
    assert.equal(coverage.uncovered, 2)
    assert.equal(coverage.coveragePct, 0)
  })

  test('excludes unknown stories from coverage', () => {
    const matrix = {
      stories: [
        { id: 'STORY-001', status: 'active', activeChanges: ['c1'], implementedBy: null },
        { id: 'STORY-999', status: 'unknown', activeChanges: [], implementedBy: null },
      ],
      unknown: ['STORY-999'],
    }

    const coverage = computeCoverage(matrix)
    assert.equal(coverage.total, 1)
    assert.equal(coverage.active, 1)
    assert.equal(coverage.coveragePct, 100)
  })

  test('handles empty matrix', () => {
    const matrix = { stories: [], unknown: [] }
    const coverage = computeCoverage(matrix)
    assert.equal(coverage.total, 0)
    assert.equal(coverage.coveragePct, 0)
  })
})

// ─── Registry trace methods ──────────────────────────────────────────────

describe('Registry trace methods', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('getTraces returns empty object when no traces exist', async () => {
    const registry = new Registry(root)
    await registry.load()
    assert.deepEqual(registry.getTraces(), {})
  })

  test('recordTrace creates trace records', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001', 'STORY-003'])

    const traces = registry.getTraces()
    assert.ok(traces['STORY-001'])
    assert.deepEqual(traces['STORY-001'].active, ['add-login'])
    assert.equal(traces['STORY-001'].implemented, false)

    assert.ok(traces['STORY-003'])
    assert.deepEqual(traces['STORY-003'].active, ['add-login'])
    assert.equal(traces['STORY-003'].implemented, false)
  })

  test('recordTrace handles multiple changes for same story', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001'])
    registry.recordTrace('user-profiles', ['STORY-001'])

    const traces = registry.getTraces()
    assert.deepEqual(traces['STORY-001'].active, ['add-login', 'user-profiles'])
  })

  test('recordTrace updates when stories field changes', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001', 'STORY-003'])
    // Stories field was edited — STORY-003 removed
    registry.recordTrace('add-login', ['STORY-001'])

    const traces = registry.getTraces()
    assert.deepEqual(traces['STORY-001'].active, ['add-login'])
    // STORY-003 should be cleaned up (no active, not implemented)
    assert.ok(!traces['STORY-003'])
  })

  test('markStoryImplemented marks story as implemented', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001'])
    registry.markStoryImplemented('STORY-001', '2026-07-08-add-login')

    const traces = registry.getTraces()
    assert.equal(traces['STORY-001'].implemented, true)
    assert.equal(traces['STORY-001'].implementedBy, '2026-07-08-add-login')
    assert.deepEqual(traces['STORY-001'].active, [])
  })

  test('markStoryImplemented removes archived change from active array', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001'])
    registry.recordTrace('user-profiles', ['STORY-001'])
    registry.markStoryImplemented('STORY-001', '2026-07-08-add-login')

    const traces = registry.getTraces()
    assert.equal(traces['STORY-001'].implemented, true)
    assert.deepEqual(traces['STORY-001'].active, ['user-profiles'])
  })

  test('removeTraceLinks removes change from all story records', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001', 'STORY-003'])
    registry.removeTraceLinks('add-login')

    const traces = registry.getTraces()
    // Both should be cleaned up (no active, not implemented)
    assert.ok(!traces['STORY-001'])
    assert.ok(!traces['STORY-003'])
  })

  test('traces persist to disk after save', async () => {
    const registry = new Registry(root)
    await registry.load()
    registry.recordTrace('add-login', ['STORY-001'])
    await registry.save()

    // Load fresh registry from same root
    const registry2 = new Registry(root)
    await registry2.load()
    const traces = registry2.getTraces()
    assert.ok(traces['STORY-001'])
    assert.deepEqual(traces['STORY-001'].active, ['add-login'])
  })

  test('_fresh includes traces: {}', async () => {
    const registry = new Registry(root)
    await registry.load()
    assert.deepEqual(registry.data.traces, {})
  })
})

// ─── recordTraceLinks ────────────────────────────────────────────────────

describe('recordTraceLinks', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('records trace links from active proposals into registry', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstories: STORY-001, STORY-003\n---\n\n# Add Login',
    )

    const registry = new Registry(root)
    await registry.load()
    await recordTraceLinks(root, registry)

    const traces = registry.getTraces()
    assert.ok(traces['STORY-001'])
    assert.deepEqual(traces['STORY-001'].active, ['add-login'])
    assert.ok(traces['STORY-003'])
    assert.deepEqual(traces['STORY-003'].active, ['add-login'])
  })

  test('handles no active changes gracefully', async () => {
    const registry = new Registry(root)
    await registry.load()
    await recordTraceLinks(root, registry)
    assert.deepEqual(registry.getTraces(), {})
  })
})

// ─── computeCoverage detailed scenario ───────────────────────────────────

describe('computeCoverage detailed scenario', () => {
  test('5 stories: 2 active, 1 implemented, 2 uncovered', () => {
    const matrix = {
      stories: [
        { id: 'S-1', status: 'active', activeChanges: ['c1'], implementedBy: null },
        { id: 'S-2', status: 'active', activeChanges: ['c2'], implementedBy: null },
        { id: 'S-3', status: 'implemented', activeChanges: [], implementedBy: 'a1' },
        { id: 'S-4', status: 'uncovered', activeChanges: [], implementedBy: null },
        { id: 'S-5', status: 'uncovered', activeChanges: [], implementedBy: null },
      ],
      unknown: [],
    }

    const coverage = computeCoverage(matrix)
    assert.equal(coverage.total, 5)
    assert.equal(coverage.active, 2)
    assert.equal(coverage.implemented, 1)
    assert.equal(coverage.uncovered, 2)
    assert.equal(coverage.coveragePct, 60) // (2+1)/5 * 100 = 60
  })

  test('full coverage when all stories have links', () => {
    const matrix = {
      stories: [
        { id: 'S-1', status: 'active', activeChanges: ['c1'], implementedBy: null },
        { id: 'S-2', status: 'implemented', activeChanges: [], implementedBy: 'a1' },
      ],
      unknown: [],
    }

    const coverage = computeCoverage(matrix)
    assert.equal(coverage.coveragePct, 100)
    assert.equal(coverage.uncovered, 0)
  })
})
