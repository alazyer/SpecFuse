/**
 * Orphan detection for SpecFuse projects.
 *
 * Finds files, registry entries, and directories that are no longer
 * referenced by any rule or artifact.
 */

import { join, relative } from 'path'
import { readdir, stat, lstat, rm, rmdir } from 'fs/promises'
import { existsSync } from 'fs'
import { Registry, ARTIFACT_PATHS } from './registry.js'
import { loadRules } from './rule-loader.js'
import { pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

// Directories that should never be reported as orphans or removed
const PROTECTED_DIRS = new Set(['.specfuse', '.specfuse/plan', '.specfuse/changes', '.specfuse/changes/archive'])

/**
 * Recursively collect all file paths under a directory.
 * Uses lstat to avoid following symlinks.
 *
 * @param {string} dir
 * @param {string} projectRoot
 * @returns {Promise<string[]>}  Project-root-relative paths
 */
async function collectFiles(dir, projectRoot) {
  const results = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const rel = relative(projectRoot, fullPath)
      // Use lstat to avoid following symlinks (TOCTOU safety)
      const info = await lstat(fullPath)
      if (info.isDirectory()) {
        results.push(...(await collectFiles(fullPath, projectRoot)))
      } else if (info.isFile()) {
        results.push(rel)
      }
      // Skip symlinks — don't follow, don't report
    }
  } catch {
    /* directory may not exist */
  }
  return results
}

/**
 * Recursively collect empty directories under a given root.
 * A directory is "empty" if it contains no files (only other empty dirs or nothing).
 * Skips protected directories and the archive directory.
 *
 * @param {string} dir
 * @param {string} projectRoot
 * @returns {Promise<string[]>}  Project-root-relative paths of empty dirs
 */
async function collectEmptyDirectories(dir, projectRoot) {
  const results = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const subdirs = []
    let hasFiles = false
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Skip archive directory
        if (entry.name === 'archive' && dir.endsWith(join('.specfuse', 'changes'))) continue
        subdirs.push(fullPath)
      } else if (entry.isFile()) {
        hasFiles = true
      }
      // Skip symlinks
    }
    // Recurse into subdirectories first
    const subEmpty = await Promise.all(subdirs.map((s) => collectEmptyDirectories(s, projectRoot)))
    const emptySubs = subEmpty.flat()
    results.push(...emptySubs)
    // This directory is empty if it has no files and all subdirs are empty
    const allSubsEmpty = subdirs.length > 0 && emptySubs.length === subdirs.length
    if (!hasFiles && subdirs.length === 0) {
      // Leaf directory with no files — it's empty
      const rel = relative(projectRoot, dir)
      if (!PROTECTED_DIRS.has(rel)) {
        results.push(rel)
      }
    } else if (!hasFiles && allSubsEmpty) {
      // Non-leaf directory with no files and all subdirs empty
      const rel = relative(projectRoot, dir)
      if (!PROTECTED_DIRS.has(rel)) {
        results.push(rel)
      }
    }
  } catch {
    /* directory may not exist */
  }
  return results
}

/**
 * Build the set of paths that are tracked by rules or known artifact definitions.
 *
 * @param {string} projectRoot
 * @param {object} registry  Already-loaded registry data
 * @returns {Promise<Set<string>>}  Set of project-root-relative paths
 */
async function buildTrackedPaths(projectRoot, registry) {
  const tracked = new Set()

  // Add known artifact paths
  for (const path of Object.values(ARTIFACT_PATHS)) {
    tracked.add(path)
  }

  // Add artifact paths recorded in the registry
  if (registry.artifacts) {
    for (const artifact of Object.values(registry.artifacts)) {
      if (artifact.path) tracked.add(artifact.path)
    }
  }

  // Add paths from loaded rules (source and target)
  try {
    const rules = await loadRules(projectRoot).catch(() => [])
    for (const rule of rules) {
      if (rule.source) tracked.add(rule.source)
      if (rule.target) tracked.add(rule.target)
      // Also resolve full paths
      if (rule.sourcePath) tracked.add(relative(projectRoot, rule.sourcePath))
      if (rule.targetPath) tracked.add(relative(projectRoot, rule.targetPath))
    }
  } catch {
    /* no rules available */
  }

  // Add constitution (always tracked)
  tracked.add('.specfuse/constitution.md')
  // Add registry itself (always tracked)
  tracked.add('.specfuse/registry.json')

  return tracked
}

/**
 * Find orphaned files under .specfuse/ — files not tracked by any rule or known artifact.
 *
 * @param {string} projectRoot
 * @param {{ rules?: object[] }} [options]
 * @returns {Promise<{ files: string[] }>}  Project-root-relative paths of orphaned files
 */
