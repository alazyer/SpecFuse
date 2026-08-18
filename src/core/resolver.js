import { createPatch } from 'diff'
import { join, basename } from 'path'
import { readFileSafe, writeFileAtomic } from '../utils/fs.js'
import { upsertManagedSection, hashContent } from '../utils/markdown.js'
import { resolveConstitutionPath } from './drift-detector.js'
import { buildRuleContext } from './rule-context.js'
import { logger } from '../utils/logger.js'
import { InvalidArgumentError } from '../api/errors.mjs'

/**
 * Compute conflict data for a BOTH_CHANGED drift result.
 *
 * @param {object} rule        - Loaded sync rule
 * @param {object} driftResult - BOTH_CHANGED drift entry (must include sourceContent/targetContent)
 * @returns {{ ruleId: string, sourceContent: string, targetContent: string, patch: string }}
 */
export function computeConflict(rule, driftResult) {
  const sourceContent = driftResult.sourceContent ?? ''
  const targetContent = driftResult.targetContent ?? ''

  const patch = createPatch(
    driftResult.ruleId,
    targetContent,
    sourceContent,
    'target (current managed section)',
    'source (re-extracted)',
  )

  return {
    ruleId: driftResult.ruleId,
    sourceContent,
    targetContent,
    patch,
  }
}

/**
 * Apply a conflict resolution choice and update the registry.
 *
 * @param {object}   rule            - Loaded sync rule
 * @param {object}   driftResult     - BOTH_CHANGED drift entry (must include sourceContent/targetContent)
 * @param {object}   resolution      - { type: 'source'|'target'|'merge', mergedContent?: string }
 * @param {string}   projectRoot
 * @param {object}   registry        - Registry instance (will call recordSync)
 * @returns {Promise<{ ruleId: string, changed: boolean, message: string }>}
 */
export async function applyResolution(rule, driftResult, resolution, projectRoot, registry) {
  const { type } = resolution

  if (!['source', 'target', 'merge'].includes(type)) {
    throw new InvalidArgumentError(`Invalid resolution type: ${type}. Must be 'source', 'target', or 'merge'.`, {
      argument: 'type',
      value: type,
    })
  }

  const { ruleId, sourceId, targetId } = driftResult

  if (type === 'target') {
    // Keep target: file stays unchanged, record registry with target hash as both
    const targetContent = driftResult.targetContent ?? ''
    const hash = hashContent(targetContent)
    registry.recordSync(sourceId, targetId, hash, hash)

    logger.success(`${ruleId} — kept target content (manual edits preserved).`)
    return {
      ruleId,
      changed: false,
      message: 'Resolution: kept target content — managed section unchanged.',
    }
  }

  // For 'source' and 'merge', we need to write the resolved content into the managed section
  const resolvedContent =
    type === 'source'
      ? (driftResult.sourceContent ?? '')
      : (resolution.mergedContent ?? '')

  // Determine target file path
  const targetPath = resolveTargetPath(rule, driftResult, projectRoot)
  const existing = (await readFileSafe(targetPath)) ?? ''
  const updated = upsertManagedSection(existing, rule.section, resolvedContent)

  await writeFileAtomic(targetPath, updated)

  // Record sync with hash of resolved content
  const hash = hashContent(resolvedContent)
  registry.recordSync(sourceId, targetId, hash, hash)

  const label = type === 'source' ? 'accepted source content' : 'applied merged content'
  logger.success(`${ruleId} — ${label}.`)

  return {
    ruleId,
    changed: true,
    message: `Resolution: ${label}.`,
  }
}

/**
 * Resolve the target file path from a rule and drift result.
 *
 * For multi-target rules (e.g. constitution→change proposals), the targetId
 * encodes the change name (e.g. "changes:add-login") which maps to a specific
 * proposal.md file.
 *
 * For single-target rules, use rule.target directly.
 */
function resolveTargetPath(rule, driftResult, projectRoot) {
  // Multi-target: targetId like "changes:add-login" → .specfuse/changes/add-login/proposal.md
  if (rule.isMultiTarget && driftResult.targetId?.startsWith('changes:')) {
    const changeName = driftResult.targetId.replace('changes:', '')
    return join(projectRoot, '.specfuse', 'changes', changeName, 'proposal.md')
  }

  // Single-target
  if (rule.target === '.specfuse/constitution.md') {
    return resolveConstitutionPath(projectRoot)
  }

  return join(projectRoot, rule.target)
}
