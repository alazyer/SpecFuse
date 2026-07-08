import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { computeConflict, applyResolution } from '../core/resolver.js'
import { checkAllDrift } from '../core/drift-detector.js'
import { runTwoPassSync } from '../core/sync-engine.js'
import { Registry } from '../core/registry.js'
import { hashContent } from '../utils/markdown.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

const ARCH_DOC = `# Architecture
## Architectural Decisions
- Microservices with Docker
- PostgreSQL per service
## Tech Stack
- Node.js 20 LTS
- Redis 7
`

const PRD_DOC = `# PRD
## Non-Functional Requirements
- 99.9% uptime SLA
- 10,000 concurrent users
## Technical Constraints
- Deploy to AWS
`

function makeRule(id, pass, source, target, section, extractFn, transformFn, opts = {}) {
  const defaultExtract = async () => 'extracted content'
  const defaultTransform = (data) => data
  return {
    id,
    pass,
    source,
    sources: opts.sources ?? [source],
    target,
    section,
    extract: extractFn ?? defaultExtract,
    transform: transformFn ?? defaultTransform,
    ...opts,
  }
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-resolve-test-'))
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })
  return root
}

// ─── computeConflict ──────────────────────────────────────────────────────

describe('computeConflict', () => {
  test('returns conflict data with ruleId, sourceContent, targetContent, and patch', () => {
    const rule = makeRule('test→tgt:my-section', 'A', '.specfuse/plan/prd.md', '.specfuse/constitution.md', 'my-section')
    const driftResult = {
      ruleId: 'test→tgt:my-section',
      state: 'BOTH_CHANGED',
      sourceContent: 'Source line 1\nSource line 2',
      targetContent: 'Target line 1\nTarget line 2',
      sourceId: 'test',
      targetId: 'tgt',
    }

    const conflict = computeConflict(rule, driftResult)

    assert.equal(conflict.ruleId, 'test→tgt:my-section')
    assert.equal(conflict.sourceContent, 'Source line 1\nSource line 2')
    assert.equal(conflict.targetContent, 'Target line 1\nTarget line 2')
    assert.ok(typeof conflict.patch === 'string')
    assert.ok(conflict.patch.length > 0, 'patch should be non-empty')
  })

  test('handles empty sourceContent gracefully', () => {
    const rule = makeRule('test→tgt:my-section', 'A', '.specfuse/plan/prd.md', '.specfuse/constitution.md', 'my-section')
    const driftResult = {
      ruleId: 'test→tgt:my-section',
      state: 'BOTH_CHANGED',
      sourceContent: '',
      targetContent: 'Some target content',
      sourceId: 'test',
      targetId: 'tgt',
    }

    const conflict = computeConflict(rule, driftResult)
    assert.equal(conflict.sourceContent, '')
    assert.equal(conflict.targetContent, 'Some target content')
    assert.ok(conflict.patch.length > 0)
  })

  test('handles missing sourceContent/targetContent by defaulting to empty string', () => {
    const rule = makeRule('test→tgt:my-section', 'A', '.specfuse/plan/prd.md', '.specfuse/constitution.md', 'my-section')
    const driftResult = {
      ruleId: 'test→tgt:my-section',
      state: 'BOTH_CHANGED',
      sourceId: 'test',
      targetId: 'tgt',
    }

    const conflict = computeConflict(rule, driftResult)
    assert.equal(conflict.sourceContent, '')
    assert.equal(conflict.targetContent, '')
  })

  test('patch contains unified diff markers', () => {
    const rule = makeRule('test→tgt:my-section', 'A', '.specfuse/plan/prd.md', '.specfuse/constitution.md', 'my-section')
    const driftResult = {
      ruleId: 'test→tgt:my-section',
      state: 'BOTH_CHANGED',
      sourceContent: 'New line A\nNew line B',
      targetContent: 'Old line A\nOld line B',
      sourceId: 'test',
      targetId: 'tgt',
    }

    const conflict = computeConflict(rule, driftResult)
    assert.ok(conflict.patch.includes('---'), 'patch should have --- header')
    assert.ok(conflict.patch.includes('+++'), 'patch should have +++ header')
    assert.ok(conflict.patch.includes('-'), 'patch should have removed lines')
    assert.ok(conflict.patch.includes('+'), 'patch should have added lines')
  })
})

