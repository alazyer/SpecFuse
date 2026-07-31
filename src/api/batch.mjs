/**
 * Batch Programmatic API — bulk review, verify, archive, and status operations.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath } from 'path'
import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  discoverChanges,
  batchReviewApprove,
  batchVerifyPass,
  batchArchive,
  batchStatus,
} from '../core/batch.js'
import { SpecFuseApiError, BatchFilterError } from './errors.mjs'

// Re-export BatchFilterError for consumers
export { BatchFilterError }

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * Show status summary across all active changes.
 *
 * @param {string} root - Project root path
 * @param {{ filter?: string, filterType?: 'glob'|'regex' }} [options]
 * @returns {Promise<{ total: number, byState: Record<string, number>, changes: Array<object> }>}
 */
export async function status(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const changes = await discoverChanges(projectRoot, {
    filter: options.filter,
    filterType: options.filterType,
  })
  return batchStatus(projectRoot, changes)
}

/**
 * Bulk-approve reviews for eligible changes.
 *
 * @param {string} root - Project root path
 * @param {{ filter?: string, filterType?: 'glob'|'regex', dryRun?: boolean }} [options]
 * @returns {Promise<{ succeeded: Array, skipped: Array, failed: Array }>}
 */
export async function reviewApprove(root, options = {}) {
  const projectRoot = resolveRoot(root)

  try {
    const changes = await discoverChanges(projectRoot, {
      filter: options.filter,
      filterType: options.filterType,
    })

    const result = await batchReviewApprove(projectRoot, changes, {
      dryRun: options.dryRun,
    })

    // Record history event for non-dry-run operations with successes
    if (!options.dryRun && result.succeeded.length) {
      const registry = new Registry(projectRoot)
      await registry.load()
      recordEvent(
        registry,
        EVENT_TYPES.batch_review,
        `Batch approved ${result.succeeded.length} review(s)`,
        {
          count: result.succeeded.length,
          changes: result.succeeded.map((s) => s.slug),
        },
      )
      await registry.save()
    }

    return result
  } catch (err) {
    if (err.name === 'BatchFilterError') {
      throw err // Re-throw typed errors from core
    }
    const error = new SpecFuseApiError(err.message, { cause: err })
    error.code = err.code
    throw error
  }
}

/**
 * Bulk-pass verification for eligible changes.
 *
 * @param {string} root - Project root path
 * @param {{ filter?: string, filterType?: 'glob'|'regex', dryRun?: boolean }} [options]
 * @returns {Promise<{ succeeded: Array, skipped: Array, failed: Array }>}
 */
export async function verifyPass(root, options = {}) {
  const projectRoot = resolveRoot(root)

  try {
    const changes = await discoverChanges(projectRoot, {
      filter: options.filter,
      filterType: options.filterType,
    })

    const result = await batchVerifyPass(projectRoot, changes, {
      dryRun: options.dryRun,
    })

    // Record history event for non-dry-run operations with successes
    if (!options.dryRun && result.succeeded.length) {
      const registry = new Registry(projectRoot)
      await registry.load()
      recordEvent(
        registry,
        EVENT_TYPES.batch_verify,
        `Batch passed ${result.succeeded.length} verification(s)`,
        {
          count: result.succeeded.length,
          changes: result.succeeded.map((s) => s.slug),
        },
      )
      await registry.save()
    }

    return result
  } catch (err) {
    if (err.name === 'BatchFilterError') {
      throw err
    }
    const error = new SpecFuseApiError(err.message, { cause: err })
    error.code = err.code
    throw error
  }
}

/**
 * Bulk-archive verified changes.
 *
 * @param {string} root - Project root path
 * @param {{ filter?: string, filterType?: 'glob'|'regex', dryRun?: boolean, force?: boolean }} [options]
 * @returns {Promise<{ succeeded: Array, skipped: Array, failed: Array }>}
 */
export async function archive(root, options = {}) {
  const projectRoot = resolveRoot(root)

  try {
    const changes = await discoverChanges(projectRoot, {
      filter: options.filter,
      filterType: options.filterType,
    })

    const registry = new Registry(projectRoot)
    await registry.load()

    const result = await batchArchive(projectRoot, changes, {
      dryRun: options.dryRun,
      force: options.force,
    }, { registry })

    // Save registry (traceability) and record history event
    if (!options.dryRun && result.succeeded.length) {
      await registry.save()

      const histRegistry = new Registry(projectRoot)
      await histRegistry.load()
      recordEvent(
        histRegistry,
        EVENT_TYPES.batch_archive,
        `Batch archived ${result.succeeded.length} change(s)`,
        {
          count: result.succeeded.length,
          changes: result.succeeded.map((s) => ({ slug: s.slug, archiveName: s.archiveName })),
          forced: !!options.force,
        },
      )
      await histRegistry.save()
    }

    return result
  } catch (err) {
    if (err.name === 'BatchFilterError') {
      throw err
    }
    const error = new SpecFuseApiError(err.message, { cause: err })
    error.code = err.code
    throw error
  }
}
