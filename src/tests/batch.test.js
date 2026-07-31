/**
 * Tests for the Batch Operations feature.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  discoverChanges,
  applyFilter,
  batchReviewApprove,
  batchVerifyPass,
  batchArchive,
  batchStatus,
  formatBatchTable,
  formatBatchJson,
  formatStatusTable,
  BATCH_EVENT_TYPES,
} from '../core/batch.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '.test-fixtures', 'batch')

/** Create a minimal change directory with given frontmatter states. */
async function createChange(projectRoot, slug, opts = {}) {
  const changeDir = join(projectRoot, '.specfuse', 'changes', slug)
  await mkdir(changeDir, { recursive: true })

  const proposalData = {
    title: opts.title ?? slug,
    status: opts.proposalStatus ?? 'active',
    ...(opts.proposalExtra ?? {}),
  }
  await writeFile(join(changeDir, 'proposal.md'), frontmatter(proposalData, `# Change Proposal: ${opts.title ?? slug}\n\nOverview here.`))

  if (opts.design !== false) {
    await writeFile(join(changeDir, 'design.md'), `# Design\n\n**Affects UI:** no\n`)
  }
  if (opts.tasks !== false) {
    await writeFile(join(changeDir, 'tasks.md'), `# Tasks\n\n- [ ] Task 1\n`)
  }
  if (opts.review !== false) {
    const reviewData = { status: opts.reviewStatus ?? 'pending' }
    await writeFile(join(changeDir, 'review.md'), frontmatter(reviewData, `# Review\n\n- [ ] Item 1\n`))
  }
  if (opts.verify !== false) {
    const verifyData = { status: opts.verifyStatus ?? 'unverified' }
    await writeFile(join(changeDir, 'verify.md'), frontmatter(verifyData, `# Verify\n\n- [ ] confirmed: AC1\n`))
  }

  return changeDir
}

/** Build a YAML-ish frontmatter block + body. */
function frontmatter(data, body) {
  const entries = Object.entries(data)
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}: ~`
      if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`
      return `${k}: ${v}`
    })
    .join('\n')
  return `---\n${entries}\n---\n\n${body}`
}

/** Parse frontmatter status from file content. */
function parseStatus(content) {
  const match = content.match(/^---\n[\s\S]*?status:\s*(.+?)\s*$/m)
  return match ? match[1].trim() : null
}

describe('Batch — Discovery', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `disc-${Date.now()}`)
    await mkdir(join(projectRoot, '.specfuse', 'changes'), { recursive: true })
    // Create registry so project is valid
    await mkdir(join(projectRoot, '.specfuse'), { recursive: true })
    await writeFile(join(projectRoot, '.specfuse', 'registry.json'), JSON.stringify({
      version: '4.0.0', phase: 'development', projectName: 'Test', artifacts: {},
      syncs: {}, traces: {}, history: [], maxHistory: 100,
    }, null, 2) + '\n')
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('discovers all active changes with correct state', async () => {
    await createChange(projectRoot, 'add-auth', { reviewStatus: 'approved', verifyStatus: 'pass' })
    await createChange(projectRoot, 'add-logging', { reviewStatus: 'approved', verifyStatus: 'unverified' })
    await createChange(projectRoot, 'fix-bug', { review: false, verify: false })

    const changes = await discoverChanges(projectRoot)
    assert.strictEqual(changes.length, 3)

    const auth = changes.find((c) => c.slug === 'add-auth')
    assert.ok(auth)
    assert.strictEqual(auth.state, 'verified')
    assert.strictEqual(auth.reviewStatus, 'approved')
    assert.strictEqual(auth.verifyStatus, 'pass')

    const log = changes.find((c) => c.slug === 'add-logging')
    assert.ok(log)
    assert.strictEqual(log.state, 'reviewed')
    assert.strictEqual(log.reviewStatus, 'approved')
    assert.strictEqual(log.verifyStatus, 'unverified')

    const bug = changes.find((c) => c.slug === 'fix-bug')
    assert.ok(bug)
    assert.strictEqual(bug.reviewStatus, 'missing')
    assert.strictEqual(bug.verifyStatus, 'missing')
  })

  it('excludes archive directory from discovery', async () => {
    await createChange(projectRoot, 'active-change')
    // Manually create an archive dir
    const archiveDir = join(projectRoot, '.specfuse', 'changes', 'archive')
    await mkdir(archiveDir, { recursive: true })
    const archivedChangeDir = join(archiveDir, '2026-01-01-old-change')
    await mkdir(archivedChangeDir, { recursive: true })
    await writeFile(join(archivedChangeDir, 'proposal.md'), frontmatter({ status: 'archived' }, '# Old'))

    const changes = await discoverChanges(projectRoot)
    assert.strictEqual(changes.length, 1)
    assert.strictEqual(changes[0].slug, 'active-change')
  })

  it('returns empty array when no changes exist', async () => {
    const changes = await discoverChanges(projectRoot)
    assert.deepStrictEqual(changes, [])
  })
})

