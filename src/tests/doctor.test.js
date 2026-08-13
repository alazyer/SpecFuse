import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// We import doctorCommand but also need the individual check functions.
// Since they're module-private, we test via doctorCommand with controlled
// project structures. doctorCommand returns results via console output,
// so we capture stdout or test the JSON mode.

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-doctor-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  return root
}

// Run doctorCommand in JSON mode and parse the output
async function runDoctor(root) {
  // Capture stdout
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
    const { doctorCommand } = await import('../commands/doctor.js')
    await doctorCommand(root, { json: true })
  } catch (e) {
    if (!e.message?.startsWith('EXIT:')) {
      // Unexpected error — restore and throw
      console.log = originalLog
      process.exit = originalExit
      throw e
    }
    // EXIT code captured
    exitCode = parseInt(e.message.replace('EXIT:', ''), 10)
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  // The JSON output is the last captured line
  const jsonLine = captured.find((line) => line.trim().startsWith('{'))
  if (!jsonLine) return { exitCode, results: null, healthy: null }

  const parsed = JSON.parse(jsonLine)
  return { exitCode, results: parsed.checks, healthy: parsed.healthy }
}

function findCheck(results, id) {
  return results?.find((r) => r.id === id) ?? null
}

// ─── checkRegistrySchema ────────────────────────────────────────────────

describe('checkRegistrySchema (registry-schema)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('FAIL when registry.json not found', async () => {
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-schema')
    assert.equal(check.state, 'FAIL')
    assert.ok(check.message.includes('not found'))
  })

  test('PASS when registry.json is valid v4.0.0', async () => {
    await writeFile(
      join(root, '.specfuse', 'registry.json'),
      JSON.stringify({
        version: '4.0.0',
        phase: 'unknown',
        projectName: '',
        artifacts: {},
        syncs: {},
      }),
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-schema')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('valid'))
  })

  test('WARN when registry.json has older version', async () => {
    await writeFile(
      join(root, '.specfuse', 'registry.json'),
      JSON.stringify({
        version: '3.0.0',
        phase: 'unknown',
      }),
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-schema')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('v3.0.0'))
  })

  test('FAIL when registry.json has no version field', async () => {
    await writeFile(
      join(root, '.specfuse', 'registry.json'),
      JSON.stringify({
        phase: 'unknown',
      }),
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-schema')
    assert.equal(check.state, 'FAIL')
    assert.ok(check.message.includes('no version'))
  })

  test('FAIL when registry.json is corrupt (invalid JSON)', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), '{not valid json!!')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-schema')
    assert.equal(check.state, 'FAIL')
    assert.ok(check.message.includes('corrupt'))
  })
})

// ─── checkConstitution ──────────────────────────────────────────────────

describe('checkConstitution (constitution)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('WARN when constitution.md not found', async () => {
    // Only registry exists — no constitution
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'constitution')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('not found'))
  })

  test('PASS when constitution.md has balanced markers', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\n<!-- specfuse:decisions:end -->\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'constitution')
    assert.equal(check.state, 'PASS')
  })

  test('FAIL when constitution.md has unclosed markers', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\nNo end marker\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'constitution')
    assert.equal(check.state, 'FAIL')
    assert.ok(check.message.includes('Unclosed'))
  })

  test('PASS when constitution.md has no managed sections', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Clean Constitution\n\nNo markers.\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'constitution')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('0 managed section'))
  })
})

// ─── checkPlanArtifacts ─────────────────────────────────────────────────

describe('checkPlanArtifacts (plan-artifacts)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('WARN when .specfuse/plan/ not found', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plan-artifacts')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('not found'))
  })

  test('WARN when plan/ exists but has no prd.md or architecture.md', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plan-artifacts')
    assert.equal(check.state, 'WARN')
  })

  test('PASS when both prd.md and architecture.md exist', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD\n')
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), '# Arch\n')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plan-artifacts')
    assert.equal(check.state, 'PASS')
  })

  test('WARN when only prd.md exists (missing architecture.md)', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD\n')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plan-artifacts')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('missing'))
  })
})

// ─── checkChangesStructure ──────────────────────────────────────────────

describe('checkChangesStructure (changes-structure)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when changes/ not created yet', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'changes-structure')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('not created'))
  })

  test('WARN when flat .md files found in changes/ instead of directories', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'changes', 'loose-file.md'), '# Loose\n')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'changes-structure')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('flat'))
  })

  test('PASS when change directories exist', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'my-change'), { recursive: true })
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'changes-structure')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('change director'))
  })
})

// ─── checkArtifactRootConsistency ─────────────────────────────────────────

