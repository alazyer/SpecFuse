/**
 * Tests for unified configuration management.
 *
 * Covers: loadConfig, getConfigValue, setConfigValue, validateConfig,
 * configPaths, listSchema, type coercion, read-only enforcement,
 * validation constraints, and migration.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  validateConfig,
  configPaths,
  listSchema,
} from '../core/config-manager.js'

import { ConfigError } from '../api/errors.mjs'
import { SpecFuseApiError } from '../api/errors.mjs'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MINIMAL_REGISTRY = {
  version: '4.0.0',
  phase: 'planning',
  projectName: 'TestProject',
  artifacts: {},
  syncs: {},
  traces: {},
  history: [],
  maxHistory: 100,
  loadedRules: [],
  hooksInstalled: true,
  initializedAt: '2026-01-01T00:00:00.000Z',
}

const MINIMAL_SCHEMA = {
  version: 1,
  artifacts: {
    'change.*': { instructions: ['Keep concise.'] },
  },
}

let tempDir

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTempProject(registryOverrides = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'specfuse-config-test-'))
  await mkdir(join(tempDir, '.specfuse'), { recursive: true })

  const registry = { ...MINIMAL_REGISTRY, ...registryOverrides }
  await writeFile(join(tempDir, '.specfuse', 'registry.json'), JSON.stringify(registry, null, 2))
  await writeFile(join(tempDir, '.specfuse', 'artifact-schema.json'), JSON.stringify(MINIMAL_SCHEMA, null, 2))

  return tempDir
}

async function cleanupTemp() {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
}

// ─── Error Classes ───────────────────────────────────────────────────────────

describe('ConfigError class', () => {
  test('ConfigError is instance of SpecFuseApiError and Error', () => {
    const err = new ConfigError('bad key', { key: 'foo.bar', value: 42 })
    assert.ok(err instanceof Error)
    assert.ok(err instanceof SpecFuseApiError)
    assert.ok(err instanceof ConfigError)
    assert.equal(err.name, 'ConfigError')
    assert.equal(err.key, 'foo.bar')
    assert.equal(err.value, 42)
  })

  test('ConfigError defaults key and value to null', () => {
    const err = new ConfigError('something broke')
    assert.equal(err.key, null)
    assert.equal(err.value, null)
  })
})

// ─── loadConfig ──────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  beforeEach(createTempProject)
  afterEach(cleanupTemp)

  test('loads registry section from registry.json', async () => {
    const config = await loadConfig(tempDir)
    assert.equal(config.registry.phase, 'planning')
    assert.equal(config.registry.projectName, 'TestProject')
    assert.equal(config.registry.hooksInstalled, true)
    assert.equal(config.registry.maxHistory, 100)
  })

  test('loads schema section from artifact-schema.json', async () => {
    const config = await loadConfig(tempDir)
    assert.equal(config.schema.version, 1)
    assert.ok(config.schema.artifacts)
    assert.ok('change.*' in config.schema.artifacts)
  })

  test('reports no plugins when .specfuse/rules.mjs is absent', async () => {
    const config = await loadConfig(tempDir)
    assert.equal(config.rules.plugins, false)
    assert.equal(config.rules.pluginCount, 0)
    assert.deepEqual(config.rules.pluginIds, [])
  })

  test('reports plugins=true when .specfuse/rules.mjs exists', async () => {
    await writeFile(join(tempDir, '.specfuse', 'rules.mjs'), 'export default [];')
    const config = await loadConfig(tempDir)
    assert.equal(config.rules.plugins, true)
    // Empty export = 0 plugin rules
    assert.equal(config.rules.pluginCount, 0)
    assert.deepEqual(config.rules.pluginIds, [])
  })

  test('handles missing registry.json gracefully (fresh project)', async () => {
    await rm(join(tempDir, '.specfuse', 'registry.json'))
    const config = await loadConfig(tempDir)
    // Fresh registry defaults
    assert.equal(config.registry.phase, 'unknown')
    assert.equal(config.registry.projectName, '')
    assert.equal(config.registry.hooksInstalled, false)
    assert.equal(config.registry.maxHistory, 100) // migration default
  })

  test('handles missing artifact-schema.json gracefully', async () => {
    await rm(join(tempDir, '.specfuse', 'artifact-schema.json'))
    const config = await loadConfig(tempDir)
    assert.equal(config.schema.version, 1) // default
    assert.deepEqual(config.schema.artifacts, {})
  })
})

// ─── getConfigValue ──────────────────────────────────────────────────────────

describe('getConfigValue', () => {
  let config

  beforeEach(async () => {
    await createTempProject()
    config = await loadConfig(tempDir)
  })
  afterEach(cleanupTemp)

  test('returns value for valid registry key', () => {
    const result = getConfigValue(config, 'registry.phase')
    assert.ok(result.ok)
    assert.equal(result.value, 'planning')
    assert.equal(result.source, 'registry')
    assert.equal(result.mutable, true)
  })

  test('returns value for valid schema key', () => {
    const result = getConfigValue(config, 'schema.version')
    assert.ok(result.ok)
    assert.equal(result.value, 1)
    assert.equal(result.source, 'schema')
    assert.equal(result.mutable, false)
  })

  test('returns value for valid rules key', () => {
    const result = getConfigValue(config, 'rules.plugins')
    assert.ok(result.ok)
    assert.equal(result.value, false)
    assert.equal(result.source, 'rules')
    assert.equal(result.mutable, false)
  })

  test('returns error for unknown key', () => {
    const result = getConfigValue(config, 'nonexistent.key')
    assert.ok(!result.ok)
    assert.ok(result.error.includes('Unknown config key'))
  })

  test('returns mutable=true for registry keys', () => {
    for (const key of ['registry.phase', 'registry.projectName', 'registry.hooksInstalled', 'registry.maxHistory']) {
      const result = getConfigValue(config, key)
      assert.ok(result.ok)
      assert.equal(result.mutable, true, `${key} should be mutable`)
    }
  })

  test('returns mutable=false for schema and rules keys', () => {
    for (const key of ['schema.version', 'schema.artifacts', 'rules.plugins', 'rules.pluginCount', 'rules.pluginIds']) {
      const result = getConfigValue(config, key)
      assert.ok(result.ok)
      assert.equal(result.mutable, false, `${key} should be read-only`)
    }
  })
})

// ─── setConfigValue ──────────────────────────────────────────────────────────

describe('setConfigValue', () => {
  beforeEach(createTempProject)
  afterEach(cleanupTemp)

  test('sets a mutable string key', async () => {
    const result = await setConfigValue(tempDir, 'registry.phase', 'maintenance')
    assert.ok(result.ok)
    assert.equal(result.key, 'registry.phase')
    assert.equal(result.value, 'maintenance')

    // Verify persistence
    const config = await loadConfig(tempDir)
    assert.equal(config.registry.phase, 'maintenance')
  })

  test('sets a mutable number key with string coercion', async () => {
    const result = await setConfigValue(tempDir, 'registry.maxHistory', '200')
    assert.ok(result.ok)
    assert.equal(result.value, 200)
    assert.equal(typeof result.value, 'number')

    const config = await loadConfig(tempDir)
    assert.equal(config.registry.maxHistory, 200)
  })

  test('sets a mutable boolean key with string coercion', async () => {
    const result = await setConfigValue(tempDir, 'registry.hooksInstalled', 'true')
    assert.ok(result.ok)
    assert.equal(result.value, true)

    const config = await loadConfig(tempDir)
    assert.equal(config.registry.hooksInstalled, true)
  })

  test('coerces "0" to false for boolean', async () => {
    const result = await setConfigValue(tempDir, 'registry.hooksInstalled', '0')
    assert.ok(result.ok)
    assert.equal(result.value, false)
  })

  test('coerces "1" to true for boolean', async () => {
    const result = await setConfigValue(tempDir, 'registry.hooksInstalled', '1')
    assert.ok(result.ok)
    assert.equal(result.value, true)
  })

  test('rejects setting a read-only key', async () => {
    const result = await setConfigValue(tempDir, 'schema.version', 2)
    assert.ok(!result.ok)
    assert.ok(result.error.includes('read-only'))
  })

  test('rejects setting rules.plugins (read-only)', async () => {
    const result = await setConfigValue(tempDir, 'rules.plugins', true)
    assert.ok(!result.ok)
    assert.ok(result.error.includes('read-only'))
  })

  test('rejects unknown config key', async () => {
    const result = await setConfigValue(tempDir, 'unknown.key', 'val')
    assert.ok(!result.ok)
    assert.ok(result.error.includes('Unknown config key'))
  })

  test('rejects invalid value for registry.phase', async () => {
    const result = await setConfigValue(tempDir, 'registry.phase', 'invalid-phase')
    assert.ok(!result.ok)
    assert.ok(result.error.includes('Must be one of'))
  })

  test('rejects non-integer for registry.maxHistory', async () => {
    const result = await setConfigValue(tempDir, 'registry.maxHistory', '3.5')
    assert.ok(!result.ok)
  })

  test('rejects zero for registry.maxHistory', async () => {
    const result = await setConfigValue(tempDir, 'registry.maxHistory', '0')
    assert.ok(!result.ok)
    assert.ok(result.error.includes('positive'))
  })

  test('rejects value > 1000 for registry.maxHistory', async () => {
    const result = await setConfigValue(tempDir, 'registry.maxHistory', '1001')
    assert.ok(!result.ok)
    assert.ok(result.error.includes('1000'))
  })

  test('accepts valid phase values', async () => {
    for (const phase of ['unknown', 'planning', 'feature-dev', 'maintenance']) {
      const result = await setConfigValue(tempDir, 'registry.phase', phase)
      assert.ok(result.ok, `phase "${phase}" should be accepted`)
      assert.equal(result.value, phase)
    }
  })

  test('rejects setting object/array type keys (read-only)', async () => {
    const result = await setConfigValue(tempDir, 'schema.artifacts', 'val')
    assert.ok(!result.ok)
    // schema.artifacts is read-only, so the read-only guard fires first
    assert.ok(result.error.includes('read-only'))
  })

  test('non-string values pass through without coercion', async () => {
    const result = await setConfigValue(tempDir, 'registry.maxHistory', 50)
    assert.ok(result.ok)
    assert.equal(result.value, 50)
  })
})

// ─── validateConfig ──────────────────────────────────────────────────────────

describe('validateConfig', () => {
  let config

  beforeEach(async () => {
    await createTempProject()
    config = await loadConfig(tempDir)
  })
  afterEach(cleanupTemp)

  test('returns valid=true for a correct config', () => {
    const result = validateConfig(config)
    assert.ok(result.valid)
    assert.deepEqual(result.errors, [])
  })

  test('detects invalid registry.phase', () => {
    config.registry.phase = 'not-a-phase'
    const result = validateConfig(config)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.key === 'registry.phase'))
  })

  test('detects invalid registry.maxHistory (zero)', () => {
    config.registry.maxHistory = 0
    const result = validateConfig(config)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.key === 'registry.maxHistory'))
  })

  test('detects invalid registry.maxHistory (too large)', () => {
    config.registry.maxHistory = 2000
    const result = validateConfig(config)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.key === 'registry.maxHistory'))
  })

  test('detects invalid registry.maxHistory (non-integer)', () => {
    config.registry.maxHistory = 3.7
    const result = validateConfig(config)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.key === 'registry.maxHistory'))
  })

  test('collects multiple errors at once', () => {
    config.registry.phase = 'invalid'
    config.registry.maxHistory = -1
    const result = validateConfig(config)
    assert.ok(!result.valid)
    assert.ok(result.errors.length >= 2)
  })
})

// ─── configPaths ─────────────────────────────────────────────────────────────

describe('configPaths', () => {
  test('returns absolute paths for all three config sources', () => {
    const paths = configPaths('/project')
    assert.equal(paths.registry, '/project/.specfuse/registry.json')
    assert.equal(paths.schema, '/project/.specfuse/artifact-schema.json')
    assert.equal(paths.rules, '/project/.specfuse/rules.mjs')
  })
})

// ─── listSchema ──────────────────────────────────────────────────────────────

describe('listSchema', () => {
  test('returns all known config keys with metadata', () => {
    const schema = listSchema()
    assert.ok(schema.length >= 9)

    const keys = schema.map((s) => s.key)
    assert.ok(keys.includes('registry.phase'))
    assert.ok(keys.includes('registry.projectName'))
    assert.ok(keys.includes('registry.hooksInstalled'))
    assert.ok(keys.includes('registry.maxHistory'))
    assert.ok(keys.includes('schema.version'))
    assert.ok(keys.includes('schema.artifacts'))
    assert.ok(keys.includes('rules.plugins'))
    assert.ok(keys.includes('rules.pluginCount'))
    assert.ok(keys.includes('rules.pluginIds'))
  })

  test('marks computed keys correctly', () => {
    const schema = listSchema()
    const plugins = schema.find((s) => s.key === 'rules.plugins')
    assert.ok(plugins.computed)
    const phase = schema.find((s) => s.key === 'registry.phase')
    assert.ok(!phase.computed)
  })
})

// ─── Migration ───────────────────────────────────────────────────────────────

describe('Migration', () => {
  test('registry without maxHistory gets default 100 on load', async () => {
    await createTempProject()
    // Remove maxHistory from registry
    const raw = JSON.parse(await readFile(join(tempDir, '.specfuse', 'registry.json'), 'utf8'))
    delete raw.maxHistory
    await writeFile(join(tempDir, '.specfuse', 'registry.json'), JSON.stringify(raw))

    const config = await loadConfig(tempDir)
    assert.equal(config.registry.maxHistory, 100)
  })

  test('existing maxHistory is preserved', async () => {
    await createTempProject({ maxHistory: 50 })
    const config = await loadConfig(tempDir)
    assert.equal(config.registry.maxHistory, 50)
  })

  test('existing phase is preserved during migration', async () => {
    await createTempProject({ phase: 'maintenance' })
    const config = await loadConfig(tempDir)
    assert.equal(config.registry.phase, 'maintenance')
  })
})
