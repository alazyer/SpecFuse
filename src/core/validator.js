import { join, relative } from 'path'
import { readdir, readFile } from 'fs/promises'
import { readFileSafe, pathExists, listFiles } from '../utils/fs.js'
import {
  extractH2Section,
  extractH2SectionAny,
  extractAllH2Sections,
} from '../utils/markdown.js'
import {
  extractAcceptanceCriteria,
  parseFrontmatterDocument,
  normalizeChangeStatus,
  normalizeReviewStatus,
  normalizeVerifyStatus,
  CHANGE_STATUS_ORDER,
  REVIEW_STATUS_ORDER,
  VERIFY_STATUS_ORDER,
} from '../utils/change-artifacts.js'
import { logger } from '../utils/logger.js'

// ── Result constructors (same pattern as doctor.js) ───────────────────────

const PASS = (id, msg, file, line) => ({ id, state: 'PASS', message: msg, file, line })
const WARN = (id, msg, fix, file, line) => ({ id, state: 'WARN', message: msg, remediation: fix, file, line })
const FAIL = (id, msg, fix, file, line) => ({ id, state: 'FAIL', message: msg, remediation: fix, file, line })

// ── Artifact section schemas ──────────────────────────────────────────────
// Required H2 headings per artifact type, derived from templates/.

const ARTIFACT_SECTION_SCHEMA = {
  prd: {
    label: 'PRD',
    path: '.specfuse/plan/prd.md',
    requiredSections: ['Overview', 'Non-Functional Requirements', 'Technical Constraints'],
  },
  arch: {
    label: 'Architecture',
    path: '.specfuse/plan/architecture.md',
    requiredSections: ['Architectural Decisions', 'Tech Stack'],
  },
  'design-system': {
    label: 'Design System',
    path: '.specfuse/plan/design/system.md',
    requiredSections: ['Design Tokens', 'Accessibility Rules'],
  },
  proposal: {
    label: 'Proposal',
    path: '.specfuse/changes', // directory — each subdirectory has proposal.md
    requiredSections: ['Overview', 'Scope', 'Acceptance Criteria'],
  },
  story: {
    label: 'Story',
    path: '.specfuse/plan/stories', // directory — each .md is a story
    requiredSections: ['Description', 'Acceptance Criteria'],
  },
}

// ── Frontmatter schemas ───────────────────────────────────────────────────

const FRONTMATTER_SCHEMA = {
  proposal: {
    required: ['status', 'created'],
    validStatuses: CHANGE_STATUS_ORDER,
    statusKey: 'status',
    normalizeStatus: normalizeChangeStatus,
  },
  review: {
    required: ['status'],
    validStatuses: REVIEW_STATUS_ORDER,
    statusKey: 'status',
    normalizeStatus: normalizeReviewStatus,
  },
  verify: {
    required: ['status'],
    validStatuses: VERIFY_STATUS_ORDER,
    statusKey: 'status',
    normalizeStatus: normalizeVerifyStatus,
  },
}

/**
 * Return the static artifact section schema (for external use / testing).
 */
export function getArtifactSectionSchema() {
  return ARTIFACT_SECTION_SCHEMA
}

// ── 1. checkRequiredSections ─────────────────────────────────────────────

/**
 * Validate that each existing artifact file contains all required H2 sections.
 * Missing section → WARN (artifact may be a work-in-progress).
 * Section exists but empty → WARN.
 */