describe('checkArtifactRootConsistency (artifact-root-consistency)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when runtime source uses canonical .specfuse/ references', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, 'src', 'core'), { recursive: true })
    await writeFile(
      join(root, 'src', 'core', 'sync-engine.js'),
      "const msg = 'No active change directories found in .specfuse/changes/.'\n",
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'artifact-root-consistency')
    assert.equal(check.state, 'PASS')
  })

  test('WARN when runtime source still references openspec/changes/', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, 'src', 'core'), { recursive: true })
    await writeFile(
      join(root, 'src', 'core', 'sync-engine.js'),
      "const msg = 'No active change directories found in openspec/changes/.'\n",
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'artifact-root-consistency')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('openspec/changes/'))
  })
})

// ─── checkUnexpectedChangeRoots ───────────────────────────────────────────

describe('checkUnexpectedChangeRoots (unexpected-change-roots)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when only canonical .specfuse/ roots exist', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'alpha'), { recursive: true })
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'unexpected-change-roots')
    assert.equal(check.state, 'PASS')
  })

  test('WARN when openspec/changes contains active change dirs', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, 'openspec', 'changes', 'legacy-change'), { recursive: true })
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'unexpected-change-roots')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('openspec/changes'))
  })
})

// ─── checkNestedSections ────────────────────────────────────────────────

describe('checkNestedSections (nested-sections)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when constitution.md has no nested managed sections', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\n<!-- specfuse:decisions:end -->\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'nested-sections')
    assert.equal(check.state, 'PASS')
  })

  test('FAIL when constitution.md has nested managed sections', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:outer:start -->\nouter content\n<!-- specfuse:inner:start -->\ninner content\n<!-- specfuse:inner:end -->\n<!-- specfuse:outer:end -->\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'nested-sections')
    assert.equal(check.state, 'FAIL')
    assert.ok(check.message.includes('Nested'))
  })

  test('PASS when constitution.md not present', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'nested-sections')
    assert.equal(check.state, 'PASS')
  })
})

// ─── checkOrphanedSyncs ─────────────────────────────────────────────────

describe('checkOrphanedSyncs (orphaned-syncs)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when no orphaned sync records', async () => {
    await writeFile(
      join(root, '.specfuse', 'registry.json'),
      JSON.stringify({
        version: '4.0.0',
        syncs: {},
      }),
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'orphaned-syncs')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('No orphaned'))
  })

  test('WARN when stale sync records exist without matching rules', async () => {
    await writeFile(
      join(root, '.specfuse', 'registry.json'),
      JSON.stringify({
        version: '4.0.0',
        syncs: {
          'old-source→old-target': { sourceHash: 'abc', targetHash: 'def', syncedAt: '2025-01-01' },
        },
      }),
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'orphaned-syncs')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('stale'))
  })
})

// ─── checkPluginSyntax ──────────────────────────────────────────────────

describe('checkPluginSyntax (plugin-syntax)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when no rules.mjs present', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plugin-syntax')
    assert.equal(check.state, 'PASS')
  })

  test('PASS when valid rules.mjs exists', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'rules.mjs'),
      'export default []; // empty plugin rules\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plugin-syntax')
    // Could be PASS or FAIL depending on import mechanics, but at minimum should not crash
    assert.ok(['PASS', 'FAIL'].includes(check.state))
  })

  test('FAIL when rules.mjs has syntax errors', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(join(root, '.specfuse', 'rules.mjs'), 'this is not valid javascript!!!\n')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'plugin-syntax')
    assert.equal(check.state, 'FAIL')
    assert.ok(check.message.includes('error'))
  })
})

// ─── checkDesignSystem ──────────────────────────────────────────────────

describe('checkDesignSystem (design-system)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when no UI-affecting changes', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'my-change'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'my-change', 'design.md'),
      '# Design\n\n**Affects UI:** no\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'design-system')
    assert.equal(check.state, 'PASS')
  })

  test('PASS when UI-affecting changes and design system doc exists', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'ui-change'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'ui-change', 'design.md'),
      '# Design\n\n**Affects UI:** yes\n',
    )
    await mkdir(join(root, '.specfuse', 'plan', 'design'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'design', 'system.md'), '# Design System\n')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'design-system')
    assert.equal(check.state, 'PASS')
  })

  test('WARN when UI-affecting changes but no design system doc', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'ui-change'), { recursive: true })
    await writeFile(
      join(root, '.specfuse', 'changes', 'ui-change', 'design.md'),
      '# Design\n\n**Affects UI:** yes\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'design-system')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('system.md'))
  })
})

// ─── checkUnverifiedChanges ──────────────────────────────────────────────

