/**
 * Batch CLI commands — bulk review, verify, archive, and status operations.
 */

import chalk from 'chalk'
import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  discoverChanges,
  batchReviewApprove,
  batchVerifyPass,
  batchArchive,
  batchStatus,
  formatBatchTable,
  formatBatchJson,
  formatStatusTable,
  BATCH_EVENT_TYPES,
} from '../core/batch.js'
import { logger } from '../utils/logger.js'

// ── specfuse batch status ───────────────────────────────────────────────────

/**
 * Show status summary across all active changes.
 *
 * @param {string} projectRoot
 * @param {{ filter?: string, filterType?: string, json?: boolean }} [options]
 */
export async function batchStatusCommand(projectRoot, options = {}) {
  const changes = await discoverChanges(projectRoot, {
    filter: options.filter,
    filterType: options.filterType,
  })

  const status = batchStatus(projectRoot, changes)

  if (options.json) {
    console.log(formatBatchJson(status))
    return
  }

  if (!changes.length) {
    if (options.filter) {
      logger.info(chalk.dim(`No changes match filter '${options.filter}'.`))
    } else {
      logger.info(chalk.dim('No active changes found.'))
    }
    logger.br()
    return
  }

  console.log(formatStatusTable(status))
  logger.br()
}

// ── specfuse batch review --approve ──────────────────────────────────────────

/**
 * Bulk-approve reviews for eligible changes.
 *
 * @param {string} projectRoot
 * @param {{ filter?: string, filterType?: string, dryRun?: boolean, json?: boolean }} [options]
 */
export async function batchReviewCommand(projectRoot, options = {}) {
  const changes = await discoverChanges(projectRoot, {
    filter: options.filter,
    filterType: options.filterType,
  })

  if (!changes.length) {
    if (options.filter) {
      logger.info(chalk.dim(`No changes match filter '${options.filter}'.`))
    } else {
      logger.info(chalk.dim('No active changes found.'))
    }
    logger.br()
    return
  }

  if (options.dryRun) {
    const eligible = changes.filter(
      (c) => c.review && c.reviewStatus !== 'approved',
    )
    if (!eligible.length) {
      logger.info(chalk.dim('No changes would be affected.'))
      logger.br()
      return
    }
    logger.info(chalk.cyan(`Would approve reviews for ${eligible.length} change(s):`))
    for (const c of eligible) {
      console.log(`  ${chalk.dim('-')} ${c.slug}`)
    }
    logger.br()
    logger.info('Run without --dry-run to apply.')
    logger.br()
    return
  }

  const result = await batchReviewApprove(projectRoot, changes)

  // Record history event
  if (result.succeeded.length) {
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

  if (options.json) {
    console.log(formatBatchJson(result))
    return
  }

  console.log(formatBatchTable(result, 'review approve'))
  logger.br()
}

// ── specfuse batch verify --pass ─────────────────────────────────────────────

/**
 * Bulk-pass verification for eligible changes.
 *
 * @param {string} projectRoot
 * @param {{ filter?: string, filterType?: string, dryRun?: boolean, json?: boolean }} [options]
 */
export async function batchVerifyCommand(projectRoot, options = {}) {
  const changes = await discoverChanges(projectRoot, {
    filter: options.filter,
    filterType: options.filterType,
  })

  if (!changes.length) {
    if (options.filter) {
      logger.info(chalk.dim(`No changes match filter '${options.filter}'.`))
    } else {
      logger.info(chalk.dim('No active changes found.'))
    }
    logger.br()
    return
  }

  if (options.dryRun) {
    const eligible = changes.filter(
      (c) => c.verify && c.reviewStatus === 'approved' && c.verifyStatus !== 'pass',
    )
    if (!eligible.length) {
      logger.info(chalk.dim('No changes would be affected.'))
      logger.br()
      return
    }
    logger.info(chalk.cyan(`Would pass verification for ${eligible.length} change(s):`))
    for (const c of eligible) {
      console.log(`  ${chalk.dim('-')} ${c.slug}`)
    }
    logger.br()
    logger.info('Run without --dry-run to apply.')
    logger.br()
    return
  }

  const result = await batchVerifyPass(projectRoot, changes)

  // Record history event
  if (result.succeeded.length) {
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

  if (options.json) {
    console.log(formatBatchJson(result))
    return
  }

  console.log(formatBatchTable(result, 'verify pass'))
  logger.br()
}

// ── specfuse batch archive ──────────────────────────────────────────────────

/**
 * Bulk-archive verified changes.
 *
 * @param {string} projectRoot
 * @param {{ filter?: string, filterType?: string, dryRun?: boolean, force?: boolean, json?: boolean }} [options]
 */
export async function batchArchiveCommand(projectRoot, options = {}) {
  const changes = await discoverChanges(projectRoot, {
    filter: options.filter,
    filterType: options.filterType,
  })

  if (!changes.length) {
    if (options.filter) {
      logger.info(chalk.dim(`No changes match filter '${options.filter}'.`))
    } else {
      logger.info(chalk.dim('No active changes found.'))
    }
    logger.br()
    return
  }

  if (options.dryRun) {
    const eligible = changes.filter(
      (c) => c.verifyStatus === 'pass' || options.force,
    )
    if (!eligible.length) {
      logger.info(chalk.dim('No changes would be affected.'))
      logger.br()
      return
    }
    logger.info(chalk.cyan(`Would archive ${eligible.length} change(s):`))
    for (const c of eligible) {
      console.log(`  ${chalk.dim('-')} ${c.slug}`)
    }
    if (options.force) {
      logger.warn('Note: --force is set — unverified changes would also be archived.')
    }
    logger.br()
    logger.info('Run without --dry-run to apply.')
    logger.br()
    return
  }

  // Load registry for traceability integration
  const registry = new Registry(projectRoot)
  await registry.load()

  const result = await batchArchive(projectRoot, changes, options, { registry })

  // Save registry (traceability updates) and record history event
  if (result.succeeded.length) {
    await registry.save()

    // Re-load for history event
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

  if (options.json) {
    console.log(formatBatchJson(result))
    return
  }

  console.log(formatBatchTable(result, 'archive'))
  logger.br()
}