describe('Batch — Filtering', () => {
  const sampleChanges = [
    { slug: 'add-auth' },
    { slug: 'add-logging' },
    { slug: 'fix-auth-bug' },
    { slug: 'update-api' },
  ]

  it('filters by glob pattern (prefix match)', async () => {
    const result = await applyFilter(sampleChanges, 'add-*', 'glob')
    assert.strictEqual(result.length, 2)
    assert.ok(result.every((c) => c.slug.startsWith('add-')))
  })

  it('filters by exact glob pattern', async () => {
    const result = await applyFilter(sampleChanges, 'add-auth', 'glob')
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].slug, 'add-auth')
  })

  it('filters by regex pattern with / prefix', async () => {
    const result = await applyFilter(sampleChanges, '/^add-', 'regex')
    assert.strictEqual(result.length, 2)
    assert.ok(result.every((c) => c.slug.startsWith('add-')))
  })

  it('filters by regex pattern with auth in name', async () => {
    const result = await applyFilter(sampleChanges, '/auth', 'regex')
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].slug, 'add-auth')
    assert.strictEqual(result[1].slug, 'fix-auth-bug')
  })

  it('throws BatchFilterError for invalid regex', async () => {
    await assert.rejects(
      async () => applyFilter(sampleChanges, '/[invalid/', 'regex'),
      (err) => err.name === 'BatchFilterError',
    )
  })

  it('returns all changes when no filter is provided', async () => {
    const result = await applyFilter(sampleChanges, '', 'glob')
    assert.strictEqual(result.length, 4)
  })

  it('returns empty when glob matches nothing', async () => {
    const result = await applyFilter(sampleChanges, 'nonexistent-*', 'glob')
    assert.strictEqual(result.length, 0)
  })
})

describe('Batch — Review Approve', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `rev-${Date.now()}`)
    await mkdir(join(projectRoot, '.specfuse', 'changes'), { recursive: true })
    await mkdir(join(projectRoot, '.specfuse'), { recursive: true })
    await writeFile(join(projectRoot, '.specfuse', 'registry.json'), JSON.stringify({
      version: '4.0.0', phase: 'development', projectName: 'Test', artifacts: {},
      syncs: {}, traces: {}, history: [], maxHistory: 100,
    }, null, 2) + '\n')
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('updates review.md status to approved for eligible changes', async () => {
    await createChange(projectRoot, 'add-auth', { reviewStatus: 'pending' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchReviewApprove(projectRoot, changes)
    assert.strictEqual(result.succeeded.length, 1)
    assert.strictEqual(result.succeeded[0].slug, 'add-auth')

    // Verify file was actually updated
    const { readFile } = await import('fs/promises')
    const content = await readFile(join(projectRoot, '.specfuse', 'changes', 'add-auth', 'review.md'), 'utf8')
    assert.strictEqual(parseStatus(content), 'approved')
  })

  it('skips changes without review.md', async () => {
    await createChange(projectRoot, 'no-review', { review: false, verify: false })
    const changes = await discoverChanges(projectRoot)

    const result = await batchReviewApprove(projectRoot, changes)
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].reason, 'review.md not generated')
  })

  it('skips changes already approved', async () => {
    await createChange(projectRoot, 'already-approved', { reviewStatus: 'approved' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchReviewApprove(projectRoot, changes)
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].reason, 'already approved')
  })

  it('dry-run does not modify files', async () => {
    await createChange(projectRoot, 'dry-test', { reviewStatus: 'pending' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchReviewApprove(projectRoot, changes, { dryRun: true })
    assert.strictEqual(result.succeeded.length, 1)

    // File should still have pending status
    const { readFile } = await import('fs/promises')
    const content = await readFile(join(projectRoot, '.specfuse', 'changes', 'dry-test', 'review.md'), 'utf8')
    assert.strictEqual(parseStatus(content), 'pending')
  })

  it('handles mixed results (some succeed, some skip)', async () => {
    await createChange(projectRoot, 'pending-change', { reviewStatus: 'pending' })
    await createChange(projectRoot, 'approved-change', { reviewStatus: 'approved' })
    await createChange(projectRoot, 'no-review-change', { review: false, verify: false })

    const changes = await discoverChanges(projectRoot)
    const result = await batchReviewApprove(projectRoot, changes)

    assert.strictEqual(result.succeeded.length, 1)
    assert.strictEqual(result.skipped.length, 2)
    assert.strictEqual(result.failed.length, 0)
  })
})