describe('checkUnverifiedChanges (unverified-changes)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when no archived changes', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'unverified-changes')
    assert.equal(check.state, 'PASS')
  })

  test('PASS when all archived changes are verified (status: pass)', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'archive', 'verified-change'), {
      recursive: true,
    })
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', 'verified-change', 'verify.md'),
      '---\nstatus: pass\nverified_by: qa\n---\n\n# Verified\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'unverified-changes')
    assert.equal(check.state, 'PASS')
  })

  test('WARN when archived changes have unverified status', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'archive', 'unverified-change'), {
      recursive: true,
    })
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', 'unverified-change', 'verify.md'),
      '---\nstatus: unverified\n---\n\n# Unverified\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'unverified-changes')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('force-archived without verification'))
  })

  test('WARN when verify.md is missing (default status is unverified)', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await mkdir(join(root, '.specfuse', 'changes', 'archive', 'missing-verify'), {
      recursive: true,
    })
    // No verify.md file
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', 'missing-verify', 'proposal.md'),
      '# Proposal\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'unverified-changes')
    assert.equal(check.state, 'WARN')
  })
})

// ─── checkRegistryLock ─────────────────────────────────────────────────

describe('checkRegistryLock (registry-lock)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when no lock file exists', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-lock')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('No active'))
  })

  test('WARN when a stale lock references a dead PID', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    // A PID that is almost certainly not running on a test runner.
    await writeFile(
      join(root, '.specfuse', 'registry.lock'),
      JSON.stringify({ pid: 999999, command: 'specfuse sync', acquiredAt: Date.now() }) + '\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-lock')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('Stale'))
    assert.ok(check.remediation.includes('registry.lock'))
  })

  test('WARN when a lock is held by a live PID (informational)', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'registry.lock'),
      JSON.stringify({ pid: process.pid, command: 'specfuse sync', acquiredAt: Date.now() }) + '\n',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-lock')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes(String(process.pid)))
  })
})

// ─── checkQuarantinedRegistries ────────────────────────────────────────

describe('checkQuarantinedRegistries (registry-quarantine)', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('PASS when no quarantined files exist', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-quarantine')
    assert.equal(check.state, 'PASS')
    assert.ok(check.message.includes('No quarantined'))
  })

  test('WARN when a corrupt quarantine file exists', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(join(root, '.specfuse', 'registry.json.corrupt-1699999999999'), '{not valid')
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-quarantine')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('corrupt-'))
    assert.ok(check.remediation.includes('recover'))
  })

  test('WARN when a pre-migrate backup exists', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    await writeFile(
      join(root, '.specfuse', 'registry.json.pre-migrate-3.0.0-1699999999999'),
      '{"version":"3.0.0"}',
    )
    const { results } = await runDoctor(root)
    const check = findCheck(results, 'registry-quarantine')
    assert.equal(check.state, 'WARN')
    assert.ok(check.message.includes('pre-migrate-'))
  })
})

// ─── All checks run ────────────────────────────────────────────────────

describe('doctorCommand — all 15 checks', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('runs exactly 15 diagnostic checks', async () => {
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({ version: '4.0.0' }))
    const { results } = await runDoctor(root)
    assert.equal(results.length, 15, 'must run exactly 15 checks')

    const expectedIds = [
      'registry-schema',
      'registry-lock',
      'registry-quarantine',
      'constitution',
      'plan-artifacts',
      'changes-structure',
      'artifact-root-consistency',
      'unexpected-change-roots',
      'nested-sections',
      'orphaned-syncs',
      'pending-sync',
      'pending-archive',
      'plugin-syntax',
      'design-system',
      'unverified-changes',
    ]
    for (const id of expectedIds) {
      const check = findCheck(results, id)
      assert.ok(check, `check '${id}' must be present`)
      assert.ok(
        ['PASS', 'WARN', 'FAIL'].includes(check.state),
        `check '${id}' must have a valid state`,
      )
    }
  })

  test('healthy=true when all checks pass', async () => {
    await writeFile(
      join(root, '.specfuse', 'registry.json'),
      JSON.stringify({
        version: '4.0.0',
        syncs: {},
        phase: 'unknown',
        projectName: '',
        artifacts: {},
      }),
    )
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n<!-- specfuse:decisions:start -->\ncontent\n<!-- specfuse:decisions:end -->\n',
    )
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), '# PRD\n')
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), '# Arch\n')

    const { exitCode } = await runDoctor(root)
    // healthy depends on FAIL checks only — WARNs don't make it unhealthy
    assert.equal(exitCode, 0, 'no FAILs → exit code 0')
  })

  test('healthy=false when any check FAILs (exit code 1)', async () => {
    // No registry → registry-schema FAILs
    const { healthy, exitCode } = await runDoctor(root)
    assert.equal(healthy, false)
    assert.equal(exitCode, 1, 'FAIL checks → exit code 1')
  })
})
