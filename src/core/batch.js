/**
 * Batch Operations — bulk review, verify, archive, and status across change proposals.
 *
 * This module provides core logic for discovering active changes, filtering by
 * pattern, and applying bulk mutations (review approve, verify pass, archive).
 * Each operation follows a best-effort pattern: individual failures are captured
 * in the result without aborting the whole batch.
 */

import { join, dirname } from 'path'
import { readdir, cp, rm } from 'fs/promises'
import {
  readFileSafe,
  writeFileAtomic,
  ensureDir,
  pathExists,
} from '../utils/fs.js'
import { BatchFilterError } from '../api/errors.mjs'
import {
  slugifyName,
  parseFrontmatterDocument,
  normalizeReviewStatus,
  normalizeVerifyStatus,
  extractAcceptanceCriteria,
  getChangeProposalState,
  getChangeTitle,
  countVerifyChecklist,
} from '../utils/change-artifacts.js'
import { parseStoryReferences } from './traceability.js'

/** Supported batch event types (recorded once per batch operation) */
export const BATCH_EVENT_TYPES = {
  batch_review: 'batch_review',
  batch_verify: 'batch_verify',
  batch_archive: 'batch_archive',
}

const CHANGES_DIR = (root) => join(root, '.specfuse', 'changes')

// ── Discovery ────────────────────────────────────────────────────────────────

/**
 * Discover all active (non-archived) change proposals with their state.
 *
 * @param {string} projectRoot
 * @param {{ filter?: string, filterType?: 'glob'|'regex' }} [options]
 * @returns {Promise<Array<{ slug: string, dir: string, proposal: string, design: string, tasks: string, review: string, verify: string, state: string, reviewStatus: string, verifyStatus: string }>>}
 */
export async function discoverChanges(projectRoot, options = {}) {
  const changesDir = CHANGES_DIR(projectRoot)
  const result = []

  let entries = []
  try {
    const all = await readdir(changesDir, { withFileTypes: true })
    entries = all.filter((e) => e.isDirectory() && e.name !== 'archive')
  } catch {
    return result
  }

  for (const entry of entries) {
    const slug = entry.name
    const dir = join(changesDir, slug)
    const change = await readChangeState(dir, slug)
    result.push(change)
  }

  // Apply filter if provided
  if (options.filter) {
    return applyFilter(result, options.filter, options.filterType ?? 'glob')
  }

  return result
}

/**
 * Read the state of a single change directory.
 *
 * @param {string} changeDir
 * @param {string} slug
 * @returns {Promise<{ slug: string, dir: string, proposal: string, design: string, tasks: string, review: string, verify: string, state: string, reviewStatus: string, verifyStatus: string }>}
 */
async function readChangeState(changeDir, slug) {
  const proposal = (await readFileSafe(join(changeDir, 'proposal.md'))) ?? ''
  const design = (await readFileSafe(join(changeDir, 'design.md'))) ?? ''
  const tasks = (await readFileSafe(join(changeDir, 'tasks.md'))) ?? ''
  const review = (await readFileSafe(join(changeDir, 'review.md'))) ?? ''
  const verify = (await readFileSafe(join(changeDir, 'verify.md'))) ?? ''

  const reviewStatus = review ? normalizeReviewStatus(parseFrontmatterDocument(review).data.status) : 'missing'
  const verifyStatus = verify ? normalizeVerifyStatus(parseFrontmatterDocument(verify).data.status) : 'missing'
  const state = getChangeProposalState(proposal, { reviewContent: review, verifyContent: verify })

  return { slug, dir: changeDir, proposal, design, tasks, review, verify, state, reviewStatus, verifyStatus }
}

// ── Filtering ────────────────────────────────────────────────────────────────

/**
 * Apply a filter pattern to a list of discovered changes.
 *
 * Glob patterns use micromatch; regex patterns are prefixed with `/`.
 *
 * @param {Array<{ slug: string }>} changes
 * @param {string} pattern
 * @param {'glob'|'regex'} [type='glob']
 * @returns {Promise<Array<{ slug: string }>>}
 */
export async function applyFilter(changes, pattern, type = 'glob') {
  if (!pattern) return changes

  if (type === 'regex' || pattern.startsWith('/')) {
    // Strip leading / for regex mode
    const regexStr = pattern.startsWith('/') ? pattern.slice(1) : pattern
    let regex
    try {
      regex = new RegExp(regexStr)
    } catch (err) {
      throw new BatchFilterError(`Invalid regex pattern: ${regexStr} — ${err.message}`, {
        pattern: regexStr,
        filterType: 'regex',
        cause: err,
      })
    }
    return changes.filter((c) => regex.test(c.slug))
  }

  // Glob mode — try micromatch, fall back to simple wildcard matching
  const micromatch = await importMicromatch()
  if (micromatch) {
    const slugs = changes.map((c) => c.slug)
    const matched = micromatch(slugs, pattern)
    const matchSet = new Set(matched)
    return changes.filter((c) => matchSet.has(c.slug))
  }

  // Simple wildcard fallback: convert glob * to .*
  const fallbackRegexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const fallbackRegex = new RegExp(`^${fallbackRegexStr}$`)
  return changes.filter((c) => fallbackRegex.test(c.slug))
}