describe('Batch — Verify Pass', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `ver-${Date.now()}`)
    await mkdir(join(projectRoot, '.specfuse', 'changes'), { recursive: true })
    await mkdir(join(projectRoot, '.specfuse'), { recursive: true })
    await writeFile(join(projectRoot, '.specfuse', 'registry.json'), JSON.stringify({
      version: '4.0.0', phase: 'development', projectName: 'Test', artifacts: {},
      syncs: {}, traces: {}, history: [], maxHistory: 100,
    }, null, 2) + '\n')
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('updates verify.md status to pass for reviewed changes', async () => {
    await createChange(projectRoot, 'reviewed-change', { reviewStatus: 'approved', verifyStatus: 'unverified' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchVerifyPass(projectRoot, changes)
    assert.strictEqual(result.succeeded.length, 1)

    const { readFile } = await import('fs/promises')
    const content = await readFile(join(projectRoot, '.specfuse', 'changes', 'reviewed-change', 'verify.md'), 'utf8')
    assert.strictEqual(parseStatus(content), 'pass')
  })

  it('skips changes without verify.md', async () => {
    await createChange(projectRoot, 'no-verify', { review: false, verify: false })
    const changes = await discoverChanges(projectRoot)

    const result = await batchVerifyPass(projectRoot, changes)
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].reason, 'verify.md not generated')
  })

  it('skips changes without approved review', async () => {
    await createChange(projectRoot, 'not-reviewed', { reviewStatus: 'pending', verifyStatus: 'unverified' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchVerifyPass(projectRoot, changes)
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].reason, 'review not approved')
  })

  it('skips changes already passed', async () => {
    await createChange(projectRoot, 'already-passed', { reviewStatus: 'approved', verifyStatus: 'pass' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchVerifyPass(projectRoot, changes)
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].reason, 'already passed')
  })

  it('dry-run does not modify files', async () => {
    await createChange(projectRoot, 'dry-verify', { reviewStatus: 'approved', verifyStatus: 'unverified' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchVerifyPass(projectRoot, changes, { dryRun: true })
    assert.strictEqual(result.succeeded.length, 1)

    const { readFile } = await import('fs/promises')
    const content = await readFile(join(projectRoot, '.specfuse', 'changes', 'dry-verify', 'verify.md'), 'utf8')
    assert.strictEqual(parseStatus(content), 'unverified')
  })
})