export async function checkRequiredSections(projectRoot) {
  const results = []
  const schema = getArtifactSectionSchema()

  // Single-file artifacts: prd, arch, design-system
  for (const [type, spec] of Object.entries(schema)) {
    if (type === 'proposal' || type === 'story') continue // handled separately
    const filePath = join(projectRoot, spec.path)
    if (!pathExists(filePath)) continue // skip missing artifacts

    const content = await readFileSafe(filePath)
    if (!content) continue

    for (const section of spec.requiredSections) {
      const extracted = extractH2Section(content, section)
      if (extracted === null) {
        results.push(
          WARN(
            `sections:${type}:${section.toLowerCase().replace(/\s+/g, '-')}`,
            `${spec.label} is missing required section "${section}".`,
            `Add a "## ${section}" heading to ${spec.path}.`,
            spec.path,
          ),
        )
      } else if (extracted.trim() === '') {
        results.push(
          WARN(
            `sections:${type}:${section.toLowerCase().replace(/\s+/g, '-')}`,
            `${spec.label} section "${section}" is empty.`,
            `Add content under "## ${section}" in ${spec.path}.`,
            spec.path,
          ),
        )
      } else {
        results.push(
          PASS(
            `sections:${type}:${section.toLowerCase().replace(/\s+/g, '-')}`,
            `${spec.label} has section "${section}".`,
            spec.path,
          ),
        )
      }
    }
  }

  // Proposals — each change directory
  const proposalResults = await checkDirectorySections(
    projectRoot,
    join(projectRoot, schema.proposal.path),
    'proposal',
    schema.proposal,
  )
  results.push(...proposalResults)

  // Stories — each .md in stories directory
  const storyResults = await checkStorySections(
    projectRoot,
    join(projectRoot, schema.story.path),
    schema.story,
  )
  results.push(...storyResults)

  // If no results at all, no artifacts were found
  if (results.length === 0) {
    results.push(PASS('sections', 'No spec artifacts found — nothing to validate.'))
  }

  return results
}

async function checkDirectorySections(projectRoot, dirPath, type, spec) {
  const results = []
  if (!pathExists(dirPath)) return results

  let entries = []
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return results
  }

  const changeDirs = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
  for (const entry of changeDirs) {
    const filePath = join(dirPath, entry.name, 'proposal.md')
    if (!pathExists(filePath)) continue

    const content = await readFileSafe(filePath)
    if (!content) continue

    for (const section of spec.requiredSections) {
      const sectionId = section.toLowerCase().replace(/\s+/g, '-')
      const extracted = extractH2Section(content, section)
      if (extracted === null) {
        results.push(
          WARN(
            `sections:proposal:${entry.name}:${sectionId}`,
            `Proposal "${entry.name}" is missing section "${section}".`,
            `Add "## ${section}" to .specfuse/changes/${entry.name}/proposal.md.`,
          ),
        )
      } else if (extracted.trim() === '') {
        results.push(
          WARN(
            `sections:proposal:${entry.name}:${sectionId}`,
            `Proposal "${entry.name}" section "${section}" is empty.`,
            `Add content under "## ${section}" in the proposal.`,
          ),
        )
      } else {
        results.push(
          PASS(
            `sections:proposal:${entry.name}:${sectionId}`,
            `Proposal "${entry.name}" has section "${section}".`,
          ),
        )
      }
    }
  }

  return results
}

async function checkStorySections(projectRoot, dirPath, spec) {
  const results = []
  if (!pathExists(dirPath)) return results

  const files = await listFiles(dirPath, '.md')
  for (const filePath of files) {
    const content = await readFileSafe(filePath)
    if (!content) continue

    const fileName = filePath.split('/').pop().replace('.md', '')

    for (const section of spec.requiredSections) {
      const sectionId = section.toLowerCase().replace(/\s+/g, '-')
      const extracted = extractH2Section(content, section)
      if (extracted === null) {
        results.push(
          WARN(
            `sections:story:${fileName}:${sectionId}`,
            `Story "${fileName}" is missing section "${section}".`,
            `Add "## ${section}" to the story file.`,
          ),
        )
      } else if (extracted.trim() === '') {
        results.push(
          WARN(
            `sections:story:${fileName}:${sectionId}`,
            `Story "${fileName}" section "${section}" is empty.`,
            `Add content under "## ${section}" in the story file.`,
          ),
        )
      } else {
        results.push(
          PASS(
            `sections:story:${fileName}:${sectionId}`,
            `Story "${fileName}" has section "${section}".`,
          ),
        )
      }
    }
  }

  return results
}

