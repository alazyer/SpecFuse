import { createPatch } from 'diff'
import { readFileSafe, writeFileAtomic } from '../utils/fs.js'
import { upsertManagedSection, readManagedSection } from '../utils/markdown.js'
import { buildRuleContext } from './rule-context.js'
import { resolveConstitutionPath } from './drift-detector.js'
import { join } from 'path'

/**
 * @typedef {object} FileDiff
 * @property {string}   file      - Relative file path
 * @property {string}   section   - Managed section name
 * @property {string}   ruleId
 * @property {number}   added
 * @property {number}   removed
 * @property {string}   patch     - Unified diff patch string
 * @property {boolean}  hasChanges
 */

/**
 * @typedef {object} SectionChange
 * @property {string}   section     - Managed section name
 * @property {string}   ruleId
 * @property {number}   added
 * @property {number}   removed
 * @property {string}   patch       - Unified diff patch string (section-level)
 * @property {boolean}  hasChanges
 */

/**
 * @typedef {object} FilePatch
 * @property {string}           file         - Relative file path
 * @property {SectionChange[]}  sections     - Section changes within this file
 * @property {number}           totalAdded
 * @property {number}           totalRemoved
 * @property {boolean}          hasChanges   - True if any section has changes
 * @property {string}           [patch]      - Full-file unified diff (generated on demand)
 */

/**
 * @typedef {object} AppliedFile
 * @property {string}  file     - Relative file path
 * @property {boolean} written  - Whether the file was successfully written
 * @property {string}  [error]  - Error message if writing failed
 */

/**
 * Compute what `specfuse sync` would change without writing anything.
 *
 * @param {string} projectRoot
 * @param {import('./rule-loader.js').SyncRule[]} rules
 * @returns {Promise<FileDiff[]>}
 */
export async function computeDiff(projectRoot, rules) {
  const { diffs } = await computeDiffWithProposed(projectRoot, rules)
  return diffs
}

/**
 * Compute what `specfuse sync` would change, also returning the proposed
 * file contents so callers can apply them or generate full-file diffs.
 *
 * @param {string} projectRoot
 * @param {import('./rule-loader.js').SyncRule[]} rules
 * @returns {Promise<{ diffs: FileDiff[], proposedFiles: Map<string, string> }>}
 */
export async function computeDiffWithProposed(projectRoot, rules) {
  const ctx = buildRuleContext(projectRoot)
  const diffs = []

  // Pass A rules first (simulate two-pass)
  const ordered = [...rules.filter((r) => r.pass === 'A'), ...rules.filter((r) => r.pass === 'B')]

  // We simulate Pass A writes into memory so Pass B sees the updated constitution
  const memoryFS = new Map() // path → content

  for (const rule of ordered) {
    const extracted = await rule.extract(ctx).catch(() => null)
    if (!extracted) continue

    const managedContent = rule.transform(extracted, ctx)
    if (!managedContent) continue

    if (rule.isMultiTarget && rule.resolveTargets) {
      const targetFiles = await rule.resolveTargets(ctx)
      for (const targetFile of targetFiles) {
        const existing = memoryFS.get(targetFile) ?? (await readFileSafe(targetFile)) ?? ''
        const proposed = upsertManagedSection(existing, rule.section, managedContent)
        const currentSection = readManagedSection(existing, rule.section) ?? ''
        // Normalise to relative path — targetFile may be absolute from resolveTargets()
        const relPath = targetFile.startsWith(projectRoot)
          ? targetFile.slice(projectRoot.length).replace(/^[/\\]/, '')
          : targetFile
        const d = diffSection(currentSection, managedContent, relPath, rule.section, rule.id)
        diffs.push(d)
        memoryFS.set(targetFile, proposed)
      }
      continue
    }

    const targetPath =
      rule.target === '.specfuse/constitution.md'
        ? resolveConstitutionPath(projectRoot)
        : join(projectRoot, rule.target)

    const existing = memoryFS.get(targetPath) ?? (await readFileSafe(targetPath)) ?? ''
    const proposed = upsertManagedSection(existing, rule.section, managedContent)
    const currentSection = readManagedSection(existing, rule.section) ?? ''
    const d = diffSection(currentSection, managedContent, rule.target, rule.section, rule.id)
    diffs.push(d)
    memoryFS.set(targetPath, proposed)
  }

  // Build proposedFiles — only include files that have at least one changed section
  const changedFiles = new Set(diffs.filter((d) => d.hasChanges).map((d) => d.file))
  const proposedFiles = new Map()
  for (const [absPath, content] of memoryFS) {
    const relPath = absPath.startsWith(projectRoot)
      ? absPath.slice(projectRoot.length).replace(/^[/\\]/, '')
      : absPath
    if (changedFiles.has(relPath)) {
      proposedFiles.set(relPath, content)
    }
  }

  return { diffs, proposedFiles }
}

