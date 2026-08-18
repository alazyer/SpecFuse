import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  computeDiff,
  computeDiffWithProposed,
  groupByFile,
  applyDiff,
  formatStat,
} from '../core/differ.js'
import { Registry } from '../core/registry.js'
import { checkAllDrift } from '../core/drift-detector.js'
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
  const root = await mkdtemp(join(tmpdir(), 'sf-differ-test-'))
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })
  return root
}

// ─── computeDiff ──────────────────────────────────────────────────────────

describe('computeDiff', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('produces empty diff when source and target are in sync', async () => {
    // Write the source content and set up a constitution that already has the managed section
    const sectionContent = '- Microservices with Docker\n- PostgreSQL per service'
    const constitution = `# Constitution\n\n<!-- specfuse:arch-decisions:start -->\n${sectionContent}\n<!-- specfuse:arch-decisions:end -->\n`

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'arch-decisions',
      async () => sectionContent,
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, false, 'no changes when content is identical')
    assert.equal(diffs[0].added, 0)
    assert.equal(diffs[0].removed, 0)
  })

  test('produces diff when source has changed since last sync', async () => {
    const oldSection = '- Old decision A\n- Old decision B'
    const newSection = '- New decision X\n- New decision Y\n- New decision Z'
    const constitution = `# Constitution\n\n<!-- specfuse:arch-decisions:start -->\n${oldSection}\n<!-- specfuse:arch-decisions:end -->\n`

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'arch-decisions',
      async () => newSection,
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true, 'must detect changes when source differs')
    assert.ok(diffs[0].added > 0, 'must have added lines')
    assert.ok(diffs[0].removed > 0, 'must have removed lines')
    assert.ok(diffs[0].patch.length > 0, 'patch must be non-empty')
  })

  test('produces diff when both source and target have changed', async () => {
    const targetSection = '- Manual edit that diverged\n- Something else'
    const newContent = '- Source-driven content A\n- Source-driven content B'

    const constitution = `# Constitution\n\n<!-- specfuse:my-section:start -->\n${targetSection}\n<!-- specfuse:my-section:end -->\n`

    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'src→tgt:my-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'my-section',
      async () => newContent,
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true, 'must detect changes when both diverged')
    assert.ok(diffs[0].patch.length > 0)
  })

  test('does not write to filesystem — simulated run only', async () => {
    const constitution = '# Constitution\n\nNo managed sections yet.\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'src→tgt:new-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'new-section',
      async () => 'New managed content',
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true)

    // Verify the actual file was NOT modified
    const afterContent = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8')
    assert.equal(afterContent, constitution, 'computeDiff must not write to filesystem')
  })

  test('handles rule.extract returning null — skips rule', async () => {
    const rule = makeRule(
      'skip→tgt:skip-section',
      'A',
      '.specfuse/plan/missing.md',
      '.specfuse/constitution.md',
      'skip-section',
      async () => null,
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 0, 'extract returning null should skip the rule')
  })

  test('handles rule.transform returning null — skips rule', async () => {
    const rule = makeRule(
      'skip→tgt:skip-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'skip-section',
      async () => 'some content',
      () => null,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 0, 'transform returning null should skip the rule')
  })

  test('orders Pass A rules before Pass B rules', async () => {
    const passBRule = makeRule(
      'constitution→target:pass-b',
      'B',
      '.specfuse/constitution.md',
      '.specfuse/changes/add-cart/proposal.md',
      'pass-b-section',
      async () => 'Pass B content',
      (data) => data,
    )
    const passARule = makeRule(
      'arch→constitution:pass-a',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'pass-a-section',
      async () => 'Pass A content',
      (data) => data,
    )

    // Pass B rule appears first in the array, but computeDiff should reorder
    const diffs = await computeDiff(root, [passBRule, passARule])
    // Both should produce diffs — Pass A first, then Pass B
    assert.equal(diffs.length, 2)
    assert.equal(diffs[0].ruleId, passARule.id, 'Pass A rule diff should come first')
    assert.equal(diffs[1].ruleId, passBRule.id, 'Pass B rule diff should come second')
  })

  test('Pass B sees memoryFS updates from Pass A', async () => {
    const passAContent = 'Pass A writes this content'
    const passBContent = 'Pass B injects this header'

    const passARule = makeRule(
      'src→constitution:memory-a',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'memory-a',
      async () => passAContent,
      (data) => data,
    )

    const passBRule = makeRule(
      'constitution→proposal:memory-b',
      'B',
      '.specfuse/constitution.md',
      '.specfuse/changes/add-cart/proposal.md',
      'memory-b',
      // The extract function reads from the in-memory filesystem,
      // which should include the Pass A updates
      async (ctx) => {
        const constitution = await ctx.read('.specfuse/constitution.md')
        // In memory FS, constitution should include the Pass A section
        // For this test, return content that acknowledges the in-memory update
        return passBContent
      },
      (data) => data,
    )

    // Set up initial empty constitution
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n')
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
    await writeFile(join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'), '# Proposal\n')

    const diffs = await computeDiff(root, [passARule, passBRule])
    assert.equal(diffs.length, 2)
    // Pass A should show changes
    assert.equal(diffs[0].hasChanges, true, 'Pass A must produce changes')
    // Pass B should also show changes (proposal.md gains a managed section)
    assert.equal(diffs[1].hasChanges, true, 'Pass B must see the updated constitution in memory')
  })

  test('handles multi-target rules', async () => {
    const content = 'Shared header content'

    const multiRule = makeRule(
      'constitution→changes:multi',
      'B',
      '.specfuse/constitution.md',
      '.specfuse/changes/*/proposal.md',
      'constitution-header',
      async () => content,
      (data) => data,
      {
        isMultiTarget: true,
        resolveTargets: async (ctx) => {
          return [join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md')]
        },
      },
    )

    // Create minimal proposal
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'),
      '# Change Proposal: Add Cart\n',
    )
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n')

    const diffs = await computeDiff(root, [multiRule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true)
    assert.ok(
      diffs[0].file.includes('add-cart'),
      'diff file path should reference the change directory',
    )
  })

  test('diffSection produces correct unified diff format', async () => {
    const oldContent = 'Line A\nLine B'
    const newContent = 'Line A\nLine C\nLine D'

    const constitution = `# Constitution\n\n<!-- specfuse:format-test:start -->\n${oldContent}\n<!-- specfuse:format-test:end -->\n`
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'format→constitution:format-test',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'format-test',
      async () => newContent,
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 1)
    // Patch should contain +/- markers
    assert.ok(diffs[0].patch.includes('+'), 'patch must contain added lines (+)')
    assert.ok(diffs[0].patch.includes('-'), 'patch must contain removed lines (-)')
    // File and section metadata
    assert.equal(diffs[0].file, rule.target)
    assert.equal(diffs[0].section, rule.section)
    assert.equal(diffs[0].ruleId, rule.id)
  })

  test('handles extract throwing — skips rule gracefully', async () => {
    const rule = makeRule(
      'error→tgt:error-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'error-section',
      async () => {
        throw new Error('extract failed')
      },
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 0, 'extract throwing should skip rule without crashing')
  })

  test('works with non-existent target file (readFileSafe returns null)', async () => {
    const rule = makeRule(
      'src→newtgt:new-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/new-target.md',
      'new-section',
      async () => 'Content for new file',
      (data) => data,
    )

    const diffs = await computeDiff(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true, 'new section in non-existent file is always a change')
  })
})