// ── 2. checkAcceptanceCriteria ────────────────────────────────────────────

/**
 * Validate acceptance criteria format in proposals and stories.
 * Each AC item must be a `- [ ]` checklist with non-empty text.
 */
export async function checkAcceptanceCriteria(projectRoot) {
  const results = []

  // Proposals
  const changesDir = join(projectRoot, '.specfuse', 'changes')
  if (pathExists(changesDir)) {
    let entries = []
    try {
      entries = await readdir(changesDir, { withFileTypes: true })
    } catch {
      /* skip */
    }
    const changeDirs = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
    for (const entry of changeDirs) {
      const proposalPath = join(changesDir, entry.name, 'proposal.md')
      if (!pathExists(proposalPath)) continue
      const content = await readFileSafe(proposalPath)
      if (!content) continue
      results.push(...validateACForFile(content, `proposal:${entry.name}`, 'proposal'))
    }

    // Also check archive proposals
    const archiveDir = join(changesDir, 'archive')
    if (pathExists(archiveDir)) {
      let archiveEntries = []
      try {
        archiveEntries = await readdir(archiveDir, { withFileTypes: true })
      } catch {
        /* skip */
      }
      const archiveDirs = archiveEntries.filter((e) => e.isDirectory())
      for (const entry of archiveDirs) {
        const proposalPath = join(archiveDir, entry.name, 'proposal.md')
        if (!pathExists(proposalPath)) continue
        const content = await readFileSafe(proposalPath)
        if (!content) continue
        results.push(...validateACForFile(content, `proposal:archive/${entry.name}`, 'proposal'))
      }
    }
  }

  // Stories
  const storiesDir = join(projectRoot, '.specfuse', 'plan', 'stories')
  if (pathExists(storiesDir)) {
    const files = await listFiles(storiesDir, '.md')
    for (const filePath of files) {
      const content = await readFileSafe(filePath)
      if (!content) continue
      const fileName = filePath.split('/').pop().replace('.md', '')
      results.push(...validateACForFile(content, `story:${fileName}`, 'story'))
    }
  }

  if (results.length === 0) {
    results.push(PASS('ac', 'No proposals or stories found — nothing to check.'))
  }

  return results
}

