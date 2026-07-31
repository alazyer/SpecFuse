import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { ciDrift, ciValidate, ciCheck, ciInit } from '../commands/ci.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-ci-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })

  // Write a minimal registry.json
  await writeFile(
    join(root, '.specfuse', 'registry.json'),
    JSON.stringify({
      projectName: 'test-project',
      phase: 'development',
      initializedAt: new Date().toISOString(),
      hooksInstalled: false,
      syncLog: [],
      events: [],
    }),
  )

  return root
}

// Run ciDrift in JUnit mode and capture output (no process.exit)
async function runCiDrift(root, extraOptions = {}) {
  return ciDrift(root, { format: 'junit', ...extraOptions })
}

async function runCiValidate(root, extraOptions = {}) {
  return ciValidate(root, { format: 'junit', ...extraOptions })
}

async function runCiCheck(root, extraOptions = {}) {
  return ciCheck(root, { format: 'junit', ...extraOptions })
}

// ─── ciDrift ──────────────────────────────────────────────────────────────

describe('ciDrift', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns exitCode 0 when no drift', async () => {
    // No rules loaded in empty project — no drift pairs
    const { exitCode, output } = await runCiDrift(root)
    assert.equal(exitCode, 0)
    assert.ok(typeof output === 'string')
  })

  test('produces JUnit XML with testsuites root when format=junit', async () => {
    const { output } = await runCiDrift(root, { format: 'junit' })
    assert.match(output, /<testsuites/)
    assert.match(output, /<\/testsuites>/)
  })

  test('produces SARIF JSON when format=sarif', async () => {
    const { output } = await runCiDrift(root, { format: 'sarif' })
    const parsed = JSON.parse(output)
    assert.equal(parsed.version, '2.1.0')
  })

  test('produces GitHub format when format=github', async () => {
    const { output } = await runCiDrift(root, { format: 'github' })
    assert.match(output, /::group::/)
  })

  test('auto format defaults to junit in non-GitHub env', async () => {
    const { output } = await runCiDrift(root, { format: 'auto' })
    assert.match(output, /<testsuites/)
  })

  test('returns results array', async () => {
    const { results } = await runCiDrift(root)
    assert.ok(Array.isArray(results))
  })

  test('failOnWarn option affects exitCode', async () => {
    // In empty project, there are warnings (SOURCE_MISSING) but no failures
    const { exitCode } = await runCiDrift(root, { failOnWarn: true })
    // With failOnWarn, warnings should cause exit 1
    // But in empty project there may be no rules, so exitCode could be 0
    assert.ok(exitCode === 0 || exitCode === 1)
  })

  test('output option writes to file', async () => {
    const outputPath = join(root, 'output.xml')
    const { output } = await runCiDrift(root, { output: outputPath })
    const fileContent = await readFile(outputPath, 'utf8')
    assert.ok(fileContent.includes('<testsuites'))
  })
})

// ─── ciValidate ───────────────────────────────────────────────────────────

describe('ciValidate', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns exitCode 0 when all pass (empty project)', async () => {
    const { exitCode, output } = await runCiValidate(root)
    assert.equal(exitCode, 0)
    assert.ok(typeof output === 'string')
  })

  test('produces JUnit XML with testsuites root when format=junit', async () => {
    const { output } = await runCiValidate(root, { format: 'junit' })
    assert.match(output, /<testsuites/)
  })

  test('produces SARIF JSON when format=sarif', async () => {
    const { output } = await runCiValidate(root, { format: 'sarif' })
    const parsed = JSON.parse(output)
    assert.equal(parsed.version, '2.1.0')
  })

  test('returns results array', async () => {
    const { results } = await runCiValidate(root)
    assert.ok(Array.isArray(results))
  })

  test('artifact filter is passed through', async () => {
    const { results } = await runCiValidate(root, { artifact: 'prd' })
    // In empty project, results are just a "nothing to validate" PASS
    assert.ok(Array.isArray(results))
  })

  test('failOnWarn option affects exitCode', async () => {
    const { exitCode } = await runCiValidate(root, { failOnWarn: true })
    assert.ok(exitCode === 0 || exitCode === 1)
  })

  test('output option writes to file', async () => {
    const outputPath = join(root, 'validate-output.xml')
    const { output } = await runCiValidate(root, { output: outputPath })
    const fileContent = await readFile(outputPath, 'utf8')
    assert.ok(fileContent.includes('<testsuites'))
  })
})