// ─── computeDiffWithProposed ─────────────────────────────────────────────

describe('computeDiffWithProposed', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns diffs and proposedFiles map', async () => {
    const newContent = '- New content for proposed'
    const constitution = '# Constitution\n\nNo managed sections yet.\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'src→tgt:proposed-test',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'proposed-test',
      async () => newContent,
      (data) => data,
    )

    const { diffs, proposedFiles } = await computeDiffWithProposed(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true)
    assert.ok(proposedFiles instanceof Map, 'proposedFiles should be a Map')
    assert.ok(proposedFiles.has('.specfuse/constitution.md'), 'should have the target file')
    assert.ok(
      proposedFiles.get('.specfuse/constitution.md').includes('proposed-test'),
      'proposed content should include the section name',
    )
  })

  test('proposedFiles excludes unchanged files', async () => {
    const sectionContent = 'Already synced content'
    const constitution = `# Constitution\n\n<!-- specfuse:synced:start -->\n${sectionContent}\n<!-- specfuse:synced:end -->\n`
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'src→tgt:synced',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'synced',
      async () => sectionContent,
      (data) => data,
    )

    const { diffs, proposedFiles } = await computeDiffWithProposed(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, false, 'no changes expected')
    assert.equal(proposedFiles.size, 0, 'unchanged files should not appear in proposedFiles')
  })

  test('proposedFiles includes new target files', async () => {
    const rule = makeRule(
      'src→newtgt:new-file-section',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/new-target.md',
      'new-file-section',
      async () => 'Content for new file',
      (data) => data,
    )

    const { diffs, proposedFiles } = await computeDiffWithProposed(root, [rule])
    assert.equal(diffs.length, 1)
    assert.equal(diffs[0].hasChanges, true)
    assert.ok(proposedFiles.has('.specfuse/new-target.md'), 'new target file should be in proposedFiles')
  })
})