function validateACForFile(content, artifactId, type) {
  const results = []
  const section = extractH2SectionAny(content, [
    'Acceptance Criteria',
    'AC',
    'Done When',
    'Criteria',
  ])

  if (!section) {
    results.push(
      WARN(
        `ac:${artifactId}:missing`,
        `${type} "${artifactId.split(':').pop()}" has no Acceptance Criteria section.`,
        `Add "## Acceptance Criteria" with - [ ] checklist items.`,
      ),
    )
    return results
  }

  const lines = section.content.split('\n').map((l) => l.trim())

  // Find lines that look like AC items — checkbox or plain bullet
  const acLines = lines.filter((l) => /^- \[/.test(l) || /^-\s+\S/.test(l))
  const checkboxLines = lines.filter((l) => /^- \[[ xX]\]/.test(l))
  const emptyCheckboxLines = lines.filter((l) => /^- \[[ xX]\]\s*$/.test(l))
  const plainBulletLines = lines.filter((l) => /^-\s+\S/.test(l) && !/^- \[/.test(l))

  if (acLines.length === 0 && plainBulletLines.length === 0) {
    // Section exists but no items at all
    results.push(
      WARN(
        `ac:${artifactId}:empty`,
        `${type} "${artifactId.split(':').pop()}" Acceptance Criteria section is empty.`,
        'Add - [ ] checklist items with verifiable conditions.',
      ),
    )
    return results
  }

  // Check for plain bullets that should be checkboxes
  if (plainBulletLines.length > 0 && checkboxLines.length === 0) {
    results.push(
      WARN(
        `ac:${artifactId}:format`,
        `${type} "${artifactId.split(':').pop()}" AC items use plain bullets instead of - [ ] checkboxes.`,
        'Convert bullet items to "- [ ] item" format for trackable acceptance criteria.',
      ),
    )
    return results
  }

  // Check for empty checkbox text
  if (emptyCheckboxLines.length > 0) {
    results.push(
      WARN(
        `ac:${artifactId}:empty-text`,
        `${type} "${artifactId.split(':').pop()}" has ${emptyCheckboxLines.length} empty checkbox item(s).`,
        'Add descriptive text after each - [ ] checkbox.',
      ),
    )
    return results
  }

  results.push(
    PASS(
      `ac:${artifactId}:format`,
      `${type} "${artifactId.split(':').pop()}" acceptance criteria are well-formed (${checkboxLines.length} item(s)).`,
    ),
  )
  return results
}

// ── 3. checkManagedMarkers ────────────────────────────────────────────────

/**
 * Validate managed-section markers across ALL .md files under .specfuse/.
 * Every start must have a matching end. End before start → FAIL. Nested → FAIL.
 */
export async function checkManagedMarkers(projectRoot) {
  const results = []
  const specfuseDir = join(projectRoot, '.specfuse')
  if (!pathExists(specfuseDir)) {
    results.push(PASS('markers', '.specfuse/ not found — nothing to check.'))
    return results
  }

  const mdFiles = await collectMarkdownFiles(specfuseDir)
  if (mdFiles.length === 0) {
    results.push(PASS('markers', 'No markdown files found — nothing to check.'))
    return results
  }

  for (const filePath of mdFiles) {
    const relPath = relative(projectRoot, filePath)
    const content = await readFileSafe(filePath)
    if (!content) continue

    const starts = content.match(/<!-- specfuse:[^:]+:start -->/g) ?? []
    const ends = content.match(/<!-- specfuse:[^:]+:end -->/g) ?? []

    // No markers at all — skip
    if (starts.length === 0 && ends.length === 0) continue

    // Mismatched count
    if (starts.length !== ends.length) {
      results.push(
        FAIL(
          `markers:${relPath.replace(/[/\\\\]/g, ':')}`,
          `${relPath}: unclosed managed section markers (${starts.length} start, ${ends.length} end).`,
          `Inspect ${relPath} for missing <!-- specfuse:*:end --> or <!-- specfuse:*:start --> markers.`,
        ),
      )
      continue
    }

    // Check order: end before start, or nesting
    let depth = 0
    let nested = false
    let endBeforeStart = false
    const markerRegex = /<!-- specfuse:([^:]+):(start|end) -->/g
    let match

    while ((match = markerRegex.exec(content)) !== null) {
      const [, , type] = match
      if (type === 'start') {
        depth++
        if (depth > 1) nested = true
      } else {
        if (depth === 0) endBeforeStart = true
        depth--
      }
    }

    if (endBeforeStart) {
      results.push(
        FAIL(
          `markers:${relPath.replace(/[/\\\\]/g, ':')}`,
          `${relPath}: end marker appears before its matching start marker.`,
          `Reorder markers in ${relPath} so each end follows its start.`,
        ),
      )
    } else if (nested) {
      results.push(
        FAIL(
          `markers:${relPath.replace(/[/\\\\]/g, ':')}`,
          `${relPath}: nested managed sections detected.`,
          `Remove inner <!-- specfuse:*:start/end --> markers in ${relPath}.`,
        ),
      )
    } else {
      results.push(
        PASS(
          `markers:${relPath.replace(/[/\\\\]/g, ':')}`,
          `${relPath}: ${starts.length} managed section(s) correctly paired.`,
        ),
      )
    }
  }

  if (results.length === 0) {
    results.push(PASS('markers', 'No managed section markers found in any files.'))
  }

  return results
}

async function collectMarkdownFiles(dir) {
  const files = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        files.push(...(await collectMarkdownFiles(fullPath)))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath)
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return files
}

// ── 4. checkFrontmatter ──────────────────────────────────────────────────

/**
 * Validate frontmatter fields for proposals, reviews, and verify docs.
 * Missing required key → WARN. Invalid status value → WARN. YAML parse error → FAIL.
 */
export async function checkFrontmatter(projectRoot) {
  const results = []

  // Check proposals (active + archive)
  const changesDir = join(projectRoot, '.specfuse', 'changes')
  if (pathExists(changesDir)) {
    const changeDirs = await getChangeDirectories(changesDir, true)
    for (const dirName of changeDirs) {
      const proposalPath = join(changesDir, dirName, 'proposal.md')
      if (pathExists(proposalPath)) {
        results.push(
          ...(await validateFrontmatterForFile(proposalPath, 'proposal', `proposal:${dirName}`)),
        )
      }
      // Also check review.md and verify.md
      const reviewPath = join(changesDir, dirName, 'review.md')
      if (pathExists(reviewPath)) {
        results.push(
          ...(await validateFrontmatterForFile(reviewPath, 'review', `review:${dirName}`)),
        )
      }
      const verifyPath = join(changesDir, dirName, 'verify.md')
      if (pathExists(verifyPath)) {
        results.push(
          ...(await validateFrontmatterForFile(verifyPath, 'verify', `verify:${dirName}`)),
        )
      }
    }
  }

  if (results.length === 0) {
    results.push(PASS('frontmatter', 'No change artifacts found — nothing to check.'))
  }

  return results
}

async function validateFrontmatterForFile(filePath, type, artifactId) {
  const results = []
  const relPath = relative('.', filePath)

  const content = await readFileSafe(filePath)
  if (!content) return results

  let parsed
  try {
    parsed = parseFrontmatterDocument(content)
  } catch (err) {
    results.push(
      FAIL(
        `frontmatter:${artifactId}`,
        `${artifactId} has malformed YAML frontmatter: ${err.message}`,
        `Fix the frontmatter syntax in ${relPath}.`,
      ),
    )
    return results
  }

  const schema = FRONTMATTER_SCHEMA[type]
  if (!schema) return results

  // Check required keys
  for (const key of schema.required) {
    if (!(key in parsed.data) || parsed.data[key] === null || parsed.data[key] === undefined || parsed.data[key] === '') {
      results.push(
        WARN(
          `frontmatter:${artifactId}:${key}`,
          `${artifactId} is missing required frontmatter key "${key}".`,
          `Add "${key}" to the frontmatter of ${relPath}.`,
        ),
      )
    } else {
      // Check valid status values
      if (key === schema.statusKey && schema.validStatuses) {
        const normalized = String(parsed.data[key]).trim().toLowerCase()
        if (!schema.validStatuses.includes(normalized)) {
          results.push(
            WARN(
              `frontmatter:${artifactId}:${key}`,
              `${artifactId} has invalid status "${parsed.data[key]}" (expected: ${schema.validStatuses.join(', ')}).`,
              `Change "${key}" to one of: ${schema.validStatuses.join(', ')}.`,
            ),
          )
        } else {
          results.push(
            PASS(
              `frontmatter:${artifactId}:${key}`,
              `${artifactId} has valid ${key}: "${parsed.data[key]}".`,
            ),
          )
        }
      } else {
        results.push(
          PASS(
            `frontmatter:${artifactId}:${key}`,
            `${artifactId} has required key "${key}".`,
          ),
        )
      }
    }
  }

  return results
}

async function getChangeDirectories(changesDir, includeArchive = false) {
  const dirs = []
  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'archive') {
        dirs.push(entry.name)
      }
    }
    if (includeArchive) {
      const archiveDir = join(changesDir, 'archive')
      if (pathExists(archiveDir)) {
        const archiveEntries = await readdir(archiveDir, { withFileTypes: true })
        for (const entry of archiveEntries) {
          if (entry.isDirectory()) {
            dirs.push(`archive/${entry.name}`)
          }
        }
      }
    }
  } catch {
    /* skip */
  }
  return dirs
}

