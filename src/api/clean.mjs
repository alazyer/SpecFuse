/**
 * Clean and Reset API — remove orphaned files, stale registry entries, and reset project state.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath } from 'path'
import { rm, rmdir, readdir, lstat } from 'fs/promises'
import { join } from 'path'

import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  findOrphanedFiles,
  findStaleRegistryEntries,
  findEmptyDirectories,
  removeOrphanedFiles,
  removeEmptyDirectories,
} from '../core/orphan-detector.js'
import { pathExists } from '../utils/fs.js'
import { SpecFuseApiError } from './errors.mjs'

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * Clean orphaned files, stale registry entries, and empty directories.
 *
 * @param {string} root - Project root path
 * @param {{ dryRun?: boolean, registry?: boolean, orphans?: boolean }} [options]
 * @returns {Promise<{ dryRun: boolean, files: { removed: string[], skipped: string[] }, syncs: { removed: string[], count: number }, traces: { removed: string[], count: number }, directories: { removed: string[], skipped: string[] } }>}
 */
export async function clean(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const dryRun = options.dryRun ?? false
  const cleanRegistry = options.registry ?? false
  const cleanOrphans = options.orphans ?? false
  const cleanAll = !cleanRegistry && !cleanOrphans

  const result = {
    dryRun,
    files: { removed: [], skipped: [] },
    syncs: { removed: [], count: 0 },
    traces: { removed: [], count: 0 },
    directories: { removed: [], skipped: [] },
  }

  // Detect and remove orphaned files and empty directories
  if (cleanAll || cleanOrphans) {
    const orphaned = await findOrphanedFiles(projectRoot)
    const emptyDirs = await findEmptyDirectories(projectRoot)

    if (dryRun) {
      result.files.removed = orphaned.files
      result.directories.removed = emptyDirs.directories
    } else {
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

  // Detect and remove stale registry entries
  if (cleanAll || cleanRegistry) {
    const stale = await findStaleRegistryEntries(projectRoot)

    if (stale.syncs.length > 0 || stale.traces.length > 0) {
      if (dryRun) {
        result.syncs.removed = stale.syncs
        result.syncs.count = stale.syncs.length
        result.traces.removed = stale.traces
        result.traces.count = stale.traces.length
      } else {
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

  return result
}

/**
 * Recursively remove a directory's contents, preserving the directory itself.
 * @param {string} dir
 * @param {Set<string>} preserve - Basenames to preserve within the directory
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
 * Reset project state.
 *
 * @param {string} root - Project root path
 * @param {{ hard?: boolean, dryRun?: boolean }} [options]
 * @returns {Promise<{ dryRun: boolean, hard: boolean, preserved: string[], removed: string[] }>}
 */
export async function reset(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const dryRun = options.dryRun ?? true
  const hard = options.hard ?? false

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    const err = new SpecFuseApiError('.specfuse/ directory not found — nothing to reset.')
    err.code = 'ENOENT'
    throw err
  }

  const result = {
    dryRun,
    hard,
    preserved: hard ? [] : ['plan/', 'changes/archive/'],
    removed: [],
  }

  if (dryRun) {
    if (hard) {
      result.removed = [
        '.specfuse/registry.json',
        '.specfuse/constitution.md',
        '.specfuse/plan/',
        '.specfuse/changes/',
        '.specfuse/rules.mjs',
      ]
    } else {
      result.removed = [
        '.specfuse/registry.json',
        '.specfuse/constitution.md',
        '.specfuse/changes/ (active only, preserving archive/)',
      ]
    }
    return result
  }

  // Perform actual reset
  const registry = new Registry(projectRoot)

  if (hard) {
    await removeDirContents(specDir)
    result.removed = ['.specfuse/ (all contents)']
  } else {
    // Soft reset: preserve plan/ and archive/
    await registry.withLock(async (reg) => {
      await reg.load()
      recordEvent(
        reg,
        EVENT_TYPES.reset,
        'Soft reset — preserving plan/ and archive/',
        { hard },
      )
      reg.clearSyncState()
      reg.clearTraceState()
      reg.data.artifacts = {}
      reg.data.phase = 'unknown'
      await reg.save()
    })

    // Remove constitution.md
    const constitutionPath = join(specDir, 'constitution.md')
    if (pathExists(constitutionPath)) {
      await rm(constitutionPath)
      result.removed.push('.specfuse/constitution.md')
    }

    // Remove active change directories (not archive)
    const changesDir = join(specDir, 'changes')
    if (pathExists(changesDir)) {
      const entries = await readdir(changesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'archive') {
          await rm(join(changesDir, entry.name), { recursive: true, force: true })
          result.removed.push(`.specfuse/changes/${entry.name}/`)
        }
      }
    }

    // Remove rules.mjs if present
    const rulesPath = join(specDir, 'rules.mjs')
    if (pathExists(rulesPath)) {
      await rm(rulesPath)
      result.removed.push('.specfuse/rules.mjs')
    }
  }

  return result
}