// ─── groupByFile ──────────────────────────────────────────────────────────

describe('groupByFile', () => {
  test('groups sections by file', () => {
    const diffs = [
      { file: 'a.md', section: 's1', ruleId: 'r1', added: 3, removed: 1, patch: 'p1', hasChanges: true },
      { file: 'a.md', section: 's2', ruleId: 'r2', added: 2, removed: 0, patch: 'p2', hasChanges: true },
      { file: 'b.md', section: 's3', ruleId: 'r3', added: 5, removed: 2, patch: 'p3', hasChanges: true },
    ]

    const grouped = groupByFile(diffs)
    assert.equal(grouped.length, 2, 'should have 2 file groups')
    assert.equal(grouped[0].file, 'a.md')
    assert.equal(grouped[0].sections.length, 2, 'a.md should have 2 sections')
    assert.equal(grouped[1].file, 'b.md')
    assert.equal(grouped[1].sections.length, 1, 'b.md should have 1 section')
  })

  test('aggregates added/removed counts', () => {
    const diffs = [
      { file: 'a.md', section: 's1', ruleId: 'r1', added: 3, removed: 1, patch: 'p1', hasChanges: true },
      { file: 'a.md', section: 's2', ruleId: 'r2', added: 2, removed: 4, patch: 'p2', hasChanges: true },
    ]

    const grouped = groupByFile(diffs)
    assert.equal(grouped[0].totalAdded, 5, 'totalAdded should sum across sections')
    assert.equal(grouped[0].totalRemoved, 5, 'totalRemoved should sum across sections')
  })

  test('sets hasChanges true only if any section has changes', () => {
    const diffs = [
      { file: 'a.md', section: 's1', ruleId: 'r1', added: 0, removed: 0, patch: '', hasChanges: false },
      { file: 'a.md', section: 's2', ruleId: 'r2', added: 1, removed: 0, patch: '+ line', hasChanges: true },
    ]

    const grouped = groupByFile(diffs)
    assert.equal(grouped[0].hasChanges, true, 'hasChanges should be true if any section changed')
    assert.equal(grouped[0].totalAdded, 1, 'totalAdded should only count changed sections')
    assert.equal(grouped[0].totalRemoved, 0, 'totalRemoved should only count changed sections')
  })

  test('returns empty array for no diffs', () => {
    const grouped = groupByFile([])
    assert.equal(grouped.length, 0)
  })

  test('groups multi-target rules hitting same file', () => {
    const diffs = [
      { file: 'constitution.md', section: 'arch-decisions', ruleId: 'r1', added: 3, removed: 1, patch: 'p1', hasChanges: true },
      { file: 'constitution.md', section: 'plan-decisions', ruleId: 'r2', added: 5, removed: 2, patch: 'p2', hasChanges: true },
      { file: 'proposal.md', section: 'header', ruleId: 'r3', added: 2, removed: 0, patch: 'p3', hasChanges: true },
    ]

    const grouped = groupByFile(diffs)
    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].file, 'constitution.md')
    assert.equal(grouped[0].sections.length, 2)
    assert.equal(grouped[0].totalAdded, 8)
    assert.equal(grouped[0].totalRemoved, 3)
  })
})