/**
 * Try to dynamically import micromatch.
 * @returns {Promise<Function|null>}
 */
async function importMicromatch() {
  try {
    const mod = await import('micromatch')
    return mod.default ?? mod
  } catch {
    return null
  }
}

// ── Batch Review Approve ─────────────────────────────────────────────────────

/**
 * Bulk-approve reviews for eligible changes.
 *
 * Eligibility: review.md exists and reviewStatus !== 'approved'.
 *
 * @param {string} projectRoot
 * @param {Array<{ slug: string, dir: string, review: string, reviewStatus: string }>} changes
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ succeeded: Array<{ slug: string }>, skipped: Array<{ slug: string, reason: string }>, failed: Array<{ slug: string, error: string }> }>}
 */
export async function batchReviewApprove(projectRoot, changes, options = {}) {
  const result = { succeeded: [], skipped: [], failed: [] }

  for (const change of changes) {
    // Skip if no review.md
    if (!change.review) {
      result.skipped.push({ slug: change.slug, reason: 'review.md not generated' })
      continue
    }

    // Skip if already approved
    if (change.reviewStatus === 'approved') {
      result.skipped.push({ slug: change.slug, reason: 'already approved' })
      continue
    }

    if (options.dryRun) {
      result.succeeded.push({ slug: change.slug })
      continue
    }

    try {
      const reviewPath = join(change.dir, 'review.md')
      const parsed = parseFrontmatterDocument(change.review)
      const newData = { ...parsed.data, status: 'approved', reviewedAt: new Date().toISOString().slice(0, 10) }
      const updated = stringifyFrontmatter(parsed.content, newData)
      await writeFileAtomic(reviewPath, updated)
      result.succeeded.push({ slug: change.slug })
    } catch (err) {
      result.failed.push({ slug: change.slug, error: err.message })
    }
  }

  return result
}

// ── Batch Verify Pass ────────────────────────────────────────────────────────

/**
 * Bulk-pass verification for eligible changes.
 *
 * Eligibility: verify.md exists and reviewStatus === 'approved' and verifyStatus !== 'pass'.
 *
 * @param {string} projectRoot
 * @param {Array<{ slug: string, dir: string, verify: string, reviewStatus: string, verifyStatus: string }>} changes
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ succeeded: Array<{ slug: string }>, skipped: Array<{ slug: string, reason: string }>, failed: Array<{ slug: string, error: string }> }>}
 */
export async function batchVerifyPass(projectRoot, changes, options = {}) {
  const result = { succeeded: [], skipped: [], failed: [] }

  for (const change of changes) {
    // Skip if no verify.md
    if (!change.verify) {
      result.skipped.push({ slug: change.slug, reason: 'verify.md not generated' })
      continue
    }

    // Skip if review not approved
    if (change.reviewStatus !== 'approved') {
      result.skipped.push({ slug: change.slug, reason: 'review not approved' })
      continue
    }

    // Skip if already passed
    if (change.verifyStatus === 'pass') {
      result.skipped.push({ slug: change.slug, reason: 'already passed' })
      continue
    }

    if (options.dryRun) {
      result.succeeded.push({ slug: change.slug })
      continue
    }

    try {
      const verifyPath = join(change.dir, 'verify.md')
      const parsed = parseFrontmatterDocument(change.verify)
      const newData = { ...parsed.data, status: 'pass', verifiedAt: new Date().toISOString().slice(0, 10) }
      const updated = stringifyFrontmatter(parsed.content, newData)
      await writeFileAtomic(verifyPath, updated)
      result.succeeded.push({ slug: change.slug })
    } catch (err) {
      result.failed.push({ slug: change.slug, error: err.message })
    }
  }

  return result
}

// ── Batch Archive ────────────────────────────────────────────────────────────

/**
 * Bulk-archive verified changes.
 *
 * Eligibility: verifyStatus === 'pass' (or --force).
 * Archive logic mirrors the single-change archive: copy to archive dir, update
 * proposal status, remove from active, update traceability.
 *
 * @param {string} projectRoot
 * @param {Array<{ slug: string, dir: string, verify: string, verifyStatus: string, proposal: string }>} changes
 * @param {{ dryRun?: boolean, force?: boolean }} [options]
 * @param {object} [deps] — injectable dependencies for traceability/registry
 * @returns {Promise<{ succeeded: Array<{ slug: string, archiveName: string }>, skipped: Array<{ slug: string, reason: string }>, failed: Array<{ slug: string, error: string }> }>}
 */
