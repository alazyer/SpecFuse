import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-validate-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  return root
}

// Run validateCommand in JSON mode and parse the output
async function runValidate(root, extraOptions = {}) {
  const originalLog = console.log
  const captured = []
  console.log = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  let exitCode = 0
  const originalExit = process.exit
  process.exit = (code) => {
    exitCode = code
    throw new Error(`EXIT:${code}`)
  }

  try {
    const { validateCommand } = await import('../commands/validate.js')
    await validateCommand(root, { json: true, ...extraOptions })
  } catch (e) {
    if (!e.message?.startsWith('EXIT:')) {
      console.log = originalLog
      process.exit = originalExit
      throw e
    }
    exitCode = parseInt(e.message.replace('EXIT:', ''), 10)
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  const jsonLine = captured.find((line) => line.trim().startsWith('{'))
  if (!jsonLine) return { exitCode, results: null, valid: null }

  const parsed = JSON.parse(jsonLine)
  return { exitCode, results: parsed.checks, valid: parsed.valid }
}

function findCheck(results, id) {
  return results?.find((r) => r.id === id) ?? null
}

function findChecksByPrefix(results, prefix) {
  return results?.filter((r) => r.id.startsWith(prefix)) ?? []
}

// ─── checkRequiredSections ────────────────────────────────────────────────

describe('checkRequiredSections', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when PRD has all required sections', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n## Overview\nProject overview text\n\n## Non-Functional Requirements\n- Availability: 99.9%\n\n## Technical Constraints\n- Deployment target: AWS\n',
    )
    const { results } = await runValidate(root)
    const overview = findCheck(results, 'sections:prd:overview')
    const nfr = findCheck(results, 'sections:prd:non-functional-requirements')
    const tc = findCheck(results, 'sections:prd:technical-constraints')
    assert.equal(overview?.state, 'PASS')
    assert.equal(nfr?.state, 'PASS')
    assert.equal(tc?.state, 'PASS')
  })

  test('WARN when PRD is missing a required section', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n## Overview\nProject overview\n\n## Goals\nSome goals\n',
    )
    const { results } = await runValidate(root)
    const nfr = findCheck(results, 'sections:prd:non-functional-requirements')
    const tc = findCheck(results, 'sections:prd:technical-constraints')
    assert.equal(nfr?.state, 'WARN')
    assert.ok(nfr?.message.includes('missing'))
    assert.equal(tc?.state, 'WARN')
  })

  test('WARN when PRD has an empty required section', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n## Overview\nProject overview\n\n## Non-Functional Requirements\n\n## Technical Constraints\n- Some constraint\n',
    )
    const { results } = await runValidate(root)
    const nfr = findCheck(results, 'sections:prd:non-functional-requirements')
    assert.equal(nfr?.state, 'WARN')
    assert.ok(nfr?.message.includes('empty'))
  })

  test('skip non-existent artifact files', async () => {
    // No plan directory — only check changes and markers
    const { results } = await runValidate(root)
    const prdChecks = findChecksByPrefix(results, 'sections:prd:')
    assert.equal(prdChecks.length, 0)
  })

  test('PASS when Architecture has all required sections', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'architecture.md'),
      '# Architecture\n\n## Architectural Decisions\n- Decision 1\n\n## Tech Stack\n- Runtime: Node.js\n',
    )
    const { results } = await runValidate(root)
    const ad = findCheck(results, 'sections:arch:architectural-decisions')
    const ts = findCheck(results, 'sections:arch:tech-stack')
    assert.equal(ad?.state, 'PASS')
    assert.equal(ts?.state, 'PASS')
  })

  test('PASS when Design System has all required sections', async () => {
    await mkdir(join(root, '.specfuse', 'plan', 'design'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'design', 'system.md'),
      '# Design System\n\n## Design Tokens\n- Use semantic tokens\n\n## Accessibility Rules\n- Min touch target 44px\n',
    )
    const { results } = await runValidate(root)
    const dt = findCheck(results, 'sections:design-system:design-tokens')
    const ar = findCheck(results, 'sections:design-system:accessibility-rules')
    assert.equal(dt?.state, 'PASS')
    assert.equal(ar?.state, 'PASS')
  })

  test('WARN when proposal is missing required sections', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '# Change Proposal: Add Login\n\n## Overview\nBrief summary\n',
    )
    const { results } = await runValidate(root)
    const scope = findCheck(results, 'sections:proposal:add-login:scope')
    const ac = findCheck(results, 'sections:proposal:add-login:acceptance-criteria')
    assert.equal(scope?.state, 'WARN')
    assert.equal(ac?.state, 'WARN')
  })

  test('PASS when proposal has all required sections', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstatus: active\ncreated: 2026-01-01\n---\n\n# Change Proposal: Add Login\n\n## Overview\nBrief summary\n\n## Scope\n**In scope:** Login form\n\n## Acceptance Criteria\n- [ ] User can log in\n',
    )
    const { results } = await runValidate(root)
    const overview = findCheck(results, 'sections:proposal:add-login:overview')
    const scope = findCheck(results, 'sections:proposal:add-login:scope')
    const ac = findCheck(results, 'sections:proposal:add-login:acceptance-criteria')
    assert.equal(overview?.state, 'PASS')
    assert.equal(scope?.state, 'PASS')
    assert.equal(ac?.state, 'PASS')
  })

  test('WARN when story is missing required sections', async () => {
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'stories', 'login.md'),
      '# Story: Login\n\n## Technical Notes\nSome notes\n',
    )
    const { results } = await runValidate(root)
    const desc = findCheck(results, 'sections:story:login:description')
    const ac = findCheck(results, 'sections:story:login:acceptance-criteria')
    assert.equal(desc?.state, 'WARN')
    assert.equal(ac?.state, 'WARN')
  })

  test('PASS when story has all required sections', async () => {
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'stories', 'login.md'),
      '# Story: Login\n\n## Description\nAs a user, I want to log in.\n\n## Acceptance Criteria\n- [ ] Can log in\n',
    )
    const { results } = await runValidate(root)
    const desc = findCheck(results, 'sections:story:login:description')
    const ac = findCheck(results, 'sections:story:login:acceptance-criteria')
    assert.equal(desc?.state, 'PASS')
    assert.equal(ac?.state, 'PASS')
  })
})

