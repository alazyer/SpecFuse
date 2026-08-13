/**
 * History and Audit Log — event recording and formatting.
 *
 * History events are stored in the Registry under the `history` key.
 * This module provides helpers to record events, query them, and format
 * them for human or machine consumption.
 */

import chalk from 'chalk'
import { logger } from '../utils/logger.js'

/** Supported event types */
export const EVENT_TYPES = {
  init: 'init',
  sync: 'sync',
  archive: 'archive',
  validate: 'validate',
  drift: 'drift',
  clean: 'clean',
  reset: 'reset',
  batch_review: 'batch_review',
  batch_verify: 'batch_verify',
  batch_archive: 'batch_archive',
  graph_generate: 'graph_generate',
  graph_impact: 'graph_impact',
  export: 'export',
  import: 'import',
  lint: 'lint',
  // Recovery of an interrupted sync/archive (Improvement 2). Recorded when the
  // engine reconciles a stale pendingSync/pendingArchive marker so operators
  // can forensically trace which runs were recovered.
  recovery: 'recovery',
}

/**
 * Record a history event via the Registry.
 *
 * @param {import('./registry.js').Registry} registry
 * @param {string} type - One of EVENT_TYPES
 * @param {string} summary - Human-readable summary
 * @param {object} [details] - Optional structured details
 */
export function recordEvent(registry, type, summary, details = {}) {
  registry.recordHistoryEvent(type, summary, details)
}

/**
 * Get history events from the Registry with optional filtering.
 *
 * @param {import('./registry.js').Registry} registry
 * @param {{ since?: string, until?: string, limit?: number, type?: string }} [options]
 * @returns {Array<object>}
 */
export function getHistory(registry, options = {}) {
  return registry.getHistory(options)
}

/**
 * Format a single history event for table display.
 *
 * @param {object} event
 * @returns {string}
 */
export function formatEvent(event) {
  const time = event.timestamp.slice(0, 19).replace('T', ' ')
  const typeBadge = {
    init: chalk.bgGreen.black(' INIT '),
    sync: chalk.bgBlue.white(' SYNC '),
    archive: chalk.bgMagenta.white(' ARCH '),
    validate: chalk.bgCyan.black(' VAL  '),
    drift: chalk.bgYellow.black(' DRIFT'),
    clean: chalk.bgWhite.black(' CLEAN'),
    reset: chalk.bgRed.white(' RESET'),
    batch_review: chalk.bgBlue.white(' BREVW'),
    batch_verify: chalk.bgGreen.white(' BVERY'),
    batch_archive: chalk.bgMagenta.white(' BARCH'),
    graph_generate: chalk.bgGreen.black(' GRAPH'),
    graph_impact: chalk.bgRed.white(' IMPCT'),
    export: chalk.bgGreen.black(' EXP  '),
    import: chalk.bgBlue.white(' IMP  '),
    lint: chalk.bgCyan.black(' LINT '),
  }
  const badge = typeBadge[event.type] ?? chalk.bgGray.white(` ${event.type.padEnd(5)} `)
  return `${chalk.dim(time)}  ${badge}  ${event.summary}`
}

/**
 * Format an array of history events as a table.
 *
 * @param {Array<object>} events
 * @returns {string}
 */
export function formatHistoryTable(events) {
  return events.map(formatEvent).join('\n')
}

/**
 * Format an array of history events as JSON.
 *
 * @param {Array<object>} events
 * @returns {string}
 */
export function formatHistoryJson(events) {
  return JSON.stringify({ events }, null, 2)
}