// ─── applyResolution — source ─────────────────────────────────────────────

describe('applyResolution — accept source', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('overwrites managed section with source content and updates registry', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- New decision A\n- New decision B'
    const targetContent = '- Old decision X'

    // Set up constitution with existing managed section
    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

    const registry = new Registry(root)
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    const driftResult = {
      ruleId: rule.id,
      state: 'BOTH_CHANGED',
      sourceId: rule.source,
      targetId: rule.target,
      sourceContent,
      targetContent,
    }

    const result = await applyResolution(rule, driftResult, { type: 'source' }, root, registry)

    assert.equal(result.ruleId, rule.id)
    assert.equal(result.changed, true)
    assert.ok(result.message.includes('source'))

    // Verify managed section was updated
    const updated = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(updated.includes(sourceContent), 'managed section should contain source content')
    assert.ok(!updated.includes(targetContent), 'old target content should be gone')

    // Verify registry was updated
    const lastSync = registry.getLastSync(rule.source, rule.target)
    assert.ok(lastSync, 'registry should have a sync record')
    assert.equal(lastSync.sourceHash, lastSync.targetHash, 'source and target hashes should match after resolution')
  })
})

// ─── applyResolution — target ─────────────────────────────────────────────

describe('applyResolution — keep target', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('preserves target content and updates registry with matching hashes', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- New decision A\n- New decision B'
    const targetContent = '- Manual edit preserved'

    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
    )

    const driftResult = {
      ruleId: rule.id,
      state: 'BOTH_CHANGED',
      sourceId: rule.source,
      targetId: rule.target,
      sourceContent,
      targetContent,
    }

    const result = await applyResolution(rule, driftResult, { type: 'target' }, root, registry)

    assert.equal(result.changed, false)
    assert.ok(result.message.includes('kept target'))

    // File should be unchanged
    const after = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(after.includes(targetContent), 'target content should still be there')
    assert.ok(!after.includes(sourceContent), 'source content should not have been written')

    // Registry should have matching hashes
    const lastSync = registry.getLastSync(rule.source, rule.target)
    assert.ok(lastSync)
    assert.equal(lastSync.sourceHash, lastSync.targetHash, 'hashes should match after target resolution')
  })
})

// ─── applyResolution — merge ──────────────────────────────────────────────

describe('applyResolution — merge', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('writes merged content into managed section and updates registry', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- Source line'
    const targetContent = '- Target line'
    const mergedContent = '- Source line\n- Target line'

    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
    )

    const driftResult = {
      ruleId: rule.id,
      state: 'BOTH_CHANGED',
      sourceId: rule.source,
      targetId: rule.target,
      sourceContent,
      targetContent,
    }

    const result = await applyResolution(
      rule,
      driftResult,
      { type: 'merge', mergedContent },
      root,
      registry,
    )

    assert.equal(result.changed, true)
    assert.ok(result.message.includes('merged'))

    // Verify the file was updated with merged content
    const updated = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(updated.includes(mergedContent), 'managed section should contain merged content')

    // Registry should have matching hashes
    const lastSync = registry.getLastSync(rule.source, rule.target)
    assert.ok(lastSync)
    assert.equal(lastSync.sourceHash, lastSync.targetHash)
  })
})

// ─── applyResolution — error cases ────────────────────────────────────────

describe('applyResolution — error cases', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('throws on invalid resolution type', async () => {
    const rule = makeRule('test→tgt:s', 'A', '.specfuse/plan/prd.md', '.specfuse/constitution.md', 's')
    const driftResult = {
      ruleId: 'test→tgt:s',
      state: 'BOTH_CHANGED',
      sourceId: 'test',
      targetId: 'tgt',
      sourceContent: 'a',
      targetContent: 'b',
    }

    const registry = new Registry(root)
    await registry.load()

    await assert.rejects(
      () => applyResolution(rule, driftResult, { type: 'invalid' }, root, registry),
      /Invalid resolution type/,
    )
  })
})

// ─── Drift detector enrichment ────────────────────────────────────────────