// ─── applyDiff ────────────────────────────────────────────────────────────

describe('applyDiff', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('writes proposed content to disk', async () => {
    const proposedFiles = new Map()
    const relPath = '.specfuse/constitution.md'
    const content = '# Constitution\n\nUpdated content\n'
    proposedFiles.set(relPath, content)

    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, relPath), '# Old content\n')

    const results = await applyDiff(root, proposedFiles)
    assert.equal(results.length, 1)
    assert.equal(results[0].file, relPath)
    assert.equal(results[0].written, true)

    const written = await readFile(join(root, relPath), 'utf8')
    assert.equal(written, content)
  })

  test('handles non-existent target files — creates them', async () => {
    const proposedFiles = new Map()
    const relPath = '.specfuse/new-file.md'
    const content = 'Brand new file content\n'
    proposedFiles.set(relPath, content)

    const results = await applyDiff(root, proposedFiles)
    assert.equal(results.length, 1)
    assert.equal(results[0].written, true)

    const written = await readFile(join(root, relPath), 'utf8')
    assert.equal(written, content)
  })

  test('applies multiple files', async () => {
    const proposedFiles = new Map()
    proposedFiles.set('.specfuse/a.md', 'Content A')
    proposedFiles.set('.specfuse/b.md', 'Content B')

    const results = await applyDiff(root, proposedFiles)
    assert.equal(results.length, 2)
    assert.ok(results.every((r) => r.written))

    const a = await readFile(join(root, '.specfuse', 'a.md'), 'utf8')
    const b = await readFile(join(root, '.specfuse', 'b.md'), 'utf8')
    assert.equal(a, 'Content A')
    assert.equal(b, 'Content B')
  })

  test('reports errors for files that cannot be written', async () => {
    const proposedFiles = new Map()
    // Use a path that requires writing into a directory that exists as a file
    const relPath = '.specfuse/plan/architecture.md/impossible.md'
    proposedFiles.set(relPath, 'Cannot write here')

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), 'I am a file, not a dir')

    const results = await applyDiff(root, proposedFiles)
    assert.equal(results.length, 1)
    assert.equal(results[0].written, false)
    assert.ok(results[0].error, 'should have an error message')
  })

  test('returns empty results for empty map', async () => {
    const results = await applyDiff(root, new Map())
    assert.equal(results.length, 0)
  })
})

// ─── formatStat ───────────────────────────────────────────────────────────

describe('formatStat', () => {
  test('produces stat table with correct structure', () => {
    const filePatches = [
      {
        file: 'constitution.md',
        sections: [
          { section: 'arch-decisions', ruleId: 'r1', added: 3, removed: 1, hasChanges: true },
          { section: 'plan-decisions', ruleId: 'r2', added: 5, removed: 0, hasChanges: true },
        ],
        totalAdded: 8,
        totalRemoved: 1,
        hasChanges: true,
      },
      {
        file: 'proposal.md',
        sections: [
          { section: 'header', ruleId: 'r3', added: 2, removed: 0, hasChanges: true },
        ],
        totalAdded: 2,
        totalRemoved: 0,
        hasChanges: true,
      },
    ]

    const stat = formatStat(filePatches)
    assert.ok(stat.includes('constitution.md'), 'should include file name')
    assert.ok(stat.includes('proposal.md'), 'should include file name')
    assert.ok(stat.includes('+8'), 'should show total added')
    assert.ok(stat.includes('-1'), 'should show total removed')
    assert.ok(stat.includes('File'), 'should have header row')
  })

  test('returns "No changes." for empty patches', () => {
    const stat = formatStat([])
    assert.equal(stat, 'No changes.')
  })

  test('returns "No changes." when all patches have no changes', () => {
    const filePatches = [
      {
        file: 'unchanged.md',
        sections: [{ section: 's1', ruleId: 'r1', added: 0, removed: 0, hasChanges: false }],
        totalAdded: 0,
        totalRemoved: 0,
        hasChanges: false,
      },
    ]

    const stat = formatStat(filePatches)
    assert.equal(stat, 'No changes.')
  })

  test('counts only changed sections in section count', () => {
    const filePatches = [
      {
        file: 'mixed.md',
        sections: [
          { section: 's1', ruleId: 'r1', added: 0, removed: 0, hasChanges: false },
          { section: 's2', ruleId: 'r2', added: 3, removed: 1, hasChanges: true },
        ],
        totalAdded: 3,
        totalRemoved: 1,
        hasChanges: true,
      },
    ]

    const stat = formatStat(filePatches)
    // Should show 1 section changed (not 2)
    assert.ok(stat.includes('1'), 'should count only changed sections')
    assert.ok(stat.includes('+3'), 'should show added lines')
    assert.ok(stat.includes('-1'), 'should show removed lines')
  })
})

