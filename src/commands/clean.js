/**
 * Clean and Reset commands for SpecFuse.
 *
 * `specfuse clean` — Remove orphaned files, stale registry entries, empty directories.
 * `specfuse reset` — Reset project state (preserves plan/ and archive/ by default).
 */

import { join, relative } from 'path'
import { rm, rmdir, readdir, lstat, stat } from 'fs/promises'
import { existsSync } from 'fs'
import chalk from 'chalk'
import createReadline from 'readline'

import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  findOrphanedFiles,
  findStaleRegistryEntries,
  findEmptyDirectories,
  removeOrphanedFiles,
  removeEmptyDirectories,
} from '../core/orphan-detector.js'
import { pathExists, ensureDir } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Prompt the user for confirmation.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function confirm(message) {
  const rl = createReadline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${chalk.yellow('?')} ${message} ${chalk.dim('[y/N]')} `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Recursively remove a directory's contents, preserving the directory itself.
 * @param {string} dir
 * @param {Set<string>} preserve  Basenames to preserve within the directory
 */
async function removeDirContents(dir, preserve = new Set()) {
  if (!pathExists(dir)) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (preserve.has(entry.name)) continue
    const fullPath = join(dir, entry.name)
    try {
      const info = await lstat(fullPath)
      if (info.isDirectory()) {
        await removeDirContents(fullPath)
        // Try to remove the now-empty directory
        try {
          await rmdir(fullPath)
        } catch {
          /* not empty — leave it */
        }
      } else {
        await rm(fullPath)
      }
    } catch {
      /* already gone */
    }
  }
}

/**
 * Recursively remove a directory and all its contents.
 * @param {string} dir
 */
async function removeDir(dir) {
  if (!pathExists(dir)) return
  await rm(dir, { recursive: true, force: true })
}

// ─── Clean Command ───────────────────────────────────────────────────────────

/**
 * Run the clean command.
 *
 * @param {string} projectRoot
 * @param {{ dryRun?: boolean, force?: boolean, registry?: boolean, orphans?: boolean, json?: boolean }} options
 */
export async function cleanCommand(projectRoot, options = {}) {
  const dryRun = options.dryRun ?? false
  const force = options.force ?? false
  const jsonMode = options.json ?? false
  const cleanRegistry = options.registry ?? false
  const cleanOrphans = options.orphans ?? false
  // If no specific flags, clean everything
  const cleanAll = !cleanRegistry && !cleanOrphans

  const result = {
    dryRun,
    files: { removed: [], skipped: [] },
    syncs: { removed: [], count: 0 },
    traces: { removed: [], count: 0 },
    directories: { removed: [], skipped: [] },
  }

  // Detect orphans
  if (cleanAll || cleanOrphans) {
    const orphaned = await findOrphanedFiles(projectRoot)
    const emptyDirs = await findEmptyDirectories(projectRoot)

    if (dryRun) {
      result.files.removed = orphaned.files
      result.directories.removed = emptyDirs.directories
    } else {
      // Need confirmation unless --force
      const totalItems = orphaned.files.length + emptyDirs.directories.length
      if (totalItems > 0 && !force) {
        const ok = await confirm(
          `Remove ${orphaned.files.length} orphaned file(s) and ${emptyDirs.directories.length} empty directory(ies)?`,
        )
        if (!ok) {
          logger.info('Clean cancelled.')
          if (jsonMode) console.log(JSON.stringify(result, null, 2))
          return
        }
      }
      if (orphaned.files.length > 0) {
        const removed = await removeOrphanedFiles(projectRoot, orphaned.files)
        result.files.removed = removed.removed
        result.files.skipped = removed.skipped
      }
      if (emptyDirs.directories.length > 0) {
        const removed = await removeEmptyDirectories(projectRoot, emptyDirs.directories)
        result.directories.removed = removed.removed
        result.directories.skipped = removed.skipped
      }
    }
  }

  // Detect stale registry entries
  if (cleanAll || cleanRegistry) {
    const stale = await findStaleRegistryEntries(projectRoot)

    if (stale.syncs.length > 0 || stale.traces.length > 0) {
      if (dryRun) {
        result.syncs.removed = stale.syncs
        result.syncs.count = stale.syncs.length
        result.traces.removed = stale.traces
        result.traces.count = stale.traces.length
      } else {
        const totalStale = stale.syncs.length + stale.traces.length
        if (totalStale > 0 && !force && !cleanRegistry) {
          // Already confirmed above if cleanAll; only need extra confirm for registry if specifically flagged
        }
        if (totalStale > 0 && !force && cleanRegistry) {
          const ok = await confirm(
            `Remove ${stale.syncs.length} stale sync(s) and ${stale.traces.length} stale trace(s) from registry?`,
          )
          if (!ok) {
            logger.info('Clean cancelled.')
            if (jsonMode) console.log(JSON.stringify(result, null, 2))
            return
          }
        }

        const registry = new Registry(projectRoot)
        await registry.withLock(async (reg) => {
          await reg.load()

          const syncsRemoved = reg.removeSyncEntries(stale.syncs)
          const tracesRemoved = reg.removeTraceEntries(stale.traces)
          result.syncs.removed = stale.syncs
          result.syncs.count = syncsRemoved
          result.traces.removed = stale.traces
          result.traces.count = tracesRemoved

          recordEvent(
            reg,
            EVENT_TYPES.clean,
            `Removed ${syncsRemoved} stale sync(s), ${tracesRemoved} stale trace(s)`,
            {
              syncsRemoved,
              tracesRemoved,
            },
          )
          await reg.save()
        })
      }
    }
  }

  // Output
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  // Human-readable output
  const prefix = dryRun ? chalk.dim('Would remove:') : chalk.green('Removed:')

  if (result.files.removed.length > 0) {
    console.log(`\n  ${prefix} ${chalk.bold('Orphaned files')}`)
    for (const f of result.files.removed) {
      console.log(`    ${chalk.dim('-')} ${f}`)
    }
  }

  if (result.syncs.count > 0) {
    console.log(`\n  ${prefix} ${chalk.bold('Stale sync entries')}`)
    for (const s of result.syncs.removed) {
      console.log(`    ${chalk.dim('-')} registry sync: ${s}`)
    }
  }

  if (result.traces.count > 0) {
    console.log(`\n  ${prefix} ${chalk.bold('Stale trace entries')}`)
    for (const t of result.traces.removed) {
      console.log(`    ${chalk.dim('-')} registry trace: ${t}`)
    }
  }

  if (result.directories.removed.length > 0) {
    console.log(`\n  ${prefix} ${chalk.bold('Empty directories')}`)
    for (const d of result.directories.removed) {
      console.log(`    ${chalk.dim('-')} ${d}/`)
    }
  }

  const totalItems =
    result.files.removed.length +
    result.syncs.count +
    result.traces.count +
    result.directories.removed.length

  if (totalItems === 0) {
    logger.success('Nothing to clean — project is tidy. ✓')
  } else if (dryRun) {
    logger.br()
    logger.info(`Total: ${totalItems} item(s).`)
    logger.info('Run without --dry-run to apply.')
  } else {
    logger.br()
    logger.success(`Cleaned ${totalItems} item(s).`)
  }
  logger.br()
}

// ─── Reset Command ───────────────────────────────────────────────────────────

/**
 * Run the reset command.
 *
 * @param {string} projectRoot
 * @param {{ dryRun?: boolean, hard?: boolean, force?: boolean, json?: boolean }} options
 */
export async function resetCommand(projectRoot, options = {}) {
  const dryRun = options.dryRun ?? true // Default to dry-run for reset
  const hard = options.hard ?? false
  const force = options.force ?? false
  const jsonMode = options.json ?? false

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    logger.warn('.specfuse/ not found — nothing to reset.')
    if (jsonMode) console.log(JSON.stringify({ reset: false, reason: 'no .specfuse directory' }, null, 2))
    return
  }

  const result = {
    dryRun,
    hard,
    preserved: hard ? [] : ['plan/', 'changes/archive/', 'markdownlint.json'],
    removed: [],
  }

  if (dryRun) {
    // Build list of what would be removed
    if (hard) {
      result.removed = [
        '.specfuse/registry.json',
        '.specfuse/constitution.md',
        '.specfuse/plan/',
        '.specfuse/changes/',
        '.specfuse/rules.mjs',
        '.specfuse/markdownlint.json',
      ]
    } else {
      result.removed = [
        '.specfuse/registry.json',
        '.specfuse/constitution.md',
        '.specfuse/changes/ (active only, preserving archive/)',
      ]
    }

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    logger.header('SpecFuse Reset  (dry-run)')
    logger.br()
    logger.warn('Would reset the following:')
    for (const item of result.removed) {
      console.log(`  ${chalk.dim('-')} ${item}`)
    }
    if (!hard) {
      logger.br()
      logger.info('Preserving: plan/, changes/archive/')
    }
    logger.br()
    logger.info('Run without --dry-run to apply, or add --hard to remove everything.')
    return
  }

  // Actually resetting — need confirmation
  if (!force) {
    const msg = hard
      ? 'Hard reset will remove ALL SpecFuse artifacts including plan and archive. Continue?'
      : 'Reset will clear sync state, constitution, and active changes (preserving plan/ and archive/). Continue?'
    const ok = await confirm(msg)
    if (!ok) {
      logger.info('Reset cancelled.')
      if (jsonMode) console.log(JSON.stringify({ reset: false, reason: 'cancelled' }, null, 2))
      return
    }
  }

  // Perform reset
  const registry = new Registry(projectRoot)
  await registry.load()
  recordEvent(registry, EVENT_TYPES.reset, hard ? 'Hard reset — all artifacts removed' : 'Soft reset — preserving plan/ and archive/', { hard })

  if (hard) {
    // Remove everything inside .specfuse/ except the directory itself
    await removeDirContents(specDir)
    result.removed = ['.specfuse/ (all contents)']
  } else {
    // Soft reset: preserve plan/ and archive/
    // 1. Reset registry sync and trace state
    registry.clearSyncState()
    registry.clearTraceState()
    // Reset artifacts to defaults
    registry.data.artifacts = {}
    registry.data.phase = 'unknown'
    await registry.save()

    // 2. Remove constitution.md
    const constitutionPath = join(specDir, 'constitution.md')
    if (pathExists(constitutionPath)) {
      await rm(constitutionPath)
      result.removed.push('.specfuse/constitution.md')
    }

    // 3. Remove active change directories (not archive)
    const changesDir = join(specDir, 'changes')
    if (pathExists(changesDir)) {
      const entries = await readdir(changesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'archive') {
          const changePath = join(changesDir, entry.name)
          await removeDir(changePath)
          result.removed.push(`.specfuse/changes/${entry.name}/`)
        }
      }
    }

    // 4. Remove rules.mjs if present
    const rulesPath = join(specDir, 'rules.mjs')
    if (pathExists(rulesPath)) {
      await rm(rulesPath)
      result.removed.push('.specfuse/rules.mjs')
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  logger.header('SpecFuse Reset')
  logger.br()
  logger.success('Reset complete.')
  if (!hard) {
    logger.info('Preserved: plan/, changes/archive/')
    logger.info('Run `specfuse sync` to rebuild constitution and sync state.')
  } else {
    logger.info('Run `specfuse init` to start fresh.')
  }
  logger.br()
}