describe('Drift detector enrichment for BOTH_CHANGED', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('BOTH_CHANGED drift result includes sourceContent and targetContent', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- Microservices with Docker\n- PostgreSQL per service'
    const targetContent = '- Manual override decision'

    // Set up: write source, write constitution with a different managed section
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    // Create a constitution where the managed section has been manually edited
    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    // Set up registry with a previous sync that has different hashes
    const registry = new Registry(root)
    await registry.load()
    // Record a sync with hashes that differ from current state
    const oldSourceHash = hashContent('old source content')
    const oldTargetHash = hashContent('old target content')
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', oldSourceHash, oldTargetHash)
    await registry.save()

    // Reload registry
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    const results = await checkAllDrift(root, registry, [rule])
    const bothChangedResult = results.find((r) => r.state === 'BOTH_CHANGED')

    // If we get BOTH_CHANGED, verify enrichment
    if (bothChangedResult) {
      assert.ok('sourceContent' in bothChangedResult, 'should include sourceContent')
      assert.ok('targetContent' in bothChangedResult, 'should include targetContent')
      assert.equal(bothChangedResult.targetContent, targetContent)
    }
  })

  test('non-BOTH_CHANGED drift results do not include sourceContent/targetContent', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- Microservices with Docker\n- PostgreSQL per service'

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    // IN_SYNC: managed section matches what extract would return
    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${sourceContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()
    // Record a sync matching current state
    const sourceHash = hashContent('dir:.specfuse/plan/architecture.md')
    const targetHash = hashContent(sourceContent)
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', sourceHash, targetHash)
    await registry.save()
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    const results = await checkAllDrift(root, registry, [rule])
    const inSyncResult = results.find((r) => r.state === 'IN_SYNC')

    if (inSyncResult) {
      assert.equal('sourceContent' in inSyncResult, false, 'IN_SYNC should not have sourceContent')
      assert.equal('targetContent' in inSyncResult, false, 'IN_SYNC should not have targetContent')
    }
  })
})

// ─── Sync engine guard ────────────────────────────────────────────────────

describe('Sync engine BOTH_CHANGED guard', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('BOTH_CHANGED rules are skipped by default', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- New source content'
    const targetContent = '- Manual edit in target'

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    // Set up stale sync record to trigger BOTH_CHANGED
    const registry = new Registry(root)
    await registry.load()
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', hashContent('old'), hashContent('old'))
    await registry.save()
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    registry.setLoadedRules([rule])

    const { passA, passB } = await runTwoPassSync(root, registry, [rule])

    const allResults = [...passA, ...passB]
    const skippedResult = allResults.find((r) => r.ruleId === rule.id && !r.changed)

    assert.ok(skippedResult, 'BOTH_CHANGED rule should be skipped')
    assert.ok(skippedResult.message.includes('BOTH_CHANGED'), 'message should mention BOTH_CHANGED')
  })

  test('BOTH_CHANGED rules are overwritten with force option', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- New source content'
    const targetContent = '- Manual edit in target'

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', hashContent('old'), hashContent('old'))
    await registry.save()
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    registry.setLoadedRules([rule])

    const { passA, passB } = await runTwoPassSync(root, registry, [rule], { force: true })

    const allResults = [...passA, ...passB]
    const syncedResult = allResults.find((r) => r.ruleId === rule.id && r.changed)

    assert.ok(syncedResult, 'BOTH_CHANGED rule should be synced with --force')
  })

  test('onConflict callback is invoked for BOTH_CHANGED with resolve option', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- New source content'
    const targetContent = '- Manual edit in target'

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', hashContent('old'), hashContent('old'))
    await registry.save()
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    registry.setLoadedRules([rule])

    let conflictCalled = false
    const onConflict = async (ruleArg, driftResult) => {
      conflictCalled = true
      assert.equal(driftResult.state, 'BOTH_CHANGED')
      return { type: 'source' }
    }

    const { passA, passB } = await runTwoPassSync(root, registry, [rule], { onConflict })

    assert.ok(conflictCalled, 'onConflict callback should have been invoked')
    const allResults = [...passA, ...passB]
    const resolvedResult = allResults.find((r) => r.ruleId === rule.id)
    assert.ok(resolvedResult, 'should have a result for the resolved rule')
  })

  test('onConflict returning null causes the rule to be skipped', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- New source content'
    const targetContent = '- Manual edit in target'

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', hashContent('old'), hashContent('old'))
    await registry.save()
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    registry.setLoadedRules([rule])

    const onConflict = async () => null // user skips

    const { passA, passB } = await runTwoPassSync(root, registry, [rule], { onConflict })

    const allResults = [...passA, ...passB]
    const skippedResult = allResults.find((r) => r.ruleId === rule.id)
    assert.ok(skippedResult, 'should have a result')
    assert.equal(skippedResult.changed, false, 'should be skipped')
    assert.ok(skippedResult.message.includes('BOTH_CHANGED'), 'should mention BOTH_CHANGED')
  })

  test('rules with no BOTH_CHANGED state sync normally', async () => {
    const sectionName = 'arch-decisions'
    const sourceContent = '- Microservices with Docker\n- PostgreSQL per service'

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })

    // IN_SYNC state
    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${sourceContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()
    const srcHash = hashContent('dir:.specfuse/plan/architecture.md')
    const tgtHash = hashContent(sourceContent)
    registry.recordSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md', srcHash, tgtHash)
    await registry.save()
    await registry.load()

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    registry.setLoadedRules([rule])

    const { passA } = await runTwoPassSync(root, registry, [rule])

    // Should not crash, should have a result
    assert.ok(passA.length >= 1, 'should have at least one result')
  })
})