// ─── checkAcceptanceCriteria ──────────────────────────────────────────────

describe('checkAcceptanceCriteria', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when proposal has valid checkbox AC items', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '# Proposal\n\n## Acceptance Criteria\n- [ ] User can log in\n- [ ] Error shown on invalid credentials\n',
    )
    const { results } = await runValidate(root)
    const ac = findCheck(results, 'ac:proposal:add-login:format')
    assert.equal(ac?.state, 'PASS')
  })

  test('WARN when proposal uses plain bullets instead of checkboxes', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '# Proposal\n\n## Acceptance Criteria\n- User can log in\n- Error shown on invalid credentials\n',
    )
    const { results } = await runValidate(root)
    const ac = findCheck(results, 'ac:proposal:add-login:format')
    assert.equal(ac?.state, 'WARN')
    assert.ok(ac?.message.includes('plain bullets'))
  })

  test('WARN when proposal has empty checkbox text', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '# Proposal\n\n## Acceptance Criteria\n- [ ] \n- [ ] \n',
    )
    const { results } = await runValidate(root)
    const ac = findCheck(results, 'ac:proposal:add-login:empty-text')
    assert.equal(ac?.state, 'WARN')
    assert.ok(ac?.message.includes('empty checkbox'))
  })

  test('WARN when proposal has no Acceptance Criteria section', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '# Proposal\n\n## Overview\nJust an overview\n',
    )
    const { results } = await runValidate(root)
    const ac = findCheck(results, 'ac:proposal:add-login:missing')
    assert.equal(ac?.state, 'WARN')
    assert.ok(ac?.message.includes('no Acceptance Criteria'))
  })

  test('PASS when story has valid AC', async () => {
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'stories', 'login.md'),
      '# Story: Login\n\n## Acceptance Criteria\n- [ ] User can log in\n',
    )
    const { results } = await runValidate(root)
    const ac = findCheck(results, 'ac:story:login:format')
    assert.equal(ac?.state, 'PASS')
  })

  test('WARN when AC section is empty (no items)', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '# Proposal\n\n## Acceptance Criteria\n\nNo items yet.\n',
    )
    const { results } = await runValidate(root)
    const acChecks = findChecksByPrefix(results, 'ac:proposal:add-login:')
    // Should get either empty or missing
    assert.ok(acChecks.length > 0)
    assert.ok(acChecks.some((c) => c.state === 'WARN'))
  })

  test('returns PASS when no proposals or stories found', async () => {
    const { results } = await runValidate(root)
    // No changes dir — should get a PASS for no proposals
    const acCheck = findCheck(results, 'ac')
    assert.equal(acCheck?.state, 'PASS')
    assert.ok(acCheck?.message.includes('No proposals or stories'))
  })
})

// ─── checkManagedMarkers ──────────────────────────────────────────────────

