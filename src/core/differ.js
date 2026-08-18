import { createPatch } from 'diff'
import { readFileSafe, writeFileAtomic } from '../utils/fs.js'
import { upsertManagedSection, readManagedSection, hashContent } from '../utils/markdown.js'
import { buildRuleContext } from './rule-context.js'
import { resolveConstitutionPath } from './drift-detector.js'
import { basename, join } from 'path'
import { stat } from 'fs/promises'

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
 * @typedef {object} PairContext
 * @property {string} relPath    - Relative target file path (matches a proposedFiles key)
 * @property {string} sourceId   - Registry source id (rule.source, or 'constitution' for multi-target)
 * @property {string} targetId   - Registry target id (rule.target, or 'changes:<dir>' for multi-target)
 * @property {string} sourceHash - hashContent of the raw source content this run
 * @property {string} targetHash - hashContent of the proposed managed content this run
 * @property {string} section    - Managed section name
 * @property {string} ruleId     - Rule id (compound for multi-target)
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
 * Also returns a `pairContexts` array — one entry per rule/pair that produced a
 * changed section — carrying the exact `sourceId`/`targetId`/`sourceHash`/
 * `targetHash` needed to call `registry.recordSync(...)` after a successful
 * apply. This co-locates the hash contract (mirrored from `sync-engine.js`'s
 * `executeRule`) so `diff --apply` reconciles the registry identically to a
 * `sync` run and the next `drift` reports `IN_SYNC` instead of phantom
 * `TARGET_CHANGED`. Multi-rule-same-file pairs emit one entry per changed
 * section (not deduped by file) so each pair is recorded under its own key.
 *
 * @param {string} projectRoot
 * @param {import('./rule-loader.js').SyncRule[]} rules
 * @returns {Promise<{ diffs: FileDiff[], proposedFiles: Map<string, string>, pairContexts: PairContext[] }>}
 */
export async function computeDiffWithProposed(projectRoot, rules) {
  const ctx = buildRuleContext(projectRoot)
  const diffs = []
  const pairContexts = []

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
      // Multi-target source hash: the FULL constitution file content, shared
      // across every target (mirrors executeRule's multi-target branch).
      const constitutionContent = await readFileSafe(resolveConstitutionPath(projectRoot))
      const sourceHash = hashContent(constitutionContent ?? '')
      const targetHash = hashContent(managedContent)

      for (const targetFile of targetFiles) {
        const existing = memoryFS.get(targetFile) ?? (await readFileSafe(targetFile)) ?? ''
        const proposed = upsertManagedSection(existing, rule.section, managedContent)
        const currentSection = readManagedSection(existing, rule.section) ?? ''
        // Normalise to relative path — targetFile may be absolute from resolveTargets()
        const relPath = targetFile.startsWith(projectRoot)
          ? targetFile.slice(projectRoot.length).replace(/^[/\\]/, '')
          : targetFile
        const changeDir = basename(join(targetFile, '..')) // parent dir = change name
        const compoundRuleId = `${rule.id}:${changeDir}`
        const d = diffSection(currentSection, managedContent, relPath, rule.section, rule.id)
        diffs.push(d)
        if (d.hasChanges) {
          // One pairContext per changed target — recorded under
          // 'constitution' → 'changes:<changeDir>'.
          pairContexts.push({
            relPath,
            sourceId: 'constitution',
            targetId: `changes:${changeDir}`,
            sourceHash,
            targetHash,
            section: rule.section,
            ruleId: compoundRuleId,
          })
        }
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
    if (d.hasChanges) {
      // Single-target source hash: the raw source file content (or 'dir:<source>'
      // when the source is a directory) — mirrors executeRule's single-target
      // branch and drift-detector's sourceIsDir branch.
      const rawSourcePath = join(projectRoot, rule.source)
      const sourceStats = await stat(rawSourcePath).catch(() => null)
      const rawFileContent = sourceStats?.isDirectory()
        ? `dir:${rule.source}`
        : ((await readFileSafe(rawSourcePath)) ?? '')
      pairContexts.push({
        relPath: rule.target,
        sourceId: rule.source,
        targetId: rule.target,
        sourceHash: hashContent(rawFileContent),
        targetHash: hashContent(managedContent),
        section: rule.section,
        ruleId: rule.id,
      })
    }
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

  return { diffs, proposedFiles, pairContexts }
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
 * Write proposed file contents to disk. Optionally record registry sync entries
 * for each successfully written file.
 *
 * When `registry` is null (the default), this is write-only and never touches
 * the registry — preserving backward compatibility for callers that preview or
 * apply without bookkeeping. When `registry` is provided, after each SUCCESSFUL
 * write, every `pairContext` entry whose `relPath` matches the just-written file
 * is recorded via `registry.recordSync(...)` so the next `drift` reports
 * `IN_SYNC` instead of phantom `TARGET_CHANGED` for applied pairs. A failed
 * write (`written: false`) records nothing for that file's pairs — the pair
 * retains its honest prior drift state.
 *
 * This does NOT call `registry.save()` — the caller owns the single save, which
 * keeps the save-once contract (CLI saves once per invocation; the API path
 * saves inside its lock) and mirrors `executeRule`'s write-then-recordSync.
 *
 * @param {string} projectRoot
 * @param {Map<string, string>} proposedFiles - Relative path → proposed content
 * @param {PairContext[]} [pairContexts=[]] - Per-pair context for registry records
 * @param {object} [registry=null] - Registry instance (or null for write-only)
 * @returns {Promise<AppliedFile[]>}
 */
export async function applyDiff(projectRoot, proposedFiles, pairContexts = [], registry = null) {
  const results = []

  for (const [relPath, content] of proposedFiles) {
    const absPath = join(projectRoot, relPath)
    try {
      await writeFileAtomic(absPath, content)
      results.push({ file: relPath, written: true })
      // Record a sync entry for every pair whose content this file carries.
      // Multi-rule-same-file: one file write records multiple per-section pairs.
      if (registry) {
        for (const ctx of pairContexts) {
          if (ctx.relPath === relPath) {
            registry.recordSync(ctx.sourceId, ctx.targetId, ctx.sourceHash, ctx.targetHash)
          }
        }
      }
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