export async function findOrphanedFiles(projectRoot, options = {}) {
  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) return { files: [] }

  const registry = new Registry(projectRoot)
  await registry.load()

  const allFiles = await collectFiles(specDir, projectRoot)
  const tracked = await buildTrackedPaths(projectRoot, registry.data)

  // Filter out tracked files; normalize path separators
  const normalize = (p) => p.replace(/\\/g, '/')
  const trackedNormalized = new Set([...tracked].map(normalize))
  const orphans = allFiles.filter((f) => {
    const nf = normalize(f)
    // Skip registry.json and constitution.md (always tracked)
    if (nf === '.specfuse/registry.json') return false
    if (nf === '.specfuse/constitution.md') return false
    // Check if tracked
    return !trackedNormalized.has(nf)
  })

  return { files: orphans }
}

/**
 * Find stale registry entries — syncs or traces referencing non-existent artifacts.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ syncs: string[], traces: string[] }>}  Keys of stale entries
 */
export async function findStaleRegistryEntries(projectRoot) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const staleSyncs = []
  const staleTraces = []

  // Check sync entries — a sync key is stale if the referenced artifact IDs
  // don't appear in any rule's source or target
  const rules = await loadRules(projectRoot).catch(() => [])
  const ruleIds = new Set(rules.flatMap((r) => [r.source, r.target, r.id]))

  const syncs = registry.data?.syncs ?? {}
  for (const key of Object.keys(syncs)) {
    if (!ruleIds.size) {
      // No rules loaded — if sync entries exist, they're stale
      staleSyncs.push(key)
      continue
    }
    // Check if any part of the key matches a known rule ID or artifact
    const parts = key.split('→')
    const hasMatch = parts.some((p) => ruleIds.has(p))
    if (!hasMatch) staleSyncs.push(key)
  }

  // Check trace entries — a trace is stale if the story file doesn't exist
  // and the story is not marked as implemented
  const traces = registry.data?.traces ?? {}
  for (const [storyId, record] of Object.entries(traces)) {
    // If implemented, keep it (it's historical)
    if (record.implemented) continue
    // Check if any active change directory exists for this story
    const activeChanges = record.active ?? []
    if (!activeChanges.length && !record.implemented) {
      // No active changes and not implemented — stale
      staleTraces.push(storyId)
      continue
    }
    // Check if referenced active changes still exist
    const changesDir = join(projectRoot, '.specfuse', 'changes')
    for (const changeName of activeChanges) {
      if (!pathExists(join(changesDir, changeName))) {
        // Referenced change no longer exists
        if (!staleTraces.includes(storyId)) staleTraces.push(storyId)
        break
      }
    }
  }

  return { syncs: staleSyncs, traces: staleTraces }
}

/**
 * Find empty directories under .specfuse/ (excluding protected dirs and archive).
 *
 * @param {string} projectRoot
 * @returns {Promise<{ directories: string[] }>}  Project-root-relative paths
 */
export async function findEmptyDirectories(projectRoot) {
  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) return { directories: [] }

  const directories = await collectEmptyDirectories(specDir, projectRoot)
  return { directories }
}

/**
 * Remove a list of files from disk. Uses lstat before removal (TOCTOU protection).
 *
 * @param {string} projectRoot
 * @param {string[]} files  Project-root-relative paths
 * @returns {Promise<{ removed: string[], skipped: string[] }>}
 */
export async function removeOrphanedFiles(projectRoot, files) {
  const removed = []
  const skipped = []

  for (const rel of files) {
    const fullPath = join(projectRoot, rel)
    try {
      // Verify it still exists and is a regular file (not a symlink) before removing
      const info = await lstat(fullPath)
      if (!info.isFile()) {
        skipped.push(rel)
        continue
      }
      await rm(fullPath)
      removed.push(rel)
    } catch {
      // File vanished between scan and remove — safe to skip
      skipped.push(rel)
    }
  }

  return { removed, skipped }
}

/**
 * Remove empty directories from disk. Checks each is still empty before removal.
 *
 * @param {string} projectRoot
 * @param {string[]} directories  Project-root-relative paths
 * @returns {Promise<{ removed: string[], skipped: string[] }>}
 */
export async function removeEmptyDirectories(projectRoot, directories) {
  const removed = []
  const skipped = []

  // Sort deepest-first so we remove children before parents
  const sorted = [...directories].sort((a, b) => b.split('/').length - a.split('/').length)

  for (const rel of sorted) {
    const fullPath = join(projectRoot, rel)
    try {
      // Verify still exists and is a directory
      const info = await lstat(fullPath)
      if (!info.isDirectory()) {
        skipped.push(rel)
        continue
      }
      // Verify still empty
      const entries = await readdir(fullPath)
      if (entries.length > 0) {
        skipped.push(rel)
        continue
      }
      await rmdir(fullPath)
      removed.push(rel)
    } catch {
      skipped.push(rel)
    }
  }

  return { removed, skipped }
}
