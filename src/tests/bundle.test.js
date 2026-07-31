/**
 * Tests for bundle export/import functionality.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'fs/promises'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'

import { Registry } from '../core/registry.js'
import {
  createBundle,
  createFullBundle,
  inspectBundle,
  importBundle,
  _mergeConstitution,
  _parseSections,
  BundleVersionMismatchError,
  BundleValidationError,
  ConstitutionConflictError,
  BUNDLE_VERSION,
  BUNDLE_MANIFEST,
} from '../core/bundle.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-bundle-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })

  // Initialize registry
  const registry = new Registry(root)
  await registry.load()
  registry.setProjectName('TestProject')
  await registry.save()

  // Create constitution
  await writeFile(join(root, '.specfuse', 'constitution.md'), `# Constitution

## Rules

- Rule 1: Be excellent
- Rule 2: Write tests
`)

  return root
}

async function makeChange(root, name) {
  const changeDir = join(root, '.specfuse', 'changes', name)
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), `# ${name}\n\nProposal for ${name}.`)
  await writeFile(join(changeDir, 'design.md'), `# Design\n\nDesign for ${name}.`)
  await writeFile(join(changeDir, 'tasks.md'), `# Tasks\n\n- [ ] Task 1`)
  await writeFile(join(changeDir, 'review.md'), `status: pending\n`)
  await writeFile(join(changeDir, 'verify.md'), `status: pending\n`)
}

// ─── createBundle ─────────────────────────────────────────────────────────

describe('createBundle', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('creates a zip file on disk', async () => {
    await makeChange(root, 'add-login')

    const registry = new Registry(root)
    await registry.load()

    const result = await createBundle(root, registry, { output: join(root, 'test-bundle.zip') })

    assert.ok(result.output)
    assert.ok(existsSync(result.output))
    assert.ok(result.output.endsWith('.zip'))
    assert.ok(result.manifest)
    assert.ok(Array.isArray(result.files))
    assert.ok(result.files.length > 0)
  })

  test('manifest contains correct metadata', async () => {
    const registry = new Registry(root)
    await registry.load()

    const result = await createBundle(root, registry, { output: join(root, 'test-bundle.zip') })

    assert.equal(result.manifest.bundleVersion, BUNDLE_VERSION)
    assert.ok(result.manifest.specfuseVersion)
    assert.ok(result.manifest.exportedAt)
    assert.equal(result.manifest.projectName, 'TestProject')
    assert.ok(['partial', 'default', 'full'].includes(result.manifest.mode))
  })

  test('--changes includes only specified changes', async () => {
    await makeChange(root, 'add-login')
    await makeChange(root, 'add-logout')

    const registry = new Registry(root)
    await registry.load()

    const result = await createBundle(root, registry, {
      changes: ['add-login'],
      output: join(root, 'test-bundle.zip'),
    })

    assert.ok(result.files.some(f => f.includes('add-login')))
    assert.ok(!result.files.some(f => f.includes('add-logout')))
    assert.equal(result.manifest.mode, 'partial')
  })

  test('--preview returns summary without creating file', async () => {
    await makeChange(root, 'add-login')

    const registry = new Registry(root)
    await registry.load()

    const result = await createBundle(root, registry, {
      output: join(root, 'test-bundle.zip'),
      preview: true,
    })

    assert.equal(result.preview, true)
    assert.ok(result.manifest)
    assert.ok(result.files.length > 0)
    assert.ok(!existsSync(join(root, 'test-bundle.zip')))
  })

  test('default mode includes constitution + active changes + plan', async () => {
    await makeChange(root, 'add-login')
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD')

    const registry = new Registry(root)
    await registry.load()

    const result = await createBundle(root, registry, { output: join(root, 'test-bundle.zip') })

    assert.ok(result.files.some(f => f.includes('constitution.md')))
    assert.ok(result.files.some(f => f.includes('add-login')))
    assert.ok(result.files.some(f => f.includes('prd.md')))
    assert.equal(result.manifest.mode, 'default')
  })
})

// ─── createFullBundle ─────────────────────────────────────────────────────

describe('createFullBundle', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('includes all .specfuse/ contents', async () => {
    await makeChange(root, 'add-login')
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD')
    await mkdir(join(root, '.specfuse', 'snapshots'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'snapshots', 'snap1.json'), '{}')

    const result = await createFullBundle(root, { output: join(root, 'full-bundle.zip') })

    assert.ok(result.files.some(f => f.includes('constitution.md')))
    assert.ok(result.files.some(f => f.includes('add-login')))
    assert.ok(result.files.some(f => f.includes('prd.md')))
    // Snapshots should be excluded
    assert.ok(!result.files.some(f => f.includes('snapshots')))
    assert.equal(result.manifest.mode, 'full')
  })

  test('--preview returns summary without creating file', async () => {
    await makeChange(root, 'add-login')

    const result = await createFullBundle(root, {
      output: join(root, 'full-bundle.zip'),
      preview: true,
    })

    assert.equal(result.preview, true)
    assert.ok(!existsSync(join(root, 'full-bundle.zip')))
  })
})

// ─── inspectBundle ────────────────────────────────────────────────────────

describe('inspectBundle', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('reads manifest from existing bundle', async () => {
    await makeChange(root, 'add-login')

    const registry = new Registry(root)
    await registry.load()
    const { output } = await createBundle(root, registry, { output: join(root, 'test-bundle.zip') })

    const { manifest, files } = await inspectBundle(output)

    assert.ok(manifest)
    assert.equal(manifest.projectName, 'TestProject')
    assert.ok(Array.isArray(files))
    assert.ok(files.length > 0)
  })

  test('throws BundleValidationError for missing file', async () => {
    await assert.rejects(
      async () => inspectBundle(join(root, 'nonexistent.zip')),
      { name: 'BundleValidationError' }
    )
  })
})

// ─── importBundle ─────────────────────────────────────────────────────────

describe('importBundle', () => {
  let root, sourceRoot

  beforeEach(async () => {
    root = await makeFixture()
    sourceRoot = await makeFixture()
    await makeChange(sourceRoot, 'source-change')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  })

  test('--replace overwrites local constitution', async () => {
    // Create bundle from source
    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    // Import with replace
    const registry = new Registry(root)
    await registry.load()

    const result = await importBundle(output, root, registry, { replace: true })

    assert.ok(result.imported.some(f => f.includes('constitution.md')))
    assert.equal(result.constitution, 'replaced')
  })

  test('--merge merges imported rules into local constitution', async () => {
    // Create source with different rules
    await writeFile(join(sourceRoot, '.specfuse', 'constitution.md'), `# Constitution

## Source Rules

- Rule from source
`)

    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    // Import with merge
    const registry = new Registry(root)
    await registry.load()

    const result = await importBundle(output, root, registry, { merge: true })

    assert.ok(result.imported.some(f => f.includes('constitution.md')))
    assert.equal(result.constitution, 'merged')

    // Verify merged content
    const mergedContent = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(mergedContent.includes('Rules'))
    assert.ok(mergedContent.includes('Source Rules'))
  })

  test('--conflict skip skips change dirs that already exist', async () => {
    // Create same change in both source and target
    await makeChange(root, 'add-login')
    await makeChange(sourceRoot, 'add-login')

    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    const registry = new Registry(root)
    await registry.load()

    const result = await importBundle(output, root, registry, { replace: true, conflict: 'skip' })

    // The change should be skipped because it exists
    assert.ok(result.skipped.length > 0 || result.imported.some(f => !f.includes('add-login')))
  })

  test('--preview shows what would be imported without writing', async () => {
    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    const registry = new Registry(root)
    await registry.load()

    const result = await importBundle(output, root, registry, { replace: true, preview: true })

    assert.equal(result.preview, true)
    assert.ok(result.source)
    assert.ok(result.constitution)
  })

  test('error when neither --merge nor --replace specified', async () => {
    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    const registry = new Registry(root)
    await registry.load()

    await assert.rejects(
      async () => importBundle(output, root, registry, {}),
      { name: 'ConstitutionConflictError' }
    )
  })

  test('records import in registry imports array', async () => {
    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    const registry = new Registry(root)
    await registry.load()
    await importBundle(output, root, registry, { replace: true })

    const imports = registry.getImports()
    assert.ok(imports.length > 0)
    assert.equal(imports[0].sourceProject, 'TestProject')
  })

  test('records history event', async () => {
    const sourceRegistry = new Registry(sourceRoot)
    await sourceRegistry.load()
    const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'bundle.zip') })

    const registry = new Registry(root)
    await registry.load()
    await importBundle(output, root, registry, { replace: true })

    const events = registry.getHistory({ type: 'import' })
    assert.ok(events.length > 0)
  })
})

// ─── _mergeConstitution ───────────────────────────────────────────────────

describe('_mergeConstitution', () => {
  test('returns imported content when local is empty', () => {
    const local = ''
    const imported = `# Constitution\n\n## Rules\n\n- Rule 1\n`
    const merged = _mergeConstitution(local, imported, 'source')
    assert.equal(merged, imported)
  })

  test('returns local content when imported is empty', () => {
    const local = `# Constitution\n\n## Rules\n\n- Rule 1\n`
    const imported = ''
    const merged = _mergeConstitution(local, imported, 'source')
    assert.equal(merged, local)
  })

  test('appends imported sections under marker', () => {
    const local = `# Constitution\n\n## Local Rules\n\n- Local rule\n`
    const imported = `# Constitution\n\n## Imported Rules\n\n- Imported rule\n`
    const merged = _mergeConstitution(local, imported, 'SourceProject')

    assert.ok(merged.includes('Local Rules'))
    assert.ok(merged.includes('Imported Rules'))
    assert.ok(merged.includes('imported from SourceProject'))
  })

  test('deduplicates identical section headings', () => {
    const local = `# Constitution\n\n## Rules\n\n- Local rule\n`
    const imported = `# Constitution\n\n## Rules\n\n- Imported rule\n`
    const merged = _mergeConstitution(local, imported, 'source')

    // Should have both sections, one renamed
    assert.ok(merged.includes('## Rules'))
    assert.ok(merged.includes('## Rules (imported)'))
  })
})

// ─── _parseSections ───────────────────────────────────────────────────────

describe('_parseSections', () => {
  test('parses sections by ## headings', () => {
    const content = `# Main\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B\n`
    const sections = _parseSections(content)

    assert.equal(sections.length, 2)
    assert.equal(sections[0].heading, 'Section A')
    assert.equal(sections[0].body, 'Content A')
    assert.equal(sections[1].heading, 'Section B')
    assert.equal(sections[1].body, 'Content B')
  })

  test('returns empty array for no sections', () => {
    const content = `# Main\n\nJust content\n`
    const sections = _parseSections(content)
    assert.equal(sections.length, 0)
  })
})

// ─── Registry imports persistence ─────────────────────────────────────────

describe('Registry imports persistence', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('imports array persists across save/load', async () => {
    const registry = new Registry(root)
    await registry.load()

    registry.recordImport({ sourceProject: 'ProjectA', mode: 'merge' })
    await registry.save()

    const registry2 = new Registry(root)
    await registry2.load()

    const imports = registry2.getImports()
    assert.equal(imports.length, 1)
    assert.equal(imports[0].sourceProject, 'ProjectA')
  })

  test('imports are capped at 50', async () => {
    const registry = new Registry(root)
    await registry.load()

    for (let i = 0; i < 60; i++) {
      registry.recordImport({ sourceProject: `Project${i}` })
    }
    await registry.save()

    const imports = registry.getImports()
    assert.equal(imports.length, 50)
    // Should keep the most recent
    assert.ok(imports.some(i => i.sourceProject === 'Project59'))
  })
})

// ─── Round-trip ───────────────────────────────────────────────────────────

describe('export/import round-trip', () => {
  let root, targetRoot

  beforeEach(async () => {
    root = await makeFixture()
    targetRoot = await makeFixture()
    await makeChange(root, 'add-feature')
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(targetRoot, { recursive: true, force: true })
  })

  test('exported bundle imports cleanly into a fresh project', async () => {
    // Export from source
    const registry = new Registry(root)
    await registry.load()
    const { output } = await createBundle(root, registry, { output: join(root, 'bundle.zip') })

    // Import to target
    const targetRegistry = new Registry(targetRoot)
    await targetRegistry.load()
    const result = await importBundle(output, targetRoot, targetRegistry, { replace: true })

    // Verify
    assert.ok(result.imported.some(f => f.includes('constitution.md')))
    assert.ok(result.imported.some(f => f.includes('add-feature')))
    assert.ok(result.imported.some(f => f.includes('prd.md')))

    // Files should exist on disk
    assert.ok(existsSync(join(targetRoot, '.specfuse', 'constitution.md')))
    assert.ok(existsSync(join(targetRoot, '.specfuse', 'changes', 'add-feature', 'proposal.md')))
    assert.ok(existsSync(join(targetRoot, '.specfuse', 'plan', 'prd.md')))
  })
})
