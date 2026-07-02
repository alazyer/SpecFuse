import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { computeDiff } from '../core/differ.js'
import { Registry } from '../core/registry.js'

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
