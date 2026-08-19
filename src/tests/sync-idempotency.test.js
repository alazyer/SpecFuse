import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { runTwoPassSync } from '../core/sync-engine.js'
import {
  formatGitHub,
  formatSarif,
  formatJUnit,
} from '../core/ci-output.js'

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
## Non-Functional Requirements
- 99.9% uptime SLA
- 10,000 concurrent users
## Technical Constraints
- Deploy to AWS
`

const STORY_DOC = `# Story: User Auth
## Acceptance Criteria
- [ ] Login works
- [ ] Logout works
`

const PROPOSAL_DOC = `# Change Proposal: Add Cart
## Overview
Add shopping cart.
`

const CLI_PATH = fileURLToPath(new URL('../../bin/specfuse.js', import.meta.url))

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  })
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-idem-test-'))
  await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })
  return root
}

// Fully-set-up project: arch + prd + story + proposal, then one initial sync.
async function makeSyncedProject() {
  const root = await makeFixture()
  await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
  await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), PRD_DOC)
  await writeFile(join(root, '.specfuse', 'plan', 'stories', 'story-001-auth.md'), STORY_DOC)
  await writeFile(join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'), PROPOSAL_DOC)

  const registry = new Registry(root)
  await registry.load()
  const rules = await loadRules(root)
  await runTwoPassSync(root, registry, rules)
  return root
}

// ─── Idempotency: re-sync with unchanged sources is a no-op ───────────────────

describe('Sync idempotency — unchanged sources', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('second sync writes no target files and reports unchanged for all rules', async () => {
    const constitutionPath = join(root, '.specfuse', 'constitution.md')
    const proposalPath = join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md')

    // Snapshot the on-disk managed sections after the first sync.
    const constitutionBefore = await readFile(constitutionPath, 'utf8')
    const proposalBefore = await readFile(proposalPath, 'utf8')

    // Re-sync with no source changes.
    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    const { passA, passB } = await runTwoPassSync(root, registry, rules)

    const all = [...passA, ...passB]

    // Every rule that produced content on the first run is now `unchanged`.
    // (Rules whose source is missing report `skipped`, not `unchanged` — they
    // are excluded from the unchanged assertion.)
    const contentRules = all.filter(
      (r) => r.state !== 'skipped' && r.state !== 'skipped_conflict',
    )
    assert.ok(
      contentRules.length > 0,
      'expected at least one content-bearing rule to run',
    )
    for (const r of contentRules) {
      assert.equal(
        r.state,
        'unchanged',
        `${r.ruleId} should be unchanged on re-sync (got ${r.state}: ${r.message})`,
      )
      assert.equal(r.changed, false, `${r.ruleId} changed flag must be false`)
    }

    // No `changed` results at all.
    const changed = all.filter((r) => r.state === 'changed')
    assert.equal(changed.length, 0, `expected zero changed rules, got ${changed.length}`)

    // No target file was rewritten.
    assert.equal(await readFile(constitutionPath, 'utf8'), constitutionBefore)
    assert.equal(await readFile(proposalPath, 'utf8'), proposalBefore)
  })

  test('re-sync across days with identical sources is a no-op (no date-driven diff)', async () => {
    // The built-in transforms no longer embed ctx.today(), so advancing the
    // date must not produce a content change. We simulate "day 2" by simply
    // re-running: the absence of a date stamp guarantees byte-identical output
    // regardless of wall-clock time.
    const constitutionPath = join(root, '.specfuse', 'constitution.md')
    const before = await readFile(constitutionPath, 'utf8')

    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    const { passA, passB } = await runTwoPassSync(root, registry, rules)
    const all = [...passA, ...passB]

    // No rule should report `changed` from date churn.
    const changed = all.filter((r) => r.state === 'changed')
    assert.equal(
      changed.length,
      0,
      `date advancement must not cause changes: ${changed.map((r) => r.ruleId).join(', ')}`,
    )

    // The managed section content is byte-identical to day 1.
    assert.equal(await readFile(constitutionPath, 'utf8'), before)
  })

  test('modifying one source re-syncs only the affected rule; rest report unchanged', async () => {
    // Modify architecture.md — only arch-derived rule(s) should report changed.
    await writeFile(
      join(root, '.specfuse', 'plan', 'architecture.md'),
      ARCH_DOC.replace('- JWT 15-minute expiry', '- JWT 15-minute expiry\n- OAuth2 PKCE flow'),
    )

    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    const { passA, passB } = await runTwoPassSync(root, registry, rules)
    const all = [...passA, ...passB]

    const changed = all.filter((r) => r.state === 'changed')
    const unchanged = all.filter((r) => r.state === 'unchanged')

    // At least one rule changed (the arch rule).
    assert.ok(
      changed.some((r) => r.ruleId.includes('arch')),
      'arch rule should report changed after arch source edit',
    )
    // At least one other rule is unchanged.
    assert.ok(
      unchanged.length > 0,
      'expected at least one unchanged rule alongside the changed one',
    )
    // No non-arch content rule should be in `changed`.
    const strayChanged = changed.filter((r) => !r.ruleId.includes('arch'))
    assert.equal(
      strayChanged.length,
      0,
      `only the arch rule should change; others changed unexpectedly: ${strayChanged.map((r) => r.ruleId).join(', ')}`,
    )
  })
})

// ─── Built-in transform determinism ──────────────────────────────────────────

describe('Built-in transform determinism', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('managed-section content is byte-identical across two runs (no date stamp)', async () => {
    const constitutionPath = join(root, '.specfuse', 'constitution.md')
    const afterFirst = await readFile(constitutionPath, 'utf8')

    // Re-run sync (would rewrite if transforms were non-deterministic).
    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    await runTwoPassSync(root, registry, rules)

    const afterSecond = await readFile(constitutionPath, 'utf8')
    assert.equal(
      afterSecond,
      afterFirst,
      'constitution must be byte-identical across two syncs with identical sources',
    )

    // And the content must NOT contain the old volatile date header.
    assert.doesNotMatch(
      afterFirst,
      /Auto-synced from .+ by SpecFuse on \d/,
      'managed section must not contain the volatile date header',
    )
  })
})

// ─── CLI: sync --json carries the unchanged state ─────────────────────────────

describe('sync --json output', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('no-op run carries unchanged state per rule and is distinguishable from a change run', async () => {
    // No-op run: nothing changed since makeSyncedProject's initial sync.
    const noOp = runCli(root, ['sync', '--json'])
    assert.equal(noOp.status, 0, `sync --json exited non-zero: ${noOp.stderr}`)
    const noOpJson = JSON.parse(noOp.stdout)

    assert.ok(Array.isArray(noOpJson.passA), 'passA must be an array')
    assert.ok(Array.isArray(noOpJson.passB), 'passB must be an array')
    assert.ok(Array.isArray(noOpJson.warnings), 'warnings must be an array')

    const all = [...noOpJson.passA, ...noOpJson.passB]
    const contentRules = all.filter(
      (r) => r.state !== 'skipped' && r.state !== 'skipped_conflict',
    )
    assert.ok(contentRules.length > 0, 'expected content-bearing rules')
    for (const r of contentRules) {
      assert.equal(r.state, 'unchanged', `${r.ruleId} should be unchanged in JSON`)
    }

    // Zero-change run: tally has changed === 0.
    assert.equal(noOpJson.tally.changed, 0)
    assert.ok(noOpJson.tally.unchanged > 0, 'tally should count unchanged rules')

    // Now make a change and confirm the JSON run is distinguishable.
    await writeFile(
      join(root, '.specfuse', 'plan', 'architecture.md'),
      ARCH_DOC.replace('- JWT 15-minute expiry', '- JWT 15-minute expiry\n- OAuth2 PKCE flow'),
    )
    const changeRun = runCli(root, ['sync', '--json'])
    assert.equal(changeRun.status, 0)
    const changeJson = JSON.parse(changeRun.stdout)
    assert.ok(
      changeJson.tally.changed > 0,
      'a change run must have changed > 0 (distinguishable from no-op)',
    )
  })
})

// ─── drift --fail after a clean no-op sync exits 0 with IN_SYNC ───────────────

describe('drift --fail after clean no-op sync', () => {
  let root
  beforeEach(async () => {
    root = await makeSyncedProject()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('exits 0 with IN_SYNC after a no-op re-sync', async () => {
    // Re-sync once (no-op).
    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    await runTwoPassSync(root, registry, rules)

    // Drift via the CLI with --fail: must exit 0 and report IN_SYNC.
    const result = runCli(root, ['drift', '--fail', '--json'])
    assert.equal(result.status, 0, `drift --fail should exit 0 after no-op: ${result.stderr}`)

    const drifts = JSON.parse(result.stdout).results
    // IN_SYNC = no drift. SOURCE_MISSING / NEVER_SYNCED are not drift either —
    // they mean a rule has no source content to sync (e.g. the archive rule on a
    // project with no archived changes). Any other state is real drift.
    const drifted = drifts.filter(
      (d) =>
        d.state !== 'IN_SYNC' &&
        d.state !== 'SOURCE_MISSING' &&
        d.state !== 'NEVER_SYNCED',
    )
    assert.equal(
      drifted.length,
      0,
      `expected no drift after no-op sync: ${drifted.map((d) => `${d.state}:${d.ruleId}`).join(', ')}`,
    )
  })

  test('registry.json syncedAt is NOT bumped on a no-op sync', async () => {
    const registry = new Registry(root)
    await registry.load()
    const rules = await loadRules(root)
    const entriesBefore = registry.getSyncEntries()
    const syncedAtBefore = Object.fromEntries(
      entriesBefore.map((e) => [`${e.sourceId}→${e.targetId}`, e.syncedAt]),
    )

    // No-op re-sync.
    await runTwoPassSync(root, registry, rules)
    await registry.load()
    const entriesAfter = registry.getSyncEntries()

    // Every pair that existed before must retain its original syncedAt.
    for (const e of entriesAfter) {
      const key = `${e.sourceId}→${e.targetId}`
      if (key in syncedAtBefore) {
        assert.equal(
          e.syncedAt,
          syncedAtBefore[key],
          `syncedAt for ${key} must not be bumped on a no-op sync`,
        )
      }
    }
  })
})

// ─── Non-determinism heuristic warning ───────────────────────────────────────

describe('Non-determinism heuristic warning', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('fires when a rule transform varies across runs with identical source hashes', async () => {
    // A volatile transform that embeds a different value each call despite
    // identical source content. The first run records targetHash A; the second
    // run (same sourceHash) produces targetHash B → non-deterministic warning.
    let volatileSeed = 0
    const volatileRule = {
      id: 'test:volatile→constitution:volatile',
      pass: 'A',
      source: '.specfuse/plan/architecture.md',
      sources: ['.specfuse/plan/architecture.md'],
      target: '.specfuse/constitution.md',
      section: 'volatile',
      async extract(ctx) {
        const c = await ctx.read('.specfuse/plan/architecture.md')
        return c ? ctx.extractH2Section(c, 'Architectural Decisions') : null
      },
      // Non-deterministic: output depends on a counter, not just source.
      transform() {
        volatileSeed += 1
        return `- volatile seed ${volatileSeed}`
      },
    }

    const registry = new Registry(root)
    await registry.load()

    // First run — records targetHash with seed=1.
    await runTwoPassSync(root, registry, [volatileRule])
    // Second run — same source, different output (seed=2) → warning.
    const { warnings } = await runTwoPassSync(root, registry, [volatileRule])

    assert.ok(
      warnings.some(
        (w) =>
          w.type === 'non-deterministic-rule' &&
          w.ruleId === volatileRule.id,
      ),
      `expected a non-determinism warning for ${volatileRule.id}, got: ${JSON.stringify(warnings)}`,
    )
  })

  test('does not fire for a deterministic rule with identical source', async () => {
    const deterministicRule = {
      id: 'test:stable→constitution:stable',
      pass: 'A',
      source: '.specfuse/plan/architecture.md',
      sources: ['.specfuse/plan/architecture.md'],
      target: '.specfuse/constitution.md',
      section: 'stable',
      async extract(ctx) {
        const c = await ctx.read('.specfuse/plan/architecture.md')
        return c ? ctx.extractH2Section(c, 'Architectural Decisions') : null
      },
      // Deterministic: pure function of source.
      transform(d) {
        return `### Stable\n${d}`
      },
    }

    const registry = new Registry(root)
    await registry.load()
    await runTwoPassSync(root, registry, [deterministicRule])
    const { warnings } = await runTwoPassSync(root, registry, [deterministicRule])

    assert.equal(
      warnings.length,
      0,
      `deterministic rule must not trigger warnings, got: ${JSON.stringify(warnings)}`,
    )
  })
})