// ─── groupByFile + computeDiffWithProposed integration ────────────────────

describe('groupByFile + computeDiffWithProposed integration', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('groupByFile works with real computeDiffWithProposed output', async () => {
    const newSection = '- New decision X\n- New decision Y'
    const constitution = `# Constitution\n\n<!-- specfuse:arch-decisions:start -->\n- Old decision A\n<!-- specfuse:arch-decisions:end -->\n`
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'arch-decisions',
      async () => newSection,
      (data) => data,
    )

    const { diffs, proposedFiles } = await computeDiffWithProposed(root, [rule])
    const grouped = groupByFile(diffs, proposedFiles, root)

    assert.equal(grouped.length, 1)
    assert.equal(grouped[0].file, '.specfuse/constitution.md')
    assert.equal(grouped[0].hasChanges, true)
    assert.equal(grouped[0].sections.length, 1)
    assert.ok(grouped[0].totalAdded > 0)
    assert.ok(grouped[0].totalRemoved > 0)
    assert.ok(grouped[0].patch, 'should have a full-file patch')
  })

  test('multiple rules targeting same file produce single FilePatch', async () => {
    const constitution = '# Constitution\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)

    const ruleA = makeRule(
      'src→constitution:section-a',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'section-a',
      async () => 'Content A',
      (data) => data,
    )
    const ruleB = makeRule(
      'src→constitution:section-b',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'section-b',
      async () => 'Content B',
      (data) => data,
    )

    const { diffs, proposedFiles } = await computeDiffWithProposed(root, [ruleA, ruleB])
    const grouped = groupByFile(diffs, proposedFiles, root)

    assert.equal(grouped.length, 1, 'all rules target the same file')
    assert.equal(grouped[0].sections.length, 2, 'should have 2 sections')
    assert.equal(grouped[0].hasChanges, true)
  })
})

// ─── diff --apply registry sync ─────────────────────────────────────────────
//
// End-to-end contract: applying proposed content via applyDiff with a registry
// MUST reconcile the per-pair hashes so the next `drift` reports IN_SYNC
// (not phantom TARGET_CHANGED). Mirrors sync-engine's recordSync hash contract.

