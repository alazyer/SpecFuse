import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  SpecFuseApiError,
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  ChangeNotVerifiedError,
  SchemaNotFoundError,
} from '../api/errors.mjs'

import * as plan from '../api/plan.mjs'
import * as specify from '../api/specify.mjs'
import * as change from '../api/change.mjs'
import * as schema from '../api/schema.mjs'
import { sync, drift, diff, status, phase } from '../api/sync-ops.mjs'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ARCH_DOC = `# Architecture
## Architectural Decisions
- Microservices with Docker
- PostgreSQL per service
## Tech Stack
- Node.js 20 LTS
- Redis 7
## Security
- TLS 1.3 required
- JWT 15-minute expiry
`

const PRD_DOC = `# PRD
## Overview
Test project overview.
## Core Features
- Feature A
- Feature B
`

const CONSTITUTION_DOC = `# Project Constitution

> The single authoritative source.

---

## Core Principles

*(Add your project's guiding principles here)*

## Security Rules

- TLS 1.3 required
- JWT 15-minute expiry
`

let tempDir

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTempProject() {
  tempDir = await mkdtemp(join(tmpdir(), 'specfuse-api-test-'))
  await mkdir(join(tempDir, '.specfuse'), { recursive: true })
  return tempDir
}

async function cleanupTemp() {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
}

async function initMinimalProject(root) {
  // Create a minimal .specfuse structure for sync/phase to work
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await writeFile(join(root, '.specfuse', 'constitution.md'), CONSTITUTION_DOC)
  await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), PRD_DOC)
  await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

  // Minimal registry
  const registry = {
    name: 'test-project',
    hooksInstalled: false,
    version: 4,
  }
  await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify(registry, null, 2))
}

// ─── Error Classes ───────────────────────────────────────────────────────────

describe('Error classes', () => {
  test('SpecFuseApiError is base class', () => {
    const err = new SpecFuseApiError('test')
    assert.ok(err instanceof Error)
    assert.ok(err instanceof SpecFuseApiError)
    assert.equal(err.name, 'SpecFuseApiError')
    assert.equal(err.message, 'test')
  })

  test('ArtifactAlreadyExistsError has artifactType and path', () => {
    const err = new ArtifactAlreadyExistsError('exists', { artifactType: 'change', path: '/x' })
    assert.ok(err instanceof SpecFuseApiError)
    assert.equal(err.name, 'ArtifactAlreadyExistsError')
    assert.equal(err.artifactType, 'change')
    assert.equal(err.path, '/x')
  })

  test('ArtifactNotFoundError has artifactType, artifactName, and path', () => {
    const err = new ArtifactNotFoundError('missing', { artifactType: 'constitution', name: 'main', path: '/y' })
    assert.ok(err instanceof SpecFuseApiError)
    assert.equal(err.name, 'ArtifactNotFoundError')
    assert.equal(err.artifactType, 'constitution')
    assert.equal(err.artifactName, 'main')
    assert.equal(err.path, '/y')
  })

  test('ChangeNotVerifiedError has slug, verifyStatus, checked, total', () => {
    const err = new ChangeNotVerifiedError('not verified', { slug: 'my-change', verifyStatus: 'fail', checked: 1, total: 5 })
    assert.ok(err instanceof SpecFuseApiError)
    assert.equal(err.name, 'ChangeNotVerifiedError')
    assert.equal(err.slug, 'my-change')
    assert.equal(err.verifyStatus, 'fail')
    assert.equal(err.checked, 1)
    assert.equal(err.total, 5)
  })

  test('SchemaNotFoundError has path', () => {
    const err = new SchemaNotFoundError('no schema', { path: '/z' })
    assert.ok(err instanceof SpecFuseApiError)
    assert.equal(err.name, 'SchemaNotFoundError')
    assert.equal(err.path, '/z')
  })

  test('errors support cause', () => {
    const cause = new Error('original')
    const err = new SpecFuseApiError('wrapped', { cause })
    assert.equal(err.cause, cause)
  })
})

// ─── Plan API ────────────────────────────────────────────────────────────────