// ── 5. checkChangeStructure ───────────────────────────────────────────────

/**
 * Validate change directory structure.
 * Each change dir must contain proposal.md. Flat .md files in changes/ → WARN.
 */
export async function checkChangeStructure(projectRoot) {
  const results = []
  const changesDir = join(projectRoot, '.specfuse', 'changes')
  if (!pathExists(changesDir)) {
    results.push(PASS('change-structure', '.specfuse/changes/ not found — no changes in flight.'))
    return results
  }

  let flatFiles = []
  let changeDirs = []
  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    flatFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'))
    changeDirs = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
  } catch {
    /* skip */
  }

  // Warn on flat .md files
  if (flatFiles.length > 0) {
    results.push(
      WARN(
        'change-structure:flat-files',
        `Found ${flatFiles.length} flat .md file(s) in .specfuse/changes/ — expected directories.`,
        'Run `specfuse change new <n>` to create properly structured change proposals.',
      ),
    )
  }

  // Check each change dir for proposal.md
  for (const entry of changeDirs) {
    const proposalPath = join(changesDir, entry.name, 'proposal.md')
    if (!pathExists(proposalPath)) {
      results.push(
        FAIL(
          `change-structure:${entry.name}`,
          `Change directory "${entry.name}" is missing proposal.md.`,
          `Create .specfuse/changes/${entry.name}/proposal.md or remove the directory.`,
        ),
      )
    } else {
      results.push(
        PASS(
          `change-structure:${entry.name}`,
          `Change "${entry.name}" has proposal.md.`,
        ),
      )
    }
  }

  if (results.length === 0) {
    results.push(PASS('change-structure', '.specfuse/changes/ exists and is empty.'))
  }

  return results
}