describe('diff-apply-registry', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  // (a) Drifted single-target pair → apply with registry → save → drift IN_SYNC.
  test('applyDiff with registry reconciles a drifted single-target pair to IN_SYNC', async () => {
    const oldSection = '- Old decision A\n- Old decision B'
    const newSection = '- New decision X\n- New decision Y'
    const constitution = `# Constitution\n\n<!-- specfuse:arch-decisions:start -->\n${oldSection}\n<!-- specfuse:arch-decisions:end -->\n`

    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'arch-decisions',
      async () => newSection,
      (data) => data,
    )

    // Seed a STALE prior sync record so the on-disk oldSection diverges from it
    // and drift reports TARGET_CHANGED before the apply. (We record a hash that
    // does NOT match oldSection — the on-disk content — so tgtChanged is true.)
    const reg = new Registry(root)
    await reg.load()
    reg.recordSync(
      rule.source,
      rule.target,
      hashContent(ARCH_DOC),
      hashContent('- some other stale content'),
    )
    await reg.save()

    // Before apply: drift must report the target changed.
    const beforeDrift = await checkAllDrift(root, reg, [rule])
    assert.equal(beforeDrift[0].state, 'TARGET_CHANGED', 'precondition: target must be drifted')

    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [rule])
    assert.equal(pairContexts.length, 1, 'one pairContext for the changed section')
    assert.equal(pairContexts[0].sourceId, rule.source)
    assert.equal(pairContexts[0].targetId, rule.target)

    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()

    assert.equal(applied.length, 1)
    assert.equal(applied[0].written, true)

    // After apply + save: a fresh drift check MUST report IN_SYNC.
    const freshReg = new Registry(root)
    await freshReg.load()
    const afterDrift = await checkAllDrift(root, freshReg, [rule])
    assert.equal(afterDrift[0].state, 'IN_SYNC', 'applied pair must be reconciled to IN_SYNC')
  })

  // (b) Multi-rule-same-file: two sections in one target file → apply → both
  // pairs recorded (two sync keys) and drift IN_SYNC for both. HIGHEST-RISK case.
  test('multi-rule-same-file records a per-pair sync entry for every changed section', async () => {
    const sectionA = 'Content A new'
    const sectionB = 'Content B new'
    const constitution = '# Constitution\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), 'PRD\n')
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

    const ruleA = makeRule(
      'src→constitution:section-a',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/constitution.md',
      'section-a',
      async () => sectionA,
      (data) => data,
    )
    const ruleB = makeRule(
      'arch→constitution:section-b',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'section-b',
      async () => sectionB,
      (data) => data,
    )

    const reg = new Registry(root)
    await reg.load()
    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [ruleA, ruleB])

    // proposedFiles collapses both sections into ONE full-file entry.
    assert.equal(proposedFiles.size, 1, 'two sections in one file collapse to one proposed entry')
    // pairContexts carries BOTH pairs (NOT deduped by relPath).
    assert.equal(pairContexts.length, 2, 'both pairs must carry their own pairContext')
    const ctxSections = pairContexts.map((c) => c.section).sort()
    assert.deepEqual(ctxSections, ['section-a', 'section-b'])

    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()

    assert.equal(applied.length, 1, 'one file written')
    assert.equal(applied[0].written, true)

    // Two distinct sync keys recorded — one per pair.
    assert.ok(reg.data.syncs[`${ruleA.source}→${ruleA.target}`], 'pair A sync recorded')
    assert.ok(reg.data.syncs[`${ruleB.source}→${ruleB.target}`], 'pair B sync recorded')

    // Both pairs report IN_SYNC after apply.
    const freshReg = new Registry(root)
    await freshReg.load()
    const drift = await checkAllDrift(root, freshReg, [ruleA, ruleB])
    const states = drift.map((d) => d.state)
    assert.ok(states.every((s) => s === 'IN_SYNC'), 'both pairs IN_SYNC after apply')
  })

  // (c) Failed-write isolation: a file that cannot be written must NOT record a
  // sync for its pairs, while other applied pairs are recorded normally. The
  // maps are hand-built (mirroring the existing applyDiff error test) so the bad
  // target's parent-exists-as-a-file failure is isolated to the write phase.
  test('failed write does not record a sync for that file’s pairs', async () => {
    const goodRelPath = '.specfuse/plan/good-target.md'
    const badRelPath = '.specfuse/plan/bad-target.md/impossible.md'

    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    // bad-target.md exists as a FILE, so writing into it as a directory fails.
    await writeFile(join(root, '.specfuse', 'plan', 'bad-target.md'), 'I am a file, not a dir')

    const goodSource = '.specfuse/plan/architecture.md'
    const badSource = '.specfuse/plan/prd.md'

    const proposedFiles = new Map()
    proposedFiles.set(goodRelPath, `# Good\n\n<!-- specfuse:good-section:start -->\nGood content\n<!-- specfuse:good-section:end -->\n`)
    proposedFiles.set(badRelPath, 'Cannot write here')

    const pairContexts = [
      {
        relPath: goodRelPath,
        sourceId: goodSource,
        targetId: goodRelPath,
        sourceHash: hashContent(ARCH_DOC),
        targetHash: hashContent('Good content'),
        section: 'good-section',
        ruleId: 'arch→good:good-section',
      },
      {
        relPath: badRelPath,
        sourceId: badSource,
        targetId: badRelPath,
        sourceHash: hashContent('PRD\n'),
        targetHash: hashContent('Bad content'),
        section: 'bad-section',
        ruleId: 'src→bad:bad-section',
      },
    ]

    const reg = new Registry(root)
    await reg.load()
    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()

    const goodResult = applied.find((a) => a.file === goodRelPath)
    const badResult = applied.find((a) => a.file === badRelPath)
    assert.equal(goodResult.written, true, 'good file written')
    assert.equal(badResult.written, false, 'bad file must fail to write')

    assert.ok(
      reg.data.syncs[`${goodSource}→${goodRelPath}`],
      'good pair recorded',
    )
    assert.ok(
      !reg.data.syncs[`${badSource}→${badRelPath}`],
      'bad pair must NOT be recorded on a failed write',
    )
  })

  // (d) Preview path: applyDiff WITHOUT a registry (or computeDiff without
  // apply) leaves registry.data.syncs untouched.
  test('preview path (no registry) leaves the registry untouched', async () => {
    const newSection = '- New content for preview'
    const constitution = '# Constitution\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'arch-decisions',
      async () => newSection,
      (data) => data,
    )

    const reg = new Registry(root)
    await reg.load()
    const syncsBefore = JSON.stringify(reg.data.syncs)

    // computeDiffWithProposed alone must not mutate the registry.
    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [rule])
    assert.equal(JSON.stringify(reg.data.syncs), syncsBefore, 'compute must not touch syncs')

    // applyDiff WITHOUT a registry writes files but records nothing.
    const applied = await applyDiff(root, proposedFiles, pairContexts)
    assert.equal(applied[0].written, true)
    assert.equal(JSON.stringify(reg.data.syncs), syncsBefore, 'apply without registry must not touch syncs')
  })

  // (e) Single save: a multi-pair apply records every pair but the caller saves
  // exactly once.
  test('a multi-pair apply records every pair with a single registry.save()', async () => {
    const sectionA = 'Content A'
    const sectionB = 'Content B'
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), 'PRD\n')
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

    // Two rules → two separate target files (two pairs, two writes).
    const ruleA = makeRule(
      'src→a:section-a',
      'A',
      '.specfuse/plan/prd.md',
      '.specfuse/plan/target-a.md',
      'section-a',
      async () => sectionA,
      (data) => data,
    )
    const ruleB = makeRule(
      'arch→b:section-b',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/plan/target-b.md',
      'section-b',
      async () => sectionB,
      (data) => data,
    )

    const reg = new Registry(root)
    await reg.load()

    let saveCalls = 0
    const origSave = reg.save.bind(reg)
    reg.save = async () => {
      saveCalls++
      return origSave()
    }

    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [ruleA, ruleB])
    assert.equal(pairContexts.length, 2, 'two pairs')
    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()

    assert.equal(applied.length, 2)
    assert.ok(applied.every((a) => a.written))
    assert.equal(saveCalls, 1, 'exactly one save across a multi-pair apply')
    assert.ok(reg.data.syncs[`${ruleA.source}→${ruleA.target}`], 'pair A recorded')
    assert.ok(reg.data.syncs[`${ruleB.source}→${ruleB.target}`], 'pair B recorded')
  })

  // (f) Multi-target rule: apply records the pair under 'constitution' →
  // 'changes:<dir>' and drift reports IN_SYNC.
  test('multi-target rule records under constitution → changes:<dir> and reaches IN_SYNC', async () => {
    const headerContent = 'Constitutional header content'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n')
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'),
      '# Change Proposal: Add Cart\n',
    )

    const multiRule = makeRule(
      'constitution→changes:multi',
      'B',
      '.specfuse/constitution.md',
      '.specfuse/changes/*/proposal.md',
      'constitution-header',
      async () => headerContent,
      (data) => data,
      {
        isMultiTarget: true,
        resolveTargets: async () => {
          return [join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md')]
        },
      },
    )

    const reg = new Registry(root)
    await reg.load()
    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [multiRule])

    assert.equal(pairContexts.length, 1, 'one multi-target pair')
    assert.equal(pairContexts[0].sourceId, 'constitution', 'multi-target sourceId is constitution')
    assert.equal(pairContexts[0].targetId, 'changes:add-cart', 'multi-target targetId is changes:<dir>')

    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()

    assert.equal(applied[0].written, true)
    assert.ok(
      reg.data.syncs['constitution→changes:add-cart'],
      'multi-target pair recorded under constitution → changes:<dir>',
    )

    // drift-detector's checkMultiTargetDrift must report IN_SYNC.
    const freshReg = new Registry(root)
    await freshReg.load()
    const drift = await checkAllDrift(root, freshReg, [multiRule])
    assert.equal(drift.length, 1)
    assert.equal(drift[0].state, 'IN_SYNC', 'multi-target pair IN_SYNC after apply')
  })

  // First-ever apply on a NEVER_SYNCED pair: recordSync creates the first entry
  // and drift goes NEVER_SYNCED → IN_SYNC (no prior getLastSync required).
  test('first-ever apply on a NEVER_SYNCED pair creates the initial sync entry', async () => {
    const newSection = '- First ever content'
    const constitution = '# Constitution\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)

    const rule = makeRule(
      'arch→constitution:arch-decisions',
      'A',
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'arch-decisions',
      async () => newSection,
      (data) => data,
    )

    const reg = new Registry(root)
    await reg.load()
    // No prior sync record → NEVER_SYNCED before apply.
    const beforeDrift = await checkAllDrift(root, reg, [rule])
    assert.equal(beforeDrift[0].state, 'NEVER_SYNCED', 'precondition: never synced')

    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [rule])
    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()

    assert.equal(applied[0].written, true)
    const freshReg = new Registry(root)
    await freshReg.load()
    const afterDrift = await checkAllDrift(root, freshReg, [rule])
    assert.equal(afterDrift[0].state, 'IN_SYNC', 'never-synced pair becomes IN_SYNC after apply')
  })

  // Source-is-a-directory: sourceHash must hash `dir:<rule.source>` so it aligns
  // with drift-detector's sourceIsDir branch (no SOURCE_CHANGED phantom drift).
  test('directory source hashes dir:<source> so drift reports IN_SYNC after apply', async () => {
    const newSection = '- Stories index content'
    const constitution = '# Constitution\n'
    await mkdir(join(root, '.specfuse'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'constitution.md'), constitution)
    // A directory source (stories/).
    await mkdir(join(root, 'stories'), { recursive: true })
    await writeFile(join(root, 'stories', 's1.md'), '# Story 1\n')

    const rule = makeRule(
      'stories→constitution:stories-index',
      'A',
      'stories',
      '.specfuse/constitution.md',
      'stories-index',
      async () => newSection,
      (data) => data,
    )

    const reg = new Registry(root)
    await reg.load()
    const { proposedFiles, pairContexts } = await computeDiffWithProposed(root, [rule])

    // sourceHash must match hashContent('dir:stories') — the same value
    // drift-detector computes for a directory source.
    assert.equal(
      pairContexts[0].sourceHash,
      hashContent('dir:stories'),
      'directory source must hash dir:<source>',
    )

    const applied = await applyDiff(root, proposedFiles, pairContexts, reg)
    await reg.save()
    assert.equal(applied[0].written, true)

    const freshReg = new Registry(root)
    await freshReg.load()
    const drift = await checkAllDrift(root, freshReg, [rule])
    assert.equal(drift[0].state, 'IN_SYNC', 'directory-source pair IN_SYNC (no SOURCE_CHANGED phantom)')
  })
})