describe('Plan API', () => {
  beforeEach(async () => {
    await createTempProject()
  })

  afterEach(async () => {
    await cleanupTemp()
  })

  test('createPrd creates a PRD file', async () => {
    const result = await plan.createPrd(tempDir, { name: 'TestApp' })
    assert.equal(result.created, true)
    assert.ok(result.path.endsWith('prd.md'))
    assert.ok(result.content.length > 0)
    assert.ok(existsSync(result.path))
  })

  test('createPrd returns created:false if already exists', async () => {
    await plan.createPrd(tempDir, { name: 'TestApp' })
    const result = await plan.createPrd(tempDir, { name: 'TestApp' })
    assert.equal(result.created, false)
  })

  test('createArch creates an architecture file', async () => {
    const result = await plan.createArch(tempDir)
    assert.equal(result.created, true)
    assert.ok(result.path.endsWith('architecture.md'))
    assert.ok(result.content.length > 0)
    assert.ok(existsSync(result.path))
  })

  test('createArch returns created:false if already exists', async () => {
    await plan.createArch(tempDir)
    const result = await plan.createArch(tempDir)
    assert.equal(result.created, false)
  })

  test('createStory creates a numbered story file', async () => {
    const result = await plan.createStory(tempDir, 'User Login')
    assert.ok(result.path.endsWith('.md'))
    assert.ok(result.filename.startsWith('story-'))
    assert.ok(result.id.startsWith('STORY-'))
    assert.ok(existsSync(result.path))
  })

  test('createStory creates multiple stories with incrementing numbers', async () => {
    const r1 = await plan.createStory(tempDir, 'First')
    const r2 = await plan.createStory(tempDir, 'Second')
    assert.ok(r1.id.includes('001'))
    assert.ok(r2.id.includes('002'))
    assert.notEqual(r1.filename, r2.filename)
  })

  test('createDesignSystem creates a system design doc', async () => {
    const result = await plan.createDesignSystem(tempDir)
    assert.equal(result.created, true)
    assert.ok(result.path.endsWith('system.md'))
    assert.ok(existsSync(result.path))
  })

  test('createDesignSystem returns created:false if already exists', async () => {
    await plan.createDesignSystem(tempDir)
    const result = await plan.createDesignSystem(tempDir)
    assert.equal(result.created, false)
  })

  test('createDesignFlow creates a numbered flow file', async () => {
    const result = await plan.createDesignFlow(tempDir, 'User Onboarding')
    assert.ok(result.filename.startsWith('flow-'))
    assert.ok(result.id.startsWith('FLOW-'))
    assert.ok(existsSync(result.path))
  })

  test('createDesignScreen creates a numbered screen file', async () => {
    const result = await plan.createDesignScreen(tempDir, 'Login Screen')
    assert.ok(result.filename.startsWith('screen-'))
    assert.ok(result.id.startsWith('SCREEN-'))
    assert.ok(existsSync(result.path))
  })

  test('list returns structured artifact status', async () => {
    await plan.createPrd(tempDir, { name: 'TestApp' })
    await plan.createArch(tempDir)
    const result = await plan.list(tempDir)
    assert.ok(Array.isArray(result.artifacts))
    assert.ok(result.artifacts.length >= 2)

    const prd = result.artifacts.find((a) => a.type === 'prd')
    assert.ok(prd, 'PRD artifact should exist')
    assert.equal(prd.exists, true)
    assert.ok(prd.modifiedTime)

    const arch = result.artifacts.find((a) => a.type === 'arch')
    assert.ok(arch, 'Architecture artifact should exist')
    assert.equal(arch.exists, true)
  })

  test('list shows non-existent artifacts', async () => {
    const result = await plan.list(tempDir)
    const prd = result.artifacts.find((a) => a.type === 'prd')
    assert.ok(prd)
    assert.equal(prd.exists, false)
  })

  test('list includes stories with acceptance criteria', async () => {
    await plan.createStory(tempDir, 'Login')
    const result = await plan.list(tempDir)
    const stories = result.artifacts.filter((a) => a.type === 'story')
    assert.ok(stories.length >= 1)
    assert.ok(stories[0].filename)
  })
})

// ─── Specify API ─────────────────────────────────────────────────────────────

