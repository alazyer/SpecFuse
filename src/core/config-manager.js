/**
 * Unified Configuration Manager for SpecFuse.
 *
 * Provides a single interface for viewing and managing all SpecFuse
 * configuration: registry settings, artifact schema, and plugin rules.
 * Uses dot-notation keys (e.g. "registry.phase") for access.
 *
 * Pure logic — no console.log, no process.exit.
 */

import { join } from 'path'
import { pathExists } from '../utils/fs.js'
import { Registry } from './registry.js'
import { loadArtifactSchema } from './artifact-schema.js'
import { loadRules } from './rule-loader.js'

/**
 * Static schema defining all known config keys, their types, mutability,
 * validation rules, and which source they are read from / written to.
 *
 * @type {Map<string, { type: string, mutable: boolean, source: string, validate?: (v: any) => string|null }>}
 */
const SCHEMA = new Map([
  // ── Registry keys ──────────────────────────────────────────────────────────
  [
    'registry.phase',
    {
      type: 'string',
      mutable: true,
      source: 'registry',
      validate: (v) => {
        const allowed = ['unknown', 'planning', 'feature-dev', 'maintenance']
        return typeof v === 'string' && allowed.includes(v)
          ? null
          : `Must be one of: ${allowed.join(', ')}`
      },
    },
  ],
  [
    'registry.projectName',
    { type: 'string', mutable: true, source: 'registry' },
  ],
  [
    'registry.hooksInstalled',
    { type: 'boolean', mutable: true, source: 'registry' },
  ],
  [
    'registry.maxHistory',
    {
      type: 'number',
      mutable: true,
      source: 'registry',
      validate: (v) => {
        if (typeof v !== 'number' || !Number.isInteger(v)) return 'Must be an integer'
        if (v < 1) return 'Must be a positive integer'
        if (v > 1000) return 'Must be at most 1000'
        return null
      },
    },
  ],

  // ── Schema keys (read-only via config) ─────────────────────────────────────
  [
    'schema.version',
    { type: 'number', mutable: false, source: 'schema' },
  ],
  [
    'schema.artifacts',
    { type: 'object', mutable: false, source: 'schema' },
  ],

  // ── Rules keys (read-only / computed) ──────────────────────────────────────
  [
    'rules.plugins',
    { type: 'boolean', mutable: false, source: 'rules', computed: true },
  ],
  [
    'rules.pluginCount',
    { type: 'number', mutable: false, source: 'rules', computed: true },
  ],
  [
    'rules.pluginIds',
    { type: 'array', mutable: false, source: 'rules', computed: true },
  ],

  // ── Linter keys ──────────────────────────────────────────────────────────
  [
    'linter.defaultSeverity',
    {
      type: 'string',
      mutable: true,
      source: 'registry',
      validate: (v) => {
        const allowed = ['error', 'warn', 'off']
        return typeof v === 'string' && allowed.includes(v)
          ? null
          : `Must be one of: ${allowed.join(', ')}`
      },
    },
  ],
  [
    'linter.configPath',
    { type: 'string', mutable: true, source: 'registry' },
  ],
])

/**
 * Coerce a string value to the type expected by the given key.
 *
 * @param {string} key - Dot-notation config key
 * @param {string} value - Raw string value (e.g. from CLI)
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
function coerceValue(key, value) {
  const spec = SCHEMA.get(key)
  if (!spec) return { ok: false, error: `Unknown config key: ${key}` }

  switch (spec.type) {
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return { ok: false, error: `Cannot coerce "${value}" to number` }
      return { ok: true, value: n }
    }
    case 'boolean': {
      const lower = String(value).toLowerCase()
      if (lower === 'true' || lower === '1') return { ok: true, value: true }
      if (lower === 'false' || lower === '0') return { ok: true, value: false }
      return { ok: false, error: `Cannot coerce "${value}" to boolean` }
    }
    case 'string':
      return { ok: true, value: String(value) }
    default:
      // object / array types cannot be set from CLI strings
      return { ok: false, error: `Cannot set config key "${key}" (type: ${spec.type})` }
  }
}

/**
 * Load unified config from all three sources.
 *
 * @param {string} projectRoot
 * @param {{ schemaPath?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<{ registry: object, schema: object, rules: object }>}
 */
