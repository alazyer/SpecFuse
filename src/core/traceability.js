import { join } from 'path'
import { readdir } from 'fs/promises'
import { readFileSafe, pathExists } from '../utils/fs.js'
import { parseFrontmatterDocument } from '../utils/change-artifacts.js'

const STORIES_DIR = (root) => join(root, '.specfuse', 'plan', 'stories')
const CHANGES_DIR = (root) => join(root, '.specfuse', 'changes')
const ARCHIVE_DIR = (root) => join(CHANGES_DIR(root), 'archive')

/**
 * Parse the `stories:` frontmatter field from a proposal.
 * Returns an array of story ID strings (e.g., ["STORY-001", "STORY-003"]).
 *
 * @param {string} proposalContent  Raw proposal.md content
 * @returns {string[]}
 */
export function parseStoryReferences(proposalContent = '') {
  const { data } = parseFrontmatterDocument(proposalContent)
  const raw = data?.stories
  if (!raw || raw === '~' || raw === null) return []

  // Support both comma-separated string and array
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Scan the stories directory and return a list of story IDs.
 * Story IDs are derived from filenames: STORY-001.md → STORY-001
 *
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
export async function scanStoryIds(projectRoot) {
  const storiesDir = STORIES_DIR(projectRoot)
  if (!pathExists(storiesDir)) return []

  try {
    const entries = await readdir(storiesDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name.replace(/\.md$/, ''))
      .sort()
  } catch {
    return []
  }
}

/**
 * Scan active change proposals and return a map of changeName → storyIds[].
 *
 * @param {string} projectRoot
 * @returns {Promise<Map<string, string[]>>}
 */
export async function scanActiveChangeStories(projectRoot) {
  const changesDir = CHANGES_DIR(projectRoot)
  const result = new Map()

  if (!pathExists(changesDir)) return result

  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive') continue
      const proposalPath = join(changesDir, entry.name, 'proposal.md')
      const content = await readFileSafe(proposalPath)
      if (content) {
        const storyIds = parseStoryReferences(content)
        if (storyIds.length) {
          result.set(entry.name, storyIds)
        }
      }
    }
  } catch {
    /* ignore */
  }

  return result
}

/**
 * Scan archived change proposals and return a map of archiveName → storyIds[].
 *
 * @param {string} projectRoot
 * @returns {Promise<Map<string, string[]>>}
 */
export async function scanArchivedChangeStories(projectRoot) {
  const archiveDir = ARCHIVE_DIR(projectRoot)
  const result = new Map()

  if (!pathExists(archiveDir)) return result

  try {
    const entries = await readdir(archiveDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const proposalPath = join(archiveDir, entry.name, 'proposal.md')
      const content = await readFileSafe(proposalPath)
      if (content) {
        const storyIds = parseStoryReferences(content)
        if (storyIds.length) {
          result.set(entry.name, storyIds)
        }
      }
    }
  } catch {
    /* ignore */
  }

  return result
}

/**
 * Build the complete traceability matrix.
 *
 * Returns an object with:
 *   stories: Array<{ id, status, activeChanges, implementedBy, title }>
 *   unknown: string[]  — story IDs referenced but not found on disk
 *
 * Status values: "active" | "implemented" | "uncovered" | "active+implemented"
 *
 * @param {string} projectRoot
 * @returns {Promise<{ stories: Array, unknown: string[] }>}
 */
