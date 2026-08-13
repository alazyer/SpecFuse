import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-drift-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  return root
}

async function createMinimalRegistry(root) {
  // Create minimal valid registry.json so registry.load() doesn't fail
  await writeFile(
    join(root, '.specfuse', 'registry.json'),
    JSON.stringify({
      version: '4.0.0',
      phase: 'unknown',
      projectName: 'test-project',
      artifacts: {},
      syncs: {},
    }),
  )
}

async function createMixedRootsFixture(root) {
  // Create both native (.specfuse/changes) and governance (openspec/changes) roots
  // with active changes to trigger the MIXED_CHANGE_ROOTS warning (W1001)
  await mkdir(join(root, '.specfuse', 'changes', 'test-change-1'), { recursive: true })
  await writeFile(join(root, '.specfuse', 'changes', 'test-change-1', 'proposal.md'), '# Test Change 1')

  await mkdir(join(root, 'openspec', 'changes', 'test-change-2'), { recursive: true })
  await writeFile(join(root, 'openspec', 'changes', 'test-change-2', 'proposal.md'), '# Test Change 2')
}

// Run driftCommand and capture all output/errors
async function runDrift(root, options = {}) {
  const originalLog = console.log
  const captured = []
  console.log = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  let exitCode = 0
  const originalExit = process.exit
  process.exit = (code) => {
    exitCode = code
    // Don't throw for drift - we want to capture full execution
  }

  let error = null
  try {
    const { driftCommand } = await import('../commands/drift.js')
    await driftCommand(root, options)
  } catch (e) {
    error = e
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  return { captured, exitCode, error }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('driftCommand', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  describe('mixed artifact root diagnostics', () => {
    test('does not crash when mixed roots produce warnings (W1001)', async () => {
      // This reproduces the driftCount initialization-order bug:
      // ReferenceError: Cannot access 'driftCount' before initialization
      // at src/commands/drift.js:45
      await createMinimalRegistry(root)
      await createMixedRootsFixture(root)

      const { error, captured } = await runDrift(root, {})

      // Verify no crash occurred
      assert.equal(error, null, `driftCommand should not throw, got: ${error?.message}`)

      // Verify the mixed root diagnostic was actually reported
      const output = captured.join('\n')
      assert.match(output, /W1001/, 'should report MIXED_CHANGE_ROOTS warning code')
      assert.match(output, /WARNING/, 'should report WARNING severity')
      assert.match(output, /Active changes detected in both/, 'should contain diagnostic message')
    })

    test('does not crash on mixed roots with JSON output', async () => {
      await createMinimalRegistry(root)
      await createMixedRootsFixture(root)

      const { error, captured } = await runDrift(root, { json: true })

      assert.equal(error, null, `driftCommand should not throw in JSON mode, got: ${error?.message}`)

      // Verify JSON output is valid and contains diagnostics
      const jsonLine = captured.find((line) => line.trim().startsWith('{'))
      assert.ok(jsonLine, 'should output JSON')
      const parsed = JSON.parse(jsonLine)
      assert.ok(parsed.artifactRoots, 'should include artifactRoots in JSON output')
      assert.ok(parsed.artifactRoots.diagnostics.length > 0, 'should include diagnostics')
      assert.equal(
        parsed.artifactRoots.diagnostics[0].code,
        'W1001',
        'should report MIXED_CHANGE_ROOTS warning',
      )
    })
  })
})