export async function loadConfig(projectRoot, options = {}) {
  // 1. Registry
  const registry = new Registry(projectRoot)
  await registry.load()

  // 2. Schema
  const schema = await loadArtifactSchema(projectRoot, { schemaPath: options.schemaPath })

  // 3. Rules — detect plugin info from .specfuse/rules.mjs
  const rulesPath = join(projectRoot, '.specfuse', 'rules.mjs')
  const hasPluginsFile = pathExists(rulesPath)
  let pluginIds = []
  let pluginCount = 0

  if (hasPluginsFile) {
    try {
      // Load built-in rules only, then all rules — diff to find plugins
      const builtinRules = await loadRules(projectRoot, { allowPlugins: false })
      const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins ?? true })
      const builtinIds = new Set(builtinRules.map((r) => r.id))
      const pluginRules = allRules.filter((r) => !builtinIds.has(r.id))
      pluginIds = pluginRules.map((r) => r.id)
      pluginCount = pluginRules.length
    } catch {
      // If rules fail to load, still report that the plugin file exists
      pluginCount = 0
      pluginIds = []
    }
  }

  return {
    registry: {
      phase: registry.getPhase(),
      projectName: registry.getProjectName(),
      hooksInstalled: registry.getHooksInstalled(),
      maxHistory: registry.getMaxHistory(),
    },
    schema: {
      version: schema.version,
      artifacts: schema.artifacts,
    },
    rules: {
      plugins: hasPluginsFile,
      pluginCount,
      pluginIds,
    },
    linter: {
      defaultSeverity: registry.data.linter?.defaultSeverity ?? 'warn',
      configPath: registry.data.linter?.configPath ?? '',
    },
  }
}

/**
 * Get a single config value by dot-notation key.
 *
 * @param {{ registry: object, schema: object, rules: object }} config
 * @param {string} key - e.g. "registry.phase"
 * @returns {{ ok: true, value: any, source: string, mutable: boolean } | { ok: false, error: string }}
 */
export function getConfigValue(config, key) {
  const spec = SCHEMA.get(key)
  if (!spec) return { ok: false, error: `Unknown config key: ${key}` }

  const [section, ...rest] = key.split('.')
  const sectionData = config[section]
  if (!sectionData) return { ok: false, error: `Unknown config section: ${section}` }

  const value = rest.reduce((obj, k) => obj?.[k], sectionData)
  return { ok: true, value, source: spec.source, mutable: spec.mutable }
}

/**
 * Set a config value by dot-notation key. Persists to the underlying source.
 *
 * @param {string} projectRoot
 * @param {string} key - e.g. "registry.maxHistory"
 * @param {any} value - The value to set (will be coerced if string)
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ ok: true, key: string, value: any } | { ok: false, error: string }>}
 */
export async function setConfigValue(projectRoot, key, value, options = {}) {
  const spec = SCHEMA.get(key)
  if (!spec) return { ok: false, error: `Unknown config key: ${key}` }
  if (!spec.mutable) return { ok: false, error: `Config key "${key}" is read-only (source: ${spec.source})` }

  // Coerce if the value is a string (CLI input)
  const coerced = typeof value === 'string' ? coerceValue(key, value) : { ok: true, value }
  if (!coerced.ok) return { ok: false, error: coerced.error }

  // Validate
  if (spec.validate) {
    const validationError = spec.validate(coerced.value)
    if (validationError) return { ok: false, error: validationError }
  }

  // Only registry keys are mutable in the current schema
  if (spec.source === 'registry') {
    const registry = new Registry(projectRoot)
    await registry.load()

    const [, field] = key.split('.')
    switch (field) {
      case 'phase':
        registry.setPhase(coerced.value)
        break
      case 'projectName':
        registry.setProjectName(coerced.value)
        break
      case 'hooksInstalled':
        registry.setHooksInstalled(coerced.value)
        break
      case 'maxHistory':
        registry.setMaxHistory(coerced.value)
        break
      default: {
        // Linter and other nested fields stored as registry.data[field]
        const [, , subField] = key.split('.')
        if (subField) {
          if (!registry.data[field]) registry.data[field] = {}
          registry.data[field][subField] = coerced.value
        } else {
          return { ok: false, error: `Unknown registry field: ${field}` }
        }
        break
      }
    }

    await registry.save()
  }

  return { ok: true, key, value: coerced.value }
}

/**
 * Validate all configuration values against their schema constraints.
 *
 * @param {{ registry: object, schema: object, rules: object }} config
 * @returns {{ valid: boolean, errors: Array<{ key: string, error: string }> }}
 */
export function validateConfig(config) {
  const errors = []

  for (const [key, spec] of SCHEMA) {
    const result = getConfigValue(config, key)
    if (!result.ok) continue // skip keys that can't be read

    if (spec.validate) {
      const validationError = spec.validate(result.value)
      if (validationError) {
        errors.push({ key, error: validationError })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Return the file paths for all config sources.
 *
 * @param {string} projectRoot
 * @returns {{ registry: string, schema: string, rules: string }}
 */
export function configPaths(projectRoot) {
  return {
    registry: join(projectRoot, '.specfuse', 'registry.json'),
    schema: join(projectRoot, '.specfuse', 'artifact-schema.json'),
    rules: join(projectRoot, '.specfuse', 'rules.mjs'),
  }
}

/**
 * Get all known config keys with their metadata.
 *
 * @returns {Array<{ key: string, type: string, mutable: boolean, source: string, computed?: boolean }>}
 */
export function listSchema() {
  return Array.from(SCHEMA.entries()).map(([key, spec]) => ({
    key,
    type: spec.type,
    mutable: spec.mutable,
    source: spec.source,
    computed: spec.computed ?? false,
  }))
}
