/**
 * Tests for bundle export/import functionality.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, symlink } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { tmpdir } from 'os'
import { existsSync, createWriteStream as createWriteStreamRaw } from 'fs'
import archiver from 'archiver'

import { Registry } from '../core/registry.js'
import {
  createBundle,
  createFullBundle,
  inspectBundle,
  importBundle,
  resolveSafeExtractionPath,
  _mergeConstitution,
  _parseSections,
  BundleError,
  BundleVersionMismatchError,
  BundleValidationError,
  ConstitutionConflictError,
  BUNDLE_VERSION,
  BUNDLE_MANIFEST,
} from '../core/bundle.js'
import { SpecFuseApiError } from '../api/errors.mjs'

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

// ─── Path containment (zip-slip fix) ───────────────────────────────────────

/**
 * Build a bundle zip from an explicit list of entries. Each entry is
 * `{ name, content }` (a file) or `{ name, dir: true }` (a directory).
 * Allows arbitrary entry names — including `../` traversal and absolute
 * paths — so malicious fixtures can be constructed for containment tests.
 *
 * @param {string} outputPath - Where to write the zip.
 * @param {Array<{ name: string, content?: string, dir?: boolean }>} entries
 * @returns {Promise<string>} outputPath
 */
async function buildRawBundle(outputPath, entries) {
  await mkdir(dirname(outputPath), { recursive: true })
  return new Promise((resolve, reject) => {
    const output = createWriteStreamRaw(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve(outputPath))
    archive.on('error', (err) => reject(err))
    archive.pipe(output)

    // Manifest first so the bundle passes inspectBundle's version checks.
    const manifest = {
      specfuseVersion: '4.0.0',
      bundleVersion: BUNDLE_VERSION,
      exportedAt: '2026-01-01T00:00:00.000Z',
      projectName: 'MaliciousFixture',
      mode: 'default',
      contents: { changes: null },
      fileCount: entries.length,
    }
    archive.append(JSON.stringify(manifest, null, 2) + '\n', { name: BUNDLE_MANIFEST })

    for (const entry of entries) {
      if (entry.dir) {
        archive.append('', { name: entry.name.endsWith('/') ? entry.name : `${entry.name}/` })
      } else {
        archive.append(entry.content ?? '', { name: entry.name })
      }
    }

    archive.finalize()
  })
}

describe('resolveSafeExtractionPath (containment primitive)', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-containment-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns a resolved path inside the root for a well-formed entry', async () => {
    const safe = await resolveSafeExtractionPath(root, '.specfuse/changes/add-login/proposal.md')
    assert.equal(safe, join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'))
  })

  test('rejects a `..` traversal entry', async () => {
    const entryName = '.specfuse/../../etc/evil.txt'
    await assert.rejects(
      async () => resolveSafeExtractionPath(root, entryName),
      (err) => err instanceof BundleValidationError &&
        err.entryName === entryName &&
        typeof err.escapedTarget === 'string',
    )
  })

  test('rejects an absolute path entry', async () => {
    const entryName = '/etc/passwd'
    await assert.rejects(
      async () => resolveSafeExtractionPath(root, entryName),
      { name: 'BundleValidationError' },
    )
  })

  test('rejects a symlinked intermediate directory that escapes the root', async () => {
    // Create `.specfuse/legit` as a symlink to root's parent, so an entry
    // crossing it resolves outside the root.
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await symlink(join(root, '..'), join(root, '.specfuse', 'legit'), 'dir')
    await assert.rejects(
      async () => resolveSafeExtractionPath(root, '.specfuse/legit/secret.txt'),
      { name: 'BundleValidationError' },
    )
  })

  test('rejects a leaf symlink pointing outside the root', async () => {
    // `.specfuse/target` is a symlink to a file outside the root. The leaf
    // name is inside the root, but the write would follow the symlink out.
    await mkdir(join(root, '.specfuse'), { recursive: true })
    const outside = join(root, 'outside-canary.txt')
    await writeFile(outside, 'original')
    await symlink(outside, join(root, '.specfuse', 'target'), 'file')
    await assert.rejects(
      async () => resolveSafeExtractionPath(root, '.specfuse/target'),
      { name: 'BundleValidationError' },
    )
  })

  test('allows a well-formed nested entry under existing real directories', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    const safe = await resolveSafeExtractionPath(root, '.specfuse/changes/add-login/tasks.md')
    assert.ok(safe.startsWith(root))
    assert.ok(!safe.includes('..'))
  })
})

