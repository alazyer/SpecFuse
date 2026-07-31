/**
 * CLI command handlers for `specfuse config`.
 *
 * Subcommands: list, get, set, validate, path
 * All support --json for machine-readable output.
 */

import chalk from 'chalk'
import {
  loadConfig,
  getConfigValue,
  setConfigValue,
  validateConfig,
  configPaths,
  listSchema,
} from '../core/config-manager.js'
import { logger } from '../utils/logger.js'

// ── list ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} projectRoot
 * @param {{ json?: boolean, schemaPath?: string }} [options]
 */
export async function configListCommand(projectRoot, options = {}) {
  const config = await loadConfig(projectRoot, { schemaPath: options.schemaPath })

  if (options.json) {
    console.log(JSON.stringify(config, null, 2))
    return
  }

  logger.header('SpecFuse Configuration')
  logger.br()

  const sections = [
    { name: 'registry', label: 'Registry', data: config.registry },
    { name: 'schema', label: 'Artifact Schema', data: config.schema },
    { name: 'rules', label: 'Rules', data: config.rules },
  ]

  for (const section of sections) {
    logger.header(section.label)
    for (const [key, value] of Object.entries(section.data)) {
      const fullKey = `${section.name}.${key}`
      const spec = listSchema().find((s) => s.key === fullKey)
      const readonly = spec && !spec.mutable
      const display = formatValue(value)
      const suffix = readonly ? chalk.dim(' (read-only)') : ''
      const computed = spec?.computed ? chalk.dim(' (computed)') : ''
      logger.row(fullKey, `${display}${suffix}${computed}`)
    }
    logger.br()
  }
}

// ── get ──────────────────────────────────────────────────────────────────────

/**
 * @param {string} key
 * @param {string} projectRoot
 * @param {{ json?: boolean, schemaPath?: string }} [options]
 */
export async function configGetCommand(key, projectRoot, options = {}) {
  const config = await loadConfig(projectRoot, { schemaPath: options.schemaPath })
  const result = getConfigValue(config, key)

  if (!result.ok) {
    if (options.json) {
      console.log(JSON.stringify({ error: result.error }))
      process.exit(1)
    }
    logger.error(result.error)
    process.exit(1)
  }

  if (options.json) {
    console.log(JSON.stringify({ key, value: result.value, source: result.source, mutable: result.mutable }))
    return
  }

  const readonly = !result.mutable ? chalk.dim(' (read-only)') : ''
  logger.row(key, `${formatValue(result.value)}${readonly}`)
  logger.row('source', result.source, chalk.dim)
  logger.br()
}

// ── set ──────────────────────────────────────────────────────────────────────

/**
 * @param {string} key
 * @param {string} value
 * @param {string} projectRoot
 * @param {{ json?: boolean, schemaPath?: string }} [options]
 */
export async function configSetCommand(key, value, projectRoot, options = {}) {
  const result = await setConfigValue(projectRoot, key, value, { schemaPath: options.schemaPath })

  if (!result.ok) {
    if (options.json) {
      console.log(JSON.stringify({ error: result.error, key }))
      process.exit(1)
    }
    logger.error(result.error)
    process.exit(1)
  }

  if (options.json) {
    console.log(JSON.stringify({ key: result.key, value: result.value }))
    return
  }

  logger.success(`Set ${chalk.cyan(result.key)} = ${formatValue(result.value)}`)
  logger.br()
}

// ── validate ─────────────────────────────────────────────────────────────────

/**
 * @param {string} projectRoot
 * @param {{ json?: boolean, schemaPath?: string }} [options]
 */
export async function configValidateCommand(projectRoot, options = {}) {
  const config = await loadConfig(projectRoot, { schemaPath: options.schemaPath })
  const result = validateConfig(config)

  if (options.json) {
    console.log(JSON.stringify(result))
    if (!result.valid) process.exit(1)
    return
  }

  if (result.valid) {
    logger.success('Configuration is valid.')
    logger.br()
    return
  }

  logger.error('Configuration validation failed:')
  for (const err of result.errors) {
    logger.row(err.key, err.error, chalk.red)
  }
  logger.br()
  process.exit(1)
}

// ── path ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} projectRoot
 * @param {{ json?: boolean }} [options]
 */
export async function configPathCommand(projectRoot, options = {}) {
  const paths = configPaths(projectRoot)

  if (options.json) {
    console.log(JSON.stringify(paths, null, 2))
    return
  }

  logger.header('Config File Paths')
  logger.row('Registry', paths.registry, chalk.cyan)
  logger.row('Schema', paths.schema, chalk.cyan)
  logger.row('Rules', paths.rules, chalk.cyan)
  logger.br()
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatValue(value) {
  if (value === null || value === undefined) return chalk.dim('—')
  if (typeof value === 'boolean') return value ? chalk.green('true') : chalk.red('false')
  if (typeof value === 'number') return chalk.yellow(String(value))
  if (Array.isArray(value)) return value.length ? value.join(', ') : chalk.dim('(empty)')
  if (typeof value === 'object') return chalk.dim(Object.keys(value).join(', ') || '(empty)')
  return String(value)
}
