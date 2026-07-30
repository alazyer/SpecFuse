/**
 * History API — query the audit log of SpecFuse operations.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath } from 'path'
import { Registry } from '../core/registry.js'
import { getHistory, EVENT_TYPES } from '../core/history.js'

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * List history events with optional filtering.
 *
 * @param {string} root - Project root path
 * @param {{ since?: string, until?: string, limit?: number, type?: string }} [options]
 * @returns {Promise<{ events: Array<object>, maxHistory: number }>}
 */
export async function list(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const registry = new Registry(projectRoot)
  await registry.load()

  const events = getHistory(registry, {
    since: options.since,
    until: options.until,
    limit: options.limit,
    type: options.type,
  })

  return { events, maxHistory: registry.getMaxHistory() }
}

/**
 * Supported event types.
 */
export { EVENT_TYPES }