describe('Batch — Archive', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `arch-${Date.now()}`)
    await mkdir(join(projectRoot, '.specfuse', 'changes'), { recursive: true })
    await mkdir(join(projectRoot, '.specfuse'), { recursive: true })
    await writeFile(join(projectRoot, '.specfuse', 'registry.json'), JSON.stringify({
      version: '4.0.0', phase: 'development', projectName: 'Test', artifacts: {},
      syncs: {}, traces: {}, history: [], maxHistory: 100,
    }, null, 2) + '\n')
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('archives verified changes and moves them to archive dir', async () => {
    await createChange(projectRoot, 'verified-change', { reviewStatus: 'approved', verifyStatus: 'pass' })
    const changes = await discoverChanges(projectRoot)

    const registry = new Registry(projectRoot)
    await registry.load()

    const result = await batchArchive(projectRoot, changes, {}, { registry })
    assert.strictEqual(result.succeeded.length, 1)
    assert.ok(result.succeeded[0].archiveName)

    // Active dir should be gone
    assert.ok(!existsSync(join(projectRoot, '.specfuse', 'changes', 'verified-change')))
    // Archive dir should exist
    assert.ok(existsSync(join(projectRoot, '.specfuse', 'changes', 'archive', result.succeeded[0].archiveName)))
    // Archived proposal should have status: archived
    const { readFile } = await import('fs/promises')
    const archivedProposal = await readFile(join(projectRoot, '.specfuse', 'changes', 'archive', result.succeeded[0].archiveName, 'proposal.md'), 'utf8')
    assert.strictEqual(parseStatus(archivedProposal), 'archived')
  })

  it('skips unverified changes without --force', async () => {
    await createChange(projectRoot, 'unverified-change', { reviewStatus: 'approved', verifyStatus: 'unverified' })
    const changes = await discoverChanges(projectRoot)

    const registry = new Registry(projectRoot)
    await registry.load()

    const result = await batchArchive(projectRoot, changes, {}, { registry })
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].reason, 'verify not passed')
    // Active dir should still exist
    assert.ok(existsSync(join(projectRoot, '.specfuse', 'changes', 'unverified-change')))
  })

  it('archives unverified changes with --force', async () => {
    await createChange(projectRoot, 'forced-change', { reviewStatus: 'approved', verifyStatus: 'unverified' })
    const changes = await discoverChanges(projectRoot)

    const registry = new Registry(projectRoot)
    await registry.load()

    const result = await batchArchive(projectRoot, changes, { force: true }, { registry })
    assert.strictEqual(result.succeeded.length, 1)
    assert.ok(!existsSync(join(projectRoot, '.specfuse', 'changes', 'forced-change')))
  })

  it('updates traceability for linked stories', async () => {
    await createChange(projectRoot, 'story-change', {
      reviewStatus: 'approved',
      verifyStatus: 'pass',
      proposalExtra: { stories: 'STORY-001, STORY-002' },
    })
    const changes = await discoverChanges(projectRoot)

    // Set up stories in registry
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.data.traces = {
      'STORY-001': { active: [], implemented: false },
      'STORY-002': { active: [], implemented: false },
    }

    const result = await batchArchive(projectRoot, changes, {}, { registry })
    assert.strictEqual(result.succeeded.length, 1)
    // Stories should be marked as implemented
    const story1 = registry.data.traces['STORY-001']
    assert.ok(story1)
    assert.strictEqual(story1.implemented, true)
  })

  it('dry-run does not modify files', async () => {
    await createChange(projectRoot, 'dry-archive', { reviewStatus: 'approved', verifyStatus: 'pass' })
    const changes = await discoverChanges(projectRoot)

    const result = await batchArchive(projectRoot, changes, { dryRun: true })
    assert.strictEqual(result.succeeded.length, 1)
    // Active dir should still exist
    assert.ok(existsSync(join(projectRoot, '.specfuse', 'changes', 'dry-archive')))
  })

  it('handles partial failure gracefully', async () => {
    await createChange(projectRoot, 'good-change', { reviewStatus: 'approved', verifyStatus: 'pass' })
    await createChange(projectRoot, 'bad-change', { reviewStatus: 'pending', verifyStatus: 'unverified' })

    const changes = await discoverChanges(projectRoot)
    const registry = new Registry(projectRoot)
    await registry.load()

    const result = await batchArchive(projectRoot, changes, {}, { registry })
    assert.strictEqual(result.succeeded.length, 1)
    assert.strictEqual(result.skipped.length, 1)
  })
})

describe('Batch — Status', () => {
  it('returns correct counts by state', () => {
    const changes = [
      { slug: 'a', state: 'active', reviewStatus: 'pending', verifyStatus: 'missing' },
      { slug: 'b', state: 'active', reviewStatus: 'pending', verifyStatus: 'missing' },
      { slug: 'c', state: 'reviewed', reviewStatus: 'approved', verifyStatus: 'unverified' },
      { slug: 'd', state: 'verified', reviewStatus: 'approved', verifyStatus: 'pass' },
    ]

    const status = batchStatus('/fake/root', changes)
    assert.strictEqual(status.total, 4)
    assert.strictEqual(status.byState.active, 2)
    assert.strictEqual(status.byState.reviewed, 1)
    assert.strictEqual(status.byState.verified, 1)
  })

  it('returns empty counts for no changes', () => {
    const status = batchStatus('/fake/root', [])
    assert.strictEqual(status.total, 0)
    assert.deepStrictEqual(status.byState, {})
  })
})

