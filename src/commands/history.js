/**
 * History CLI commands — show and filter audit log events.
 */

import chalk from 'chalk'
import { Registry } from '../core/registry.js'
import { getHistory, formatHistoryTable, formatHistoryJson, EVENT_TYPES } from '../core/history.js'
import { logger } from '../utils/logger.js'

// ── specfuse history ──────────────────────────────────────────────────────

/**
 * Show recent history events with optional filtering.
 * @param {string} projectRoot
 * @param {{ since?: string, until?: string, limit?: number, type?: string, json?: boolean, verbose?: boolean }} [options]
 */
export async function historyCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const filterOpts = {
    since: options.since,
    until: options.until,
    limit: options.limit ?? 20,
    type: options.type,
  }

  const events = getHistory(registry, filterOpts)

  if (options.json) {
    console.log(formatHistoryJson(events))
    return
  }

  logger.header('SpecFuse History')
  logger.br()

  if (!events.length) {
    logger.info(chalk.dim('No history events recorded yet.'))
    logger.br()
    return
  }

  console.log(formatHistoryTable(events))

  if (options.verbose && events.length) {
    logger.br()
    logger.header('Details')
    for (const e of events) {
      console.log(`  ${chalk.bold(e.id)}  ${chalk.dim(e.timestamp)}`)
      console.log(`    Type: ${chalk.cyan(e.type)}`)
      console.log(`    Summary: ${e.summary}`)
      if (e.details && Object.keys(e.details).length > 0) {
        for (const [key, value] of Object.entries(e.details)) {
          console.log(`    ${chalk.dim(`${key}:`)} ${value}`)
        }
      }
      logger.br()
    }
  }

  logger.info(
    `${events.length} event(s) shown (limit: ${filterOpts.limit}, max: ${registry.getMaxHistory()})`,
  )
  logger.br()
}

// ── specfuse history sync ──────────────────────────────────────────────────

/**
 * Show sync history events only.
 * @param {string} projectRoot
 * @param {{ since?: string, until?: string, limit?: number, json?: boolean }} [options]
 */
export async function historySyncCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const events = getHistory(registry, {
    type: EVENT_TYPES.sync,
    since: options.since,
    until: options.until,
    limit: options.limit ?? 20,
  })

  if (options.json) {
    console.log(formatHistoryJson(events))
    return
  }

  logger.header('Sync History')
  logger.br()

  if (!events.length) {
    logger.info(chalk.dim('No sync events recorded yet.'))
    logger.br()
    return
  }

  console.log(formatHistoryTable(events))
  logger.br()
}

// ── specfuse history archive ──────────────────────────────────────────────

/**
 * Show archive history events only.
 * @param {string} projectRoot
 * @param {{ since?: string, until?: string, limit?: number, json?: boolean }} [options]
 */
export async function historyArchiveCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const events = getHistory(registry, {
    type: EVENT_TYPES.archive,
    since: options.since,
    until: options.until,
    limit: options.limit ?? 20,
  })

  if (options.json) {
    console.log(formatHistoryJson(events))
    return
  }

  logger.header('Archive History')
  logger.br()

  if (!events.length) {
    logger.info(chalk.dim('No archive events recorded yet.'))
    logger.br()
    return
  }

  console.log(formatHistoryTable(events))
  logger.br()
}