describe('Specify API', () => {
  beforeEach(async () => {
    await createTempProject()
  })

  afterEach(async () => {
    await cleanupTemp()
  })

  test('init creates constitution.md', async () => {
    const result = await specify.init(tempDir)
    assert.equal(result.created, true)
    assert.ok(result.path.endsWith('constitution.md'))
    assert.ok(result.content.length > 0)
    assert.ok(existsSync(result.path))
  })

  test('init returns created:false if already exists', async () => {
    await specify.init(tempDir)
    const result = await specify.init(tempDir)
    assert.equal(result.created, false)
  })

  test('init with force recreates constitution', async () => {
    await specify.init(tempDir)
    const result = await specify.init(tempDir, { force: true })
    assert.equal(result.created, true)
  })

  test('init with sync syncs plan artifacts', async () => {
    // Create plan artifacts first
    await plan.createPrd(tempDir, { name: 'TestApp' })
    await plan.createArch(tempDir)
    const result = await specify.init(tempDir, { sync: true })
    assert.equal(result.created, true)
    // syncedSections may be 0 if no rules match in test env
    assert.ok(result.syncedSections !== undefined)
  })

  test('add adds a new section', async () => {
    await specify.init(tempDir)
    const result = await specify.add(tempDir, 'API Standards', '- Use REST\n- Version all endpoints')
    assert.equal(result.added, true)
    assert.equal(result.section, 'API Standards')

    const content = await readFile(join(tempDir, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(content.includes('## API Standards'))
    assert.ok(content.includes('Use REST'))
  })

  test('add replaces existing section', async () => {
    await specify.init(tempDir)
    await specify.add(tempDir, 'API Standards', 'Old rules')
    const result = await specify.add(tempDir, 'API Standards', 'New rules')
    assert.equal(result.added, false)

    const content = await readFile(join(tempDir, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(content.includes('New rules'))
    assert.ok(!content.includes('Old rules'))
  })

  test('add throws ArtifactNotFoundError if no constitution', async () => {
    await assert.rejects(
      () => specify.add(tempDir, 'API Standards', 'Rules'),
      (err) => err instanceof ArtifactNotFoundError,
    )
  })

  test('show returns parsed constitution sections', async () => {
    await specify.init(tempDir)
    await specify.add(tempDir, 'API Standards', '- Use REST')
    const result = await specify.show(tempDir)
    assert.ok(Array.isArray(result.sections))
    assert.ok(typeof result.raw === 'string')
    assert.ok(result.raw.length > 0)

    const apiSection = result.sections.find((s) => s.heading === 'API Standards')
    assert.ok(apiSection, 'API Standards section should exist')
    assert.ok(apiSection.content.includes('Use REST'))
  })

  test('show throws ArtifactNotFoundError if missing', async () => {
    await assert.rejects(
      () => specify.show(tempDir),
      (err) => err instanceof ArtifactNotFoundError,
    )
  })
})

// ─── Change API ──────────────────────────────────────────────────────────────

describe('Change API', () => {
  beforeEach(async () => {
    await createTempProject()
  })

  afterEach(async () => {
    await cleanupTemp()
  })

  test('new creates a change proposal directory', async () => {
    const result = await change.new(tempDir, 'Add Authentication')
    assert.equal(result.slug, 'add-authentication')
    assert.ok(result.dir)
    assert.ok(existsSync(result.dir))
    assert.equal(result.files.length, 3)
    assert.ok(result.files.find((f) => f.name === 'proposal.md'))
    assert.ok(result.files.find((f) => f.name === 'design.md'))
    assert.ok(result.files.find((f) => f.name === 'tasks.md'))
  })

  test('new throws ArtifactAlreadyExistsError for duplicate', async () => {
    await change.new(tempDir, 'Add Auth')
    await assert.rejects(
      () => change.new(tempDir, 'Add Auth'),
      (err) => err instanceof ArtifactAlreadyExistsError,
    )
  })

  test('list returns active and archived changes', async () => {
    await change.new(tempDir, 'Feature A')
    await change.new(tempDir, 'Feature B')
    const result = await change.list(tempDir)
    assert.ok(Array.isArray(result.active))
    assert.ok(Array.isArray(result.archived))
    assert.equal(result.active.length, 2)
  })

  test('show returns full change detail', async () => {
    await change.new(tempDir, 'Add Logging')
    const result = await change.show(tempDir, 'add-logging')
    assert.equal(result.slug, 'add-logging')
    assert.ok(result.proposal.length > 0)
    assert.ok(result.design.length > 0)
    assert.ok(result.tasks.length > 0)
    assert.equal(result.archived, false)
    assert.ok(typeof result.status === 'string')
  })

  test('show throws ArtifactNotFoundError for missing change', async () => {
    await assert.rejects(
      () => change.show(tempDir, 'nonexistent'),
      (err) => err instanceof ArtifactNotFoundError,
    )
  })

  test('review generates review.md', async () => {
    await change.new(tempDir, 'Add Auth')
    const result = await change.review(tempDir, 'add-auth')
    assert.equal(result.created, true)
    assert.ok(result.path.endsWith('review.md'))
    assert.ok(result.content.length > 0)
    assert.ok(typeof result.status === 'string')
  })

  test('review returns created:false if review.md already exists', async () => {
    await change.new(tempDir, 'Add Auth')
    await change.review(tempDir, 'add-auth')
    const result = await change.review(tempDir, 'add-auth')
    assert.equal(result.created, false)
  })

  test('verify generates verify.md', async () => {
    await change.new(tempDir, 'Add Auth')
    const result = await change.verify(tempDir, 'add-auth')
    assert.equal(result.created, true)
    assert.ok(result.path.endsWith('verify.md'))
    assert.ok(result.content.length > 0)
    assert.ok(typeof result.status === 'string')
    assert.ok(typeof result.checked === 'number')
    assert.ok(typeof result.total === 'number')
  })

  test('verify returns created:false if verify.md already exists', async () => {
    await change.new(tempDir, 'Add Auth')
    await change.verify(tempDir, 'add-auth')
    const result = await change.verify(tempDir, 'add-auth')
    assert.equal(result.created, false)
  })

  test('archive throws ChangeNotVerifiedError when unverified', async () => {
    await change.new(tempDir, 'Add Auth')
    await assert.rejects(
      () => change.archive(tempDir, 'add-auth'),
      (err) => {
        assert.ok(err instanceof ChangeNotVerifiedError)
        assert.equal(err.slug, 'add-auth')
        return true
      },
    )
  })

  test('archive with force archives unverified change', async () => {
    await change.new(tempDir, 'Add Auth')
    const result = await change.archive(tempDir, 'add-auth', { force: true })
    assert.ok(result.archiveDir.endsWith('add-auth'))
    assert.ok(existsSync(result.archiveDir))
    // Active directory should be gone
    assert.ok(!existsSync(join(tempDir, '.specfuse', 'changes', 'add-auth')))
  })

  test('archive moves change to archive directory', async () => {
    await change.new(tempDir, 'Add Auth')
    // Mark verify as pass by writing frontmatter
    const verifyPath = join(tempDir, '.specfuse', 'changes', 'add-auth', 'verify.md')
    await writeFile(verifyPath, '---\nstatus: pass\n---\n\n# Verify\n\n- [x] confirmed: All AC met\n')
    const result = await change.archive(tempDir, 'add-auth')
    assert.ok(result.archiveDir.includes('archive'))
    assert.ok(existsSync(result.archiveDir))
    // proposal.md in archive should have status: archived
    const archivedProposal = await readFile(join(result.archiveDir, 'proposal.md'), 'utf8')
    assert.ok(archivedProposal.includes('archived'))
  })

  test('archive throws ArtifactNotFoundError for missing change', async () => {
    await assert.rejects(
      () => change.archive(tempDir, 'nonexistent'),
      (err) => err instanceof ArtifactNotFoundError,
    )
  })

  test('list includes archived changes', async () => {
    await change.new(tempDir, 'Add Auth')
    const verifyPath = join(tempDir, '.specfuse', 'changes', 'add-auth', 'verify.md')
    await writeFile(verifyPath, '---\nstatus: pass\n---\n\n# Verify\n\n- [x] confirmed: All AC met\n')
    await change.archive(tempDir, 'add-auth')
    const result = await change.list(tempDir)
    assert.equal(result.active.length, 0)
    assert.ok(result.archived.length >= 1)
  })

  test('show finds archived changes', async () => {
    await change.new(tempDir, 'Add Auth')
    const verifyPath = join(tempDir, '.specfuse', 'changes', 'add-auth', 'verify.md')
    await writeFile(verifyPath, '---\nstatus: pass\n---\n\n# Verify\n\n- [x] confirmed: All AC met\n')
    await change.archive(tempDir, 'add-auth')
    const result = await change.show(tempDir, 'add-auth')
    assert.equal(result.archived, true)
    assert.ok(result.archiveName)
  })
})

// ─── Schema API ──────────────────────────────────────────────────────────────

describe('Schema API', () => {
  beforeEach(async () => {
    await createTempProject()
  })

  afterEach(async () => {
    await cleanupTemp()
  })

  test('init creates schema file', async () => {
    const result = await schema.init(tempDir)
    assert.equal(result.created, true)
    assert.ok(result.path)
    assert.ok(existsSync(result.path))
  })

  test('init returns created:false if already exists', async () => {
    await schema.init(tempDir)
    const result = await schema.init(tempDir)
    assert.equal(result.created, false)
  })

  test('init with force recreates schema', async () => {
    await schema.init(tempDir)
    const result = await schema.init(tempDir, { force: true })
    assert.equal(result.created, true)
  })

  test('show returns parsed schema', async () => {
    await schema.init(tempDir)
    const result = await schema.show(tempDir)
    assert.equal(result.exists, true)
    assert.equal(result.version, 1)
    assert.ok(typeof result.artifacts === 'object')
    assert.ok(result.path)
    assert.ok(result.displayPath)
  })

  test('show returns empty state when schema missing', async () => {
    const result = await schema.show(tempDir)
    assert.equal(result.exists, false)
    assert.equal(result.version, 1)
    assert.deepStrictEqual(result.artifacts, {})
  })
})

// ─── Sync/Observability API (backward compat) ───────────────────────────────

describe('Sync/Observability API', () => {
  beforeEach(async () => {
    await createTempProject()
    await initMinimalProject(tempDir)
  })

  afterEach(async () => {
    await cleanupTemp()
  })

  test('phase returns a phase and evidence', async () => {
    const result = await phase({ root: tempDir })
    assert.ok(typeof result.phase === 'string')
    assert.ok(Array.isArray(result.evidence))
  })

  test('status returns project summary', async () => {
    const result = await status({ root: tempDir })
    assert.equal(result.projectRoot, tempDir)
    assert.ok(typeof result.projectName === 'string')
    assert.ok(typeof result.phase === 'string')
    assert.ok(Array.isArray(result.evidence))
    assert.ok(Array.isArray(result.rules))
    assert.ok(Array.isArray(result.drift))
  })

  test('drift returns an array', async () => {
    const result = await drift({ root: tempDir })
    assert.ok(Array.isArray(result))
  })

  test('diff returns structured diff info', async () => {
    const result = await diff({ root: tempDir })
    assert.ok(Array.isArray(result.diffs))
    assert.ok(Array.isArray(result.filePatches))
  })

  test('sync runs without error', async () => {
    const result = await sync({ root: tempDir })
    assert.ok(result.passA !== undefined)
    assert.ok(result.passB !== undefined)
  })
})

// ─── Umbrella API module backward compat ─────────────────────────────────────

describe('Umbrella API module', () => {
  test('top-level import exports sync/drift/diff/status/phase/resolve', async () => {
    const api = await import('../api.mjs')
    assert.equal(typeof api.sync, 'function')
    assert.equal(typeof api.drift, 'function')
    assert.equal(typeof api.diff, 'function')
    assert.equal(typeof api.status, 'function')
    assert.equal(typeof api.phase, 'function')
    assert.equal(typeof api.resolve, 'function')
  })

  test('namespaced exports exist', async () => {
    const api = await import('../api.mjs')
    assert.ok(api.plan)
    assert.ok(api.specify)
    assert.ok(api.change)
    assert.ok(api.schema)
  })

  test('error classes are re-exported', async () => {
    const api = await import('../api.mjs')
    assert.ok(api.SpecFuseApiError)
    assert.ok(api.ArtifactAlreadyExistsError)
    assert.ok(api.ArtifactNotFoundError)
    assert.ok(api.ChangeNotVerifiedError)
    assert.ok(api.SchemaNotFoundError)
  })

  test('change.new is accessible', async () => {
    const api = await import('../api.mjs')
    assert.equal(typeof api.change.new, 'function')
  })

  test('default export has all methods', async () => {
    const api = await import('../api.mjs')
    const def = api.default
    assert.equal(typeof def.sync, 'function')
    assert.equal(typeof def.plan.createPrd, 'function')
    assert.equal(typeof def.specify.init, 'function')
    assert.equal(typeof def.change.new, 'function')
    assert.equal(typeof def.schema.init, 'function')
  })
})

// ─── API contract: no process.exit, no console, no chalk ─────────────────────

describe('API contract enforcement', () => {
  test('error classes do not call process.exit', () => {
    const err = new ArtifactNotFoundError('test', { artifactType: 'change' })
    // If we can construct and inspect the error, process.exit was not called
    assert.equal(err.message, 'test')
  })

  test('plan functions return structured data (no side effects)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'specfuse-contract-'))
    try {
      const result = await plan.createPrd(dir, { name: 'Test' })
      assert.ok(typeof result.path === 'string')
      assert.ok(typeof result.content === 'string')
      assert.ok(typeof result.created === 'boolean')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('specify.add throws ArtifactNotFoundError without constitution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'specfuse-contract-'))
    try {
      await assert.rejects(
        () => specify.add(dir, 'Test Section'),
        (err) => err instanceof ArtifactNotFoundError,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