describe('checkManagedMarkers', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when constitution has balanced markers', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\n<!-- specfuse:decisions:end -->\n',
    )
    const { results } = await runValidate(root)
    const markerChecks = findChecksByPrefix(results, 'markers:')
    assert.ok(markerChecks.some((c) => c.state === 'PASS'))
  })

  test('FAIL when file has unclosed start marker', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\nNo end marker\n',
    )
    const { results } = await runValidate(root)
    const markerChecks = findChecksByPrefix(results, 'markers:')
    assert.ok(markerChecks.some((c) => c.state === 'FAIL'))
    assert.ok(markerChecks.some((c) => c.message.includes('unclosed')))
  })

  test('FAIL when end marker appears before start', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:end -->\n<!-- specfuse:decisions:start -->\ncontent\n',
    )
    const { results } = await runValidate(root)
    const markerChecks = findChecksByPrefix(results, 'markers:')
    assert.ok(markerChecks.some((c) => c.state === 'FAIL'))
    assert.ok(markerChecks.some((c) => c.message.includes('before')))
  })

  test('FAIL when markers are nested', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\n<!-- specfuse:rules:start -->\nrules\n<!-- specfuse:rules:end -->\n<!-- specfuse:decisions:end -->\n',
    )
    const { results } = await runValidate(root)
    const markerChecks = findChecksByPrefix(results, 'markers:')
    assert.ok(markerChecks.some((c) => c.state === 'FAIL'))
    assert.ok(markerChecks.some((c) => c.message.includes('nested')))
  })

  test('PASS when multiple files each have balanced markers', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\n<!-- specfuse:decisions:end -->\n',
    )
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n<!-- specfuse:overview:start -->\nPRD content\n<!-- specfuse:overview:end -->\n',
    )
    const { results } = await runValidate(root)
    const markerChecks = findChecksByPrefix(results, 'markers:')
    assert.ok(markerChecks.every((c) => c.state === 'PASS'))
  })

  test('no results when no markdown files have markers', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD\n\nNo markers.\n')
    const { results } = await runValidate(root)
    const markerChecks = findChecksByPrefix(results, 'markers:')
    // Should have a PASS for no markers or skip
    assert.ok(markerChecks.every((c) => c.state === 'PASS'))
  })
})

// ─── checkFrontmatter ─────────────────────────────────────────────────────

describe('checkFrontmatter', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when proposal has valid status and created', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstatus: active\ncreated: 2026-01-01\n---\n\n# Change Proposal: Add Login\n',
    )
    const { results } = await runValidate(root)
    const statusCheck = findCheck(results, 'frontmatter:proposal:add-login:status')
    const createdCheck = findCheck(results, 'frontmatter:proposal:add-login:created')
    assert.equal(statusCheck?.state, 'PASS')
    assert.equal(createdCheck?.state, 'PASS')
  })

  test('WARN when proposal is missing status', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\ncreated: 2026-01-01\n---\n\n# Change Proposal: Add Login\n',
    )
    const { results } = await runValidate(root)
    const statusCheck = findCheck(results, 'frontmatter:proposal:add-login:status')
    assert.equal(statusCheck?.state, 'WARN')
    assert.ok(statusCheck?.message.includes('missing'))
  })

  test('WARN when proposal has invalid status value', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstatus: unknown-status\ncreated: 2026-01-01\n---\n\n# Change Proposal: Add Login\n',
    )
    const { results } = await runValidate(root)
    const statusCheck = findCheck(results, 'frontmatter:proposal:add-login:status')
    assert.equal(statusCheck?.state, 'WARN')
    assert.ok(statusCheck?.message.includes('invalid status'))
  })

  test('WARN when proposal is missing created field', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstatus: active\n---\n\n# Change Proposal: Add Login\n',
    )
    const { results } = await runValidate(root)
    const createdCheck = findCheck(results, 'frontmatter:proposal:add-login:created')
    assert.equal(createdCheck?.state, 'WARN')
    assert.ok(createdCheck?.message.includes('missing'))
  })

  test('PASS when review has valid status', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'review.md'),
      '---\nstatus: approved\n---\n\n# Review: Add Login\n',
    )
    const { results } = await runValidate(root)
    const statusCheck = findCheck(results, 'frontmatter:review:add-login:status')
    assert.equal(statusCheck?.state, 'PASS')
  })

  test('PASS when verify has valid status', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'verify.md'),
      '---\nstatus: pass\n---\n\n# Verify: Add Login\n',
    )
    const { results } = await runValidate(root)
    const statusCheck = findCheck(results, 'frontmatter:verify:add-login:status')
    assert.equal(statusCheck?.state, 'PASS')
  })

  test('WARN when review has invalid status', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'review.md'),
      '---\nstatus: done\n---\n\n# Review: Add Login\n',
    )
    const { results } = await runValidate(root)
    const statusCheck = findCheck(results, 'frontmatter:review:add-login:status')
    assert.equal(statusCheck?.state, 'WARN')
    assert.ok(statusCheck?.message.includes('invalid status'))
  })
})

// ─── checkChangeStructure ─────────────────────────────────────────────────