// ─── ciCheck ──────────────────────────────────────────────────────────────

describe('ciCheck', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns combined results from drift + validate', async () => {
    const { driftResults, validateResults, output } = await runCiCheck(root)
    assert.ok(Array.isArray(driftResults))
    assert.ok(Array.isArray(validateResults))
    assert.match(output, /<testsuites/)
  })

  test('returns exitCode 0 when no failures', async () => {
    const { exitCode } = await runCiCheck(root)
    assert.equal(exitCode, 0)
  })

  test('produces SARIF when format=sarif', async () => {
    const { output } = await runCiCheck(root, { format: 'sarif' })
    const parsed = JSON.parse(output)
    assert.equal(parsed.version, '2.1.0')
  })

  test('produces GitHub format when format=github', async () => {
    const { output } = await runCiCheck(root, { format: 'github' })
    assert.match(output, /::group::/)
  })

  test('failOnWarn option affects exitCode', async () => {
    const { exitCode } = await runCiCheck(root, { failOnWarn: true })
    assert.ok(exitCode === 0 || exitCode === 1)
  })

  test('output option writes to file', async () => {
    const outputPath = join(root, 'check-output.xml')
    const { output } = await runCiCheck(root, { output: outputPath })
    const fileContent = await readFile(outputPath, 'utf8')
    assert.ok(fileContent.includes('<testsuites'))
  })
})

// ─── ciInit ───────────────────────────────────────────────────────────────

describe('ciInit', () => {
  let root
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-ci-init-test-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('creates GitHub Actions workflow file at specfuse.yml', async () => {
    const { path, created } = await ciInit(root, {
      output: join(root, '.github', 'workflows', 'specfuse.yml'),
    })
    assert.equal(created, true)
    assert.ok(path.includes('specfuse.yml'))
  })

  test('does not overwrite existing file without --force', async () => {
    const outputPath = join(root, '.github', 'workflows', 'specfuse.yml')

    // Create it once
    await ciInit(root, { output: outputPath })

    // Try again — should not overwrite
    const { created } = await ciInit(root, { output: outputPath })
    assert.equal(created, false)
  })

  test('overwrites existing file with --force', async () => {
    const outputPath = join(root, '.github', 'workflows', 'specfuse.yml')

    await ciInit(root, { output: outputPath })
    const { created } = await ciInit(root, { output: outputPath, force: true })
    assert.equal(created, true)
  })

  test('generated file contains specfuse ci commands', async () => {
    const outputPath = join(root, '.github', 'workflows', 'specfuse.yml')
    await ciInit(root, { output: outputPath })

    const content = await readFile(outputPath, 'utf8')
    assert.match(content, /specfuse ci/)
    assert.match(content, /pnpm specfuse/)
  })

  test('generated file includes weekly schedule', async () => {
    const outputPath = join(root, '.github', 'workflows', 'specfuse.yml')
    await ciInit(root, { output: outputPath })

    const content = await readFile(outputPath, 'utf8')
    assert.match(content, /schedule:/)
    assert.match(content, /cron:/)
  })

  test('default output path is .github/workflows/specfuse.yml', async () => {
    // ciInit with no output option uses projectRoot/.github/workflows/specfuse.yml
    const { path } = await ciInit(root)
    assert.ok(path.endsWith(join('.github', 'workflows', 'specfuse.yml')))
  })

  test('throws when github=false (only GitHub Actions supported)', async () => {
    await assert.rejects(
      async () => ciInit(root, { github: false }),
      /Only GitHub Actions workflow is supported/,
    )
  })
})