export async function buildTraceMatrix(projectRoot) {
  const knownStoryIds = await scanStoryIds(projectRoot)
  const activeMap = await scanActiveChangeStories(projectRoot)
  const archivedMap = await scanArchivedChangeStories(projectRoot)

  // Build lookup: storyId → { active: string[], implementedBy: string|null }
  const traceData = {}

  for (const storyId of knownStoryIds) {
    traceData[storyId] = { active: [], implementedBy: null, title: null }
  }

  // Collect titles from story files
  for (const storyId of knownStoryIds) {
    const storyPath = join(STORIES_DIR(projectRoot), `${storyId}.md`)
    const content = await readFileSafe(storyPath)
    if (content) {
      const titleMatch = content.match(/^#\s+(.+)$/m)
      traceData[storyId].title = titleMatch?.[1]?.trim() ?? null
    }
  }

  // Record active change links
  for (const [changeName, storyIds] of activeMap) {
    for (const storyId of storyIds) {
      if (!traceData[storyId]) {
        traceData[storyId] = { active: [], implementedBy: null, title: null }
      }
      traceData[storyId].active.push(changeName)
    }
  }

  // Record archived change links
  for (const [archiveName, storyIds] of archivedMap) {
    for (const storyId of storyIds) {
      if (!traceData[storyId]) {
        traceData[storyId] = { active: [], implementedBy: null, title: null }
      }
      // Last archived change wins for implementedBy
      traceData[storyId].implementedBy = archiveName
    }
  }

  // Determine status and detect unknown IDs
  const knownSet = new Set(knownStoryIds)
  const unknownIds = new Set()
  const stories = []

  for (const [storyId, data] of Object.entries(traceData)) {
    const hasActive = data.active.length > 0
    const hasImplemented = data.implementedBy !== null

    let status
    if (!knownSet.has(storyId)) {
      status = 'unknown'
      unknownIds.add(storyId)
    } else if (hasActive && hasImplemented) {
      status = 'active+implemented'
    } else if (hasImplemented) {
      status = 'implemented'
    } else if (hasActive) {
      status = 'active'
    } else {
      status = 'uncovered'
    }

    stories.push({
      id: storyId,
      status,
      activeChanges: data.active,
      implementedBy: data.implementedBy,
      title: data.title,
    })
  }

  // Sort: known stories first (by ID), then unknown
  stories.sort((a, b) => {
    const aKnown = knownSet.has(a.id) ? 0 : 1
    const bKnown = knownSet.has(b.id) ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown
    return a.id.localeCompare(b.id, undefined, { numeric: true })
  })

  return { stories, unknown: [...unknownIds] }
}

/**
 * Compute coverage metrics from a trace matrix.
 *
 * @param {{ stories: Array, unknown: string[] }} matrix  Result of buildTraceMatrix
 * @returns {{ total: number, active: number, implemented: number, uncovered: number, coveragePct: number }}
 */
export function computeCoverage(matrix) {
  const knownStories = matrix.stories.filter((s) => s.status !== 'unknown')
  const total = knownStories.length
  const active = knownStories.filter((s) => s.status === 'active' || s.status === 'active+implemented').length
  const implemented = knownStories.filter(
    (s) => s.status === 'implemented' || s.status === 'active+implemented',
  ).length
  const uncovered = knownStories.filter((s) => s.status === 'uncovered').length

  // Stories with coverage = total - uncovered (avoids double-counting active+implemented)
  const withCoverage = total - uncovered
  const coveragePct = total > 0 ? Math.round((withCoverage / total) * 100) : 0

  return { total, active, implemented, uncovered, coveragePct }
}

/**
 * Scan active proposals and record trace links in the registry.
 * Called during sync to keep registry traces up to date.
 *
 * @param {string} projectRoot
 * @param {import('./registry.js').Registry} registry
 */
export async function recordTraceLinks(projectRoot, registry) {
  const activeMap = await scanActiveChangeStories(projectRoot)

  for (const [changeName, storyIds] of activeMap) {
    registry.recordTrace(changeName, storyIds)
  }

  // Also clean up trace links for changes that no longer exist
  const traces = registry.getTraces()
  const activeChangeNames = new Set([...activeMap.keys()])
  for (const record of Object.values(traces)) {
    if (record.active) {
      const stale = record.active.filter((c) => !activeChangeNames.has(c))
      for (const changeName of stale) {
        // The change was removed from active — if archived, the archive
        // handler should have already called markStoryImplemented
        registry.removeTraceLinks(changeName)
      }
    }
  }
}