/**
 * Group section-level diffs by target file.
 *
 * @param {FileDiff[]} diffs
 * @param {Map<string, string>} [proposedFiles] - Used to generate full-file patches
 * @param {string} [projectRoot] - Required if proposedFiles is provided
 * @returns {FilePatch[]}
 */
export function groupByFile(diffs, proposedFiles, projectRoot) {
  const fileMap = new Map()

  for (const d of diffs) {
    if (!fileMap.has(d.file)) {
      fileMap.set(d.file, {
        file: d.file,
        sections: [],
        totalAdded: 0,
        totalRemoved: 0,
        hasChanges: false,
      })
    }
    const entry = fileMap.get(d.file)
    entry.sections.push({
      section: d.section,
      ruleId: d.ruleId,
      added: d.added,
      removed: d.removed,
      patch: d.patch,
      hasChanges: d.hasChanges,
    })
    if (d.hasChanges) {
      entry.hasChanges = true
      entry.totalAdded += d.added
      entry.totalRemoved += d.removed
    }
  }

  // Generate full-file unified diff patches if proposedFiles is available
  const result = [...fileMap.values()]
  if (proposedFiles && projectRoot) {
    for (const fp of result) {
      if (fp.hasChanges && proposedFiles.has(fp.file)) {
        const proposedContent = proposedFiles.get(fp.file)
        fp.patch = createPatch(fp.file, '', proposedContent, 'current', 'proposed', {
          context: 3,
        })
        // Strip the header lines (first 4 lines of unified diff format)
        const lines = fp.patch.split('\n')
        if (lines.length > 4) {
          fp.patch = lines.slice(4).join('\n')
        }
      }
    }
  }

  return result
}

/**
 * Write proposed file contents to disk. Does NOT update the registry.
 *
 * @param {string} projectRoot
 * @param {Map<string, string>} proposedFiles - Relative path → proposed content
 * @returns {Promise<AppliedFile[]>}
 */
export async function applyDiff(projectRoot, proposedFiles) {
  const results = []

  for (const [relPath, content] of proposedFiles) {
    const absPath = join(projectRoot, relPath)
    try {
      await writeFileAtomic(absPath, content)
      results.push({ file: relPath, written: true })
    } catch (err) {
      results.push({ file: relPath, written: false, error: err.message })
    }
  }

  return results
}

/**
 * Format a compact stat summary table.
 *
 * @param {FilePatch[]} filePatches
 * @returns {string}
 */
export function formatStat(filePatches) {
  const changed = filePatches.filter((fp) => fp.hasChanges)
  if (!changed.length) return 'No changes.'

  // Calculate column widths
  const maxFile = Math.max(...changed.map((fp) => fp.file.length), 4) // min width for "File"
  const maxSections = Math.max(
    ...changed.map((fp) => String(fp.sections.filter((s) => s.hasChanges).length).length),
    8,
  )

  const header = 'File'.padEnd(maxFile) + '  ' + 'Sections'.padStart(8) + '  ' + '+Added'.padStart(6) + '  ' + '-Removed'.padStart(8)
  const sep = '─'.repeat(maxFile) + '  ' + '─'.repeat(8) + '  ' + '─'.repeat(6) + '  ' + '─'.repeat(8)

  const rows = changed.map((fp) => {
    const sectionCount = fp.sections.filter((s) => s.hasChanges).length
    return (
      fp.file.padEnd(maxFile) +
      '  ' +
      String(sectionCount).padStart(8) +
      '  ' +
      String('+' + fp.totalAdded).padStart(6) +
      '  ' +
      String('-' + fp.totalRemoved).padStart(8)
    )
  })

  return [header, sep, ...rows].join('\n')
}

function diffSection(current, proposed, file, section, ruleId) {
  const a = current.trim()
  const b = proposed.trim()

  const patch = createPatch(`${file} [${section}]`, a + '\n', b + '\n', 'current', 'proposed', {
    context: 3,
  })

  const lines = patch.split('\n').slice(4) // strip file header lines
  const added = lines.filter((l) => l.startsWith('+')).length
  const removed = lines.filter((l) => l.startsWith('-')).length

  return {
    file,
    section,
    ruleId,
    added,
    removed,
    patch: lines.join('\n'),
    hasChanges: a !== b,
  }
}