export async function batchArchive(projectRoot, changes, options = {}, deps = {}) {
  const result = { succeeded: [], skipped: [], failed: [] }
  const date = new Date().toISOString().slice(0, 10)
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive')

  for (const change of changes) {
    // Skip if verify not passed (unless force)
    if (change.verifyStatus !== 'pass' && !options.force) {
      result.skipped.push({ slug: change.slug, reason: 'verify not passed' })
      continue
    }

    // Skip if no verify.md at all and not force
    if (!change.verify && !options.force) {
      result.skipped.push({ slug: change.slug, reason: 'verify.md not generated' })
      continue
    }

    if (options.dryRun) {
      const archiveName = `${date}-${change.slug}`
      result.succeeded.push({ slug: change.slug, archiveName })
      continue
    }

    try {
      await ensureDir(archiveDir)
      const archiveName = `${date}-${change.slug}`
      const destDir = join(archiveDir, archiveName)

      // Copy to archive
      await cp(change.dir, destDir, { recursive: true })

      // Update archived proposal status
      const archivedProposalPath = join(destDir, 'proposal.md')
      const archivedProposal = (await readFileSafe(archivedProposalPath)) ?? ''
      const parsedProposal = parseFrontmatterDocument(archivedProposal)
      const newProposalData = { ...parsedProposal.data, status: 'archived', archived: date }
      const updatedProposal = stringifyFrontmatter(parsedProposal.content, newProposalData)
      await writeFileAtomic(archivedProposalPath, updatedProposal)

      // Remove from active
      await rm(change.dir, { recursive: true, force: true })

      // Update traceability (mark linked stories as implemented)
      const storyIds = parseStoryReferences(archivedProposal)
      if (storyIds.length && deps.registry) {
        for (const storyId of storyIds) {
          deps.registry.markStoryImplemented(storyId, archiveName)
        }
      }

      result.succeeded.push({ slug: change.slug, archiveName })
    } catch (err) {
      result.failed.push({ slug: change.slug, error: err.message })
    }
  }

  return result
}

// ── Batch Status ─────────────────────────────────────────────────────────────

/**
 * Aggregate status counts across all (or filtered) active changes.
 *
 * @param {string} projectRoot
 * @param {Array<{ slug: string, state: string, reviewStatus: string, verifyStatus: string }>} changes
 * @returns {{ total: number, byState: Record<string, number>, changes: Array<object> }}
 */
export function batchStatus(projectRoot, changes) {
  const byState = {}

  for (const change of changes) {
    const state = change.state ?? 'active'
    byState[state] = (byState[state] ?? 0) + 1
  }

  return {
    total: changes.length,
    byState,
    changes: changes.map((c) => ({
      slug: c.slug,
      state: c.state,
      reviewStatus: c.reviewStatus,
      verifyStatus: c.verifyStatus,
    })),
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a batch result for human-readable table output.
 *
 * @param {{ succeeded: Array, skipped: Array, failed: Array }} result
 * @param {string} operationLabel
 * @returns {string}
 */
export function formatBatchTable(result, operationLabel) {
  const lines = []
  lines.push(`Batch ${operationLabel} summary:`)
  lines.push(`  Succeeded: ${result.succeeded.length}`)
  lines.push(`  Skipped:   ${result.skipped.length}`)
  lines.push(`  Failed:    ${result.failed.length}`)

  if (result.succeeded.length > 0) {
    lines.push('')
    lines.push('  Succeeded:')
    for (const item of result.succeeded) {
      const extra = item.archiveName ? ` → ${item.archiveName}` : ''
      lines.push(`    ✓ ${item.slug}${extra}`)
    }
  }

  if (result.skipped.length > 0) {
    lines.push('')
    lines.push('  Skipped:')
    for (const item of result.skipped) {
      lines.push(`    ○ ${item.slug} (${item.reason})`)
    }
  }

  if (result.failed.length > 0) {
    lines.push('')
    lines.push('  Failed:')
    for (const item of result.failed) {
      lines.push(`    ✗ ${item.slug}: ${item.error}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format a batch result as JSON.
 *
 * @param {object} result
 * @returns {string}
 */
export function formatBatchJson(result) {
  return JSON.stringify(result, null, 2)
}

/**
 * Format a batch status result for human-readable output.
 *
 * @param {{ total: number, byState: Record<string, number>, changes: Array }} status
 * @returns {string}
 */
export function formatStatusTable(status) {
  const lines = []
  lines.push(`Active changes: ${status.total}`)
  lines.push('')

  const stateLabels = { draft: 'Draft', active: 'Active', reviewed: 'Reviewed', verified: 'Verified' }
  for (const [state, count] of Object.entries(status.byState).sort()) {
    const label = stateLabels[state] ?? state
    lines.push(`  ${label.padEnd(10)} ${count}`)
  }

  if (status.changes.length > 0) {
    lines.push('')
    lines.push('  Changes:')
    for (const c of status.changes) {
      lines.push(`    ${c.slug}  [${c.state}]  review:${c.reviewStatus}  verify:${c.verifyStatus}`)
    }
  }

  return lines.join('\n')
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Stringify a frontmatter document (content + data) without requiring gray-matter's stringify.
 *
 * @param {string} content  The body (after frontmatter)
 * @param {object} data     The frontmatter data object
 * @returns {string}
 */
function stringifyFrontmatter(content, data) {
  const entries = Object.entries(data)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: ~`
      if (Array.isArray(value)) return `${key}: [${value.join(', ')}]`
      return `${key}: ${value}`
    })
    .join('\n')
  return `---\n${entries}\n---\n\n${content.trimStart()}`
}