describe('checkChangeStructure', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when change dir has proposal.md', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstatus: active\ncreated: 2026-01-01\n---\n\n# Change Proposal: Add Login\n',
    )
    const { results } = await runValidate(root)
    const check = findCheck(results, 'change-structure:add-login')
    assert.equal(check?.state, 'PASS')
  })

  test('FAIL when change dir is missing proposal.md', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    // No proposal.md created
    const { results } = await runValidate(root)
    const check = findCheck(results, 'change-structure:add-login')
    assert.equal(check?.state, 'FAIL')
    assert.ok(check?.message.includes('missing proposal.md'))
  })

  test('WARN when flat .md files found in changes/', async () => {
    await mkdir(join(root, '.specfuse', 'changes'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'orphan.md'), '# Orphan\n')
    const { results } = await runValidate(root)
    const check = findCheck(results, 'change-structure:flat-files')
    assert.equal(check?.state, 'WARN')
    assert.ok(check?.message.includes('flat'))
  })

  test('PASS when changes dir does not exist', async () => {
    const { results } = await runValidate(root)
    const check = findCheck(results, 'change-structure')
    assert.equal(check?.state, 'PASS')
  })
})

// ─── Integration: validateCommand ─────────────────────────────────────────

describe('validateCommand (integration)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('exits 0 on clean project with no artifacts', async () => {
    const { exitCode, valid } = await runValidate(root)
    assert.equal(exitCode, 0)
    assert.equal(valid, true)
  })

  test('produces valid JSON with valid: true when no failures', async () => {
    const { valid, results } = await runValidate(root)
    assert.equal(valid, true)
    assert.ok(Array.isArray(results))
  })

  test('exits 1 when FAIL checks present', async () => {
    await mkdir(join(root, '.specfuse', 'changes', 'broken'), { recursive: true })
    // No proposal.md in the change dir → FAIL
    const { exitCode, valid } = await runValidate(root)
    assert.equal(exitCode, 1)
    assert.equal(valid, false)
  })

  test('--fail exits 1 on WARN', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n## Overview\nJust overview\n',
    )
    const { exitCode } = await runValidate(root, { fail: true })
    // Missing sections → WARN, --fail makes it exit 1
    assert.equal(exitCode, 1)
  })

  test('--artifact prd only checks PRD-related results', async () => {
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n## Overview\nOverview text\n\n## Non-Functional Requirements\nNFR text\n\n## Technical Constraints\nTC text\n',
    )
    // add-login dir has no proposal.md → would normally FAIL change-structure
    const { results } = await runValidate(root, { artifact: 'prd' })
    // Should only have PRD-related checks, not change-structure
    assert.ok(results.every((r) => !r.id.startsWith('change-structure:')))
    assert.ok(results.every((r) => !r.id.startsWith('ac:proposal:')))
  })

  test('full happy path: all artifacts valid', async () => {
    // Set up a complete healthy project
    await mkdir(join(root, '.specfuse', 'plan', 'design'), { recursive: true })
    await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
    await mkdir(join(root, '.specfuse', 'changes', 'add-login'), { recursive: true })

    // PRD
    await writeFile(
      join(root, '.specfuse', 'plan', 'prd.md'),
      '# PRD\n\n## Overview\nProject overview\n\n## Non-Functional Requirements\n- Availability: 99.9%\n\n## Technical Constraints\n- AWS deployment\n',
    )

    // Architecture
    await writeFile(
      join(root, '.specfuse', 'plan', 'architecture.md'),
      '# Architecture\n\n## Architectural Decisions\n- Microservices\n\n## Tech Stack\n- Runtime: Node.js\n',
    )

    // Design system
    await writeFile(
      join(root, '.specfuse', 'plan', 'design', 'system.md'),
      '# Design System\n\n## Design Tokens\n- Use semantic tokens\n\n## Accessibility Rules\n- Min contrast 4.5:1\n',
    )

    // Story
    await writeFile(
      join(root, '.specfuse', 'plan', 'stories', 'login.md'),
      '# Story: Login\n\n## Description\nAs a user I want to log in\n\n## Acceptance Criteria\n- [ ] Can log in\n',
    )

    // Change proposal with proper frontmatter
    await writeFile(
      join(root, '.specfuse', 'changes', 'add-login', 'proposal.md'),
      '---\nstatus: active\ncreated: 2026-01-01\n---\n\n# Change Proposal: Add Login\n\n## Overview\nBrief\n\n## Scope\n**In scope:** Login\n\n## Acceptance Criteria\n- [ ] User can log in\n',
    )

    // Constitution with balanced markers
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\n<!-- specfuse:decisions:end -->\n',
    )

    const { exitCode, valid, results } = await runValidate(root)
    assert.equal(exitCode, 0)
    assert.equal(valid, true)

    // Verify no FAIL results
    const fails = results.filter((r) => r.state === 'FAIL')
    assert.equal(fails.length, 0, `Unexpected FAILs: ${fails.map((f) => f.id).join(', ')}`)
  })
})