// ── Orchestration ─────────────────────────────────────────────────────────

/**
 * Run all validation checks and return combined results.
 *
 * @param {string} projectRoot
 * @param {{ artifact?: string }} [options]
 * @returns {Promise<{ results: Array<{ id: string, state: string, message: string, remediation?: string }> }>}
 */
export async function validateArtifacts(projectRoot, options = {}) {
  const artifact = options.artifact ?? 'all'

  let allResults = []

  // Run all checks
  const sectionResults = await checkRequiredSections(projectRoot)
  const acResults = await checkAcceptanceCriteria(projectRoot)
  const markerResults = await checkManagedMarkers(projectRoot)
  const frontmatterResults = await checkFrontmatter(projectRoot)
  const structureResults = await checkChangeStructure(projectRoot)

  allResults = [
    ...sectionResults,
    ...acResults,
    ...markerResults,
    ...frontmatterResults,
    ...structureResults,
  ]

  // Filter by artifact type if specified
  if (artifact !== 'all') {
    const typePrefixes = getArtifactPrefixes(artifact)
    allResults = allResults.filter((r) => typePrefixes.some((p) => r.id.startsWith(p)))
  }

  return { results: allResults }
}

/**
 * Map artifact type name to the ID prefixes used in check results.
 */
function getArtifactPrefixes(artifact) {
  switch (artifact) {
    case 'prd':
      return ['sections:prd:', 'markers:.specfuse:plan:prd']
    case 'arch':
      return ['sections:arch:', 'markers:.specfuse:plan:architecture']
    case 'design-system':
      return ['sections:design-system:', 'markers:.specfuse:plan:design:system']
    case 'proposal':
      return ['sections:proposal:', 'ac:proposal:', 'frontmatter:proposal:', 'frontmatter:review:', 'frontmatter:verify:', 'change-structure:', 'markers:.specfuse:changes']
    case 'story':
      return ['sections:story:', 'ac:story:']
    default:
      return ['']
  }
}