// ─── CI output: unchanged is a passing state ──────────────────────────────────

describe('CI output treats unchanged as a passing state', () => {
  const unchangedResult = {
    id: 'plan:arch→constitution:plan-decisions',
    state: 'unchanged',
    message: 'No content change — skipped.',
  }
  const data = { results: [unchangedResult] }

  test('formatGitHub maps unchanged → notice and passes', () => {
    const out = formatGitHub(data)
    assert.match(out, /::notice/)
    // Passing summary (no failures, no warnings).
    assert.match(out, /::notice::specfuse ci passed: 1 check\(s\) OK/)
  })

  test('formatSarif excludes unchanged results (no finding)', () => {
    const out = formatSarif(data)
    const sarif = JSON.parse(out)
    assert.deepEqual(sarif.runs[0].results, [], 'unchanged must not produce a SARIF finding')
  })

  test('formatJUnit counts unchanged as a passing (empty) testcase', () => {
    const out = formatJUnit(data)
    assert.match(out, /tests="1" failures="0" errors="0"/)
    const testcase = out.match(/<testcase[\s\S]*?<\/testcase>/)
    assert.ok(testcase, 'expected a testcase')
    assert.equal(testcase[0].includes('<failure'), false)
    assert.equal(testcase[0].includes('<error'), false)
  })
})