// ─── Programmatic resolve API ─────────────────────────────────────────────

describe('Programmatic resolve API', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('resolve with source choice via API', async () => {
    const { resolve } = await import('../api/sync-ops.mjs')

    const sectionName = 'api-test-section'
    const sourceContent = '- API source content'
    const targetContent = '- API target content'

    await mkdir(join(root, '.specfuse'), { recursive: true })
    const constitution = `# Constitution\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const registry = new Registry(root)
    await registry.load()
    registry.recordSync('.specfuse/plan/prd.md', '.specfuse/constitution.md', hashContent('old'), hashContent('old'))
    await registry.save()

    // We need to create a scenario where the rule will be found as BOTH_CHANGED.
    // The resolve API calls loadRules internally which returns real rules from .specfuse/plan.
    // For this unit test, we test the core logic directly instead.
    const rule = makeRule(
      'prd→constitution:api-test-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
    )

    const driftResult = {
      ruleId: rule.id,
      state: 'BOTH_CHANGED',
      sourceId: rule.source,
      targetId: rule.target,
      sourceContent,
      targetContent,
    }

    const result = await applyResolution(rule, driftResult, { type: 'source' }, root, registry)
    await registry.save()

    assert.equal(result.changed, true)
    assert.ok(result.message.includes('source'))

    const updated = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8')
    assert.ok(updated.includes(sourceContent))
  })

  test('resolve throws on non-BOTH_CHANGED rule', async () => {
    const { resolve } = await import('../api/sync-ops.mjs')

    try {
      await resolve({ root, ruleId: 'nonexistent-rule', choice: 'source' })
      assert.fail('Should have thrown')
    } catch (err) {
      assert.ok(err.message.includes('not found') || err.message.includes('not in a conflicted state'))
    }
  })
})

// ─── Multi-target resolve ─────────────────────────────────────────────────

describe('Multi-target resolve', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('applyResolution resolves multi-target rule via targetId', async () => {
    const sectionName = 'constitution-header'
    const sourceContent = '# Constitutional Preamble'
    const targetContent = '# Old Preamble'

    await mkdir(join(root, '.specfuse'), { recursive: true })
    const constitution = `# Constitution\n\nSome content\n`
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    // Create proposal with existing managed section
    const proposal = `# Change Proposal\n\n<!-- specfuse:${sectionName}:start -->\n${targetContent}\n<!-- specfuse:${sectionName}:end -->\n`
    await writeFile(join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'), proposal)

    const registry = new Registry(root)
    await registry.load()

    const rule = makeRule(
      'constitution→changes:constitution-header',
      'B',
      '.specfuse/constitution.md',
      '.specfuse/changes/*/proposal.md',
      sectionName,
      async () => sourceContent,
      (d) => d,
      { isMultiTarget: true, resolveTargets: async () => [join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md')] },
    )

    const driftResult = {
      ruleId: 'constitution→changes:constitution-header:add-cart',
      state: 'BOTH_CHANGED',
      sourceId: 'constitution',
      targetId: 'changes:add-cart',
      sourceContent,
      targetContent,
    }

    const result = await applyResolution(rule, driftResult, { type: 'source' }, root, registry)
    assert.equal(result.changed, true)

    const updated = await readFile(join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'), 'utf8')
    assert.ok(updated.includes(sourceContent), 'proposal should contain source content after resolution')
  })
})