describe('Batch — Formatting', () => {
  it('formatBatchTable includes succeeded, skipped, failed', () => {
    const result = {
      succeeded: [{ slug: 'change-a' }],
      skipped: [{ slug: 'change-b', reason: 'already approved' }],
      failed: [{ slug: 'change-c', error: 'EACCES' }],
    }
    const output = formatBatchTable(result, 'review approve')
    assert.ok(output.includes('Succeeded: 1'))
    assert.ok(output.includes('Skipped:   1'))
    assert.ok(output.includes('Failed:    1'))
    assert.ok(output.includes('change-a'))
    assert.ok(output.includes('already approved'))
    assert.ok(output.includes('EACCES'))
  })

  it('formatBatchJson produces valid JSON', () => {
    const result = { succeeded: [], skipped: [], failed: [] }
    const output = formatBatchJson(result)
    const parsed = JSON.parse(output)
    assert.deepStrictEqual(parsed.succeeded, [])
  })

  it('formatStatusTable shows counts and change list', () => {
    const status = {
      total: 3,
      byState: { active: 2, verified: 1 },
      changes: [
        { slug: 'a', state: 'active', reviewStatus: 'pending', verifyStatus: 'missing' },
        { slug: 'b', state: 'active', reviewStatus: 'approved', verifyStatus: 'unverified' },
        { slug: 'c', state: 'verified', reviewStatus: 'approved', verifyStatus: 'pass' },
      ],
    }
    const output = formatStatusTable(status)
    assert.ok(output.includes('Active'))
    assert.ok(output.includes('Verified'))
    assert.ok(output.includes('a'))
    assert.ok(output.includes('c'))
  })
})

describe('Batch — History Events', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `hist-${Date.now()}`)
    await mkdir(join(projectRoot, '.specfuse'), { recursive: true })
    // Create a valid registry.json
    await writeFile(join(projectRoot, '.specfuse', 'registry.json'), JSON.stringify({
      version: '4.0.0', phase: 'development', projectName: 'Test', artifacts: {},
      syncs: {}, traces: {}, history: [], maxHistory: 100,
    }, null, 2) + '\n')
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('EVENT_TYPES includes batch_review, batch_verify, batch_archive', () => {
    assert.strictEqual(EVENT_TYPES.batch_review, 'batch_review')
    assert.strictEqual(EVENT_TYPES.batch_verify, 'batch_verify')
    assert.strictEqual(EVENT_TYPES.batch_archive, 'batch_archive')
  })

  it('BATCH_EVENT_TYPES matches EVENT_TYPES subset', () => {
    assert.strictEqual(BATCH_EVENT_TYPES.batch_review, EVENT_TYPES.batch_review)
    assert.strictEqual(BATCH_EVENT_TYPES.batch_verify, EVENT_TYPES.batch_verify)
    assert.strictEqual(BATCH_EVENT_TYPES.batch_archive, EVENT_TYPES.batch_archive)
  })

  it('records batch_review event and persists across save/load', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, EVENT_TYPES.batch_review, 'Batch approved 3 review(s)', {
      count: 3,
      changes: ['add-auth', 'add-logging', 'fix-bug'],
    })
    await registry.save()

    const registry2 = new Registry(projectRoot)
    await registry2.load()
    assert.strictEqual(registry2.data.history.length, 1)
    assert.strictEqual(registry2.data.history[0].type, 'batch_review')
    assert.strictEqual(registry2.data.history[0].details.count, 3)
  })

  it('records batch_verify event', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, EVENT_TYPES.batch_verify, 'Batch passed 2 verification(s)', { count: 2 })
    await registry.save()

    const registry2 = new Registry(projectRoot)
    await registry2.load()
    assert.strictEqual(registry2.data.history[0].type, 'batch_verify')
  })

  it('records batch_archive event', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, EVENT_TYPES.batch_archive, 'Batch archived 1 change(s)', { count: 1, forced: true })
    await registry.save()

    const registry2 = new Registry(projectRoot)
    await registry2.load()
    assert.strictEqual(registry2.data.history[0].type, 'batch_archive')
    assert.strictEqual(registry2.data.history[0].details.forced, true)
  })
})

describe('Batch — No matching changes', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `empty-${Date.now()}`)
    await mkdir(join(projectRoot, '.specfuse', 'changes'), { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('batchReviewApprove returns empty result with no changes', async () => {
    const changes = await discoverChanges(projectRoot)
    const result = await batchReviewApprove(projectRoot, changes)
    assert.strictEqual(result.succeeded.length, 0)
    assert.strictEqual(result.skipped.length, 0)
    assert.strictEqual(result.failed.length, 0)
  })

  it('batchVerifyPass returns empty result with no changes', async () => {
    const changes = await discoverChanges(projectRoot)
    const result = await batchVerifyPass(projectRoot, changes)
    assert.strictEqual(result.succeeded.length, 0)
  })

  it('batchArchive returns empty result with no changes', async () => {
    const changes = await discoverChanges(projectRoot)
    const result = await batchArchive(projectRoot, changes)
    assert.strictEqual(result.succeeded.length, 0)
  })

  it('batchStatus returns zero total with no changes', () => {
    const status = batchStatus(projectRoot, [])
    assert.strictEqual(status.total, 0)
  })
})