describe('importBundle path containment', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('rejects a `../` traversal entry and writes nothing outside the root', async () => {
    const bundle = await buildRawBundle(join(root, 'evil-traversal.zip'), [
      { name: '.specfuse/constitution.md', content: '# C\n' },
      { name: '.specfuse/../../evil-traversal-canary.txt', content: 'pwned' },
    ])

    const registry = new Registry(root)
    await registry.load()

    await assert.rejects(
      async () => importBundle(bundle, root, registry, { replace: true }),
      { name: 'BundleValidationError' },
    )

    // No file written above the project root.
    assert.ok(!existsSync(join(root, '..', 'evil-traversal-canary.txt')))
  })

  test('a yauzl-normalized absolute entry stays inside the root (no escape)', async () => {
    // yauzl strips a leading `/` from entry names, so `/etc/x` becomes
    // `etc/x` — a relative name that resolves inside the root. The containment
    // primitive's absolute-path rejection is exercised directly in the unit
    // tests above; here we confirm the end-to-end import never writes outside
    // the root for this normalized form.
    const bundle = await buildRawBundle(join(root, 'evil-absolute.zip'), [
      { name: '/etc/specfuse-absolute-canary.txt', content: 'pwned' },
    ])

    const registry = new Registry(root)
    await registry.load()

    // Import succeeds (the name is relative after yauzl normalization) but the
    // file MUST land under root, never at /etc/...
    await importBundle(bundle, root, registry, { replace: true })
    assert.ok(!existsSync('/etc/specfuse-absolute-canary.txt'))
    assert.ok(existsSync(join(root, 'etc', 'specfuse-absolute-canary.txt')))

    // Clean up the canary written under root so it doesn't leak between tests.
    await rm(join(root, 'etc'), { recursive: true, force: true })
  })

  test('on rejection, registry is byte-identical and no import history event is added', async () => {
    // Seed a clean registry and snapshot it.
    const registry = new Registry(root)
    await registry.load()
    await registry.save()
    const registryPath = join(root, '.specfuse', 'registry.json')
    const before = await readFile(registryPath, 'utf8')
    const historyBefore = registry.getHistory({ type: 'import' }).length

    const bundle = await buildRawBundle(join(root, 'evil.zip'), [
      { name: '.specfuse/../../evil-canary.txt', content: 'pwned' },
    ])

    await assert.rejects(
      async () => importBundle(bundle, root, registry, { replace: true }),
      { name: 'BundleValidationError' },
    )

    // Registry file unchanged on disk.
    const after = await readFile(registryPath, 'utf8')
    assert.equal(after, before)

    // No new import history event recorded in-memory.
    assert.equal(registry.getHistory({ type: 'import' }).length, historyBefore)
  })

  test('rejects a symlinked-intermediate-directory escape', async () => {
    // Pre-create `.specfuse/legit` as a symlink to the root's parent.
    await symlink(join(root, '..'), join(root, '.specfuse', 'legit'), 'dir')

    const bundle = await buildRawBundle(join(root, 'evil-symlink.zip'), [
      { name: '.specfuse/legit/escape-canary.txt', content: 'pwned' },
    ])

    const registry = new Registry(root)
    await registry.load()

    await assert.rejects(
      async () => importBundle(bundle, root, registry, { replace: true }),
      { name: 'BundleValidationError' },
    )

    assert.ok(!existsSync(join(root, '..', 'escape-canary.txt')))
  })

  test('rejects a `--rename` import whose renamed entry escapes', async () => {
    // A pre-existing change name collides, triggering the rename strategy.
    // The entry carries a `..` in a segment outside the change-name segment,
    // which survives String.prototype.replace — re-validation must catch it.
    await makeChange(root, 'add-login')

    const bundle = await buildRawBundle(join(root, 'evil-rename.zip'), [
      // `../` is outside the change-name segment ("add-login"); replace() keeps it.
      { name: '.specfuse/changes/add-login/../../evil-rename-canary.txt', content: 'pwned' },
    ])

    const registry = new Registry(root)
    await registry.load()

    await assert.rejects(
      async () => importBundle(bundle, root, registry, { replace: true, conflict: 'rename' }),
      { name: 'BundleValidationError' },
    )

    assert.ok(!existsSync(join(root, '..', 'evil-rename-canary.txt')))
  })

  test('well-formed bundle import is unaffected (regression)', async () => {
    // Build a normal bundle via the real export path and import it.
    const sourceRoot = await makeFixture()
    try {
      await makeChange(sourceRoot, 'source-change')
      const sourceRegistry = new Registry(sourceRoot)
      await sourceRegistry.load()
      const { output } = await createBundle(sourceRoot, sourceRegistry, { output: join(sourceRoot, 'b.zip') })

      const registry = new Registry(root)
      await registry.load()
      const result = await importBundle(output, root, registry, { replace: true })

      assert.ok(result.imported.some(f => f.includes('constitution.md')))
      assert.ok(result.imported.some(f => f.includes('source-change')))
    } finally {
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  test('API importBundle throws instanceof BundleValidationError transitively', async () => {
    const bundle = await buildRawBundle(join(root, 'evil-instanceof.zip'), [
      { name: '.specfuse/../../evil-instanceof-canary.txt', content: 'pwned' },
    ])

    const { importBundle: apiImportBundle } = await import('../api/bundle.mjs')
    await assert.rejects(
      async () => apiImportBundle(root, bundle, { replace: true }),
      (err) => err instanceof BundleValidationError &&
        err instanceof BundleError &&
        err instanceof SpecFuseApiError,
    )
  })
})
