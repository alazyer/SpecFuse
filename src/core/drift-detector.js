import { readFileSafe, listFiles, pathExists } from '../utils/fs.js'
import { hashContent, readManagedSection } from '../utils/markdown.js'
import { join, basename } from 'path'
import { readdir, stat } from 'fs/promises'

/** @typedef {'IN_SYNC'|'SOURCE_CHANGED'|'TARGET_CHANGED'|'BOTH_CHANGED'|'NEVER_SYNCED'|'SOURCE_MISSING'} DriftState */

/**
 * Resolve path to constitution.md (always at project root in v4).
 * @param {string} projectRoot
 * @returns {string}
 */
export function resolveConstitutionPath(projectRoot) {
  return join(projectRoot, '.specfuse', 'constitution.md')
}

async function checkSingleRuleDrift(projectRoot, registry, rule) {
  const { sourceId, targetId, ruleId } = ids(rule)
  const sourcePath = join(projectRoot, rule.source)
  const sourceStats = await stat(sourcePath).catch(() => null)
  const sourceIsDir = sourceStats?.isDirectory?.() ?? false
  const sourceContent = sourceIsDir ? `dir:${rule.source}` : await readFileSafe(sourcePath)

  if (!sourceContent && !pathExists(sourcePath)) {
    return {
      ruleId,
      state: 'SOURCE_MISSING',
      sourceId,
      targetId,
      message: `${rule.source} not found.`,
      remediation: getSourceRemedy(rule.source),
    }
  }

  const targetPath =
    rule.target === '.specfuse/constitution.md'
      ? resolveConstitutionPath(projectRoot)
      : join(projectRoot, rule.target)
  const targetContent = await readFileSafe(targetPath)
  const managedSection = targetContent
    ? (readManagedSection(targetContent, rule.section) ?? '')
    : ''

  const currentSourceHash = hashContent(sourceContent ?? '')
  const currentTargetHash = hashContent(managedSection)
  const lastSync = registry.getLastSync(sourceId, targetId)

  if (!lastSync)
    return {
      ruleId,
      state: 'NEVER_SYNCED',
      sourceId,
      targetId,
      message: `${rule.source} has never been synced to ${rule.target} [${rule.section}].`,
      remediation: 'Run `specfuse sync`.',
    }

  const srcChanged = currentSourceHash !== lastSync.sourceHash
  const tgtChanged = currentTargetHash !== lastSync.targetHash

  if (srcChanged && tgtChanged)
    return {
      ruleId,
      state: 'BOTH_CHANGED',
      sourceId,
      targetId,
      message: `Both ${rule.source} and [${rule.section}] changed since last sync.`,
      remediation: 'Run `specfuse resolve <rule-id>` to resolve the conflict.',
      sourceContent: sourceContent ?? '',
      targetContent: managedSection,
    }
  if (srcChanged)
    return {
      ruleId,
      state: 'SOURCE_CHANGED',
      sourceId,
      targetId,
      message: `${rule.source} changed — [${rule.section}] is stale.`,
      remediation: 'Run `specfuse sync`.',
    }
  if (tgtChanged)
    return {
      ruleId,
      state: 'TARGET_CHANGED',
      sourceId,
      targetId,
      message: `Managed [${rule.section}] in ${rule.target} was manually edited.`,
      remediation: `Move edits outside <!-- specfuse:${rule.section}:start/end --> markers.`,
    }

  return {
    ruleId,
    state: 'IN_SYNC',
    sourceId,
    targetId,
    message: `[${rule.section}] in ${rule.target} is current.`,
    remediation: '',
  }
}

async function checkMultiTargetDrift(projectRoot, registry, rule) {
  const constitutionPath = resolveConstitutionPath(projectRoot)
  const constitutionContent = await readFileSafe(constitutionPath)

  if (!constitutionContent) {
    return [
      {
        ruleId: rule.id,
        state: 'SOURCE_MISSING',
        sourceId: rule.source,
        targetId: rule.target,
        message: 'constitution.md not found.',
        remediation: 'Run `specfuse specify init` to create constitution.md.',
      },
    ]
  }

  const changesDir = join(projectRoot, '.specfuse', 'changes')
  let changeDirs = []
  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    changeDirs = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
  } catch {
    return []
  }

  if (!changeDirs.length) return []

  const currentConstitutionHash = hashContent(constitutionContent)

  return Promise.all(
    changeDirs.map(async (entry) => {
      const changeName = entry.name
      const targetId = `changes:${changeName}`
      const ruleId = `${rule.id}:${changeName}`
      const lastSync = registry.getLastSync('constitution', targetId)

      const proposalPath = join(changesDir, changeName, 'proposal.md')
      const proposalContent = await readFileSafe(proposalPath)
      const headerSection = proposalContent
        ? (readManagedSection(proposalContent, rule.section) ?? '')
        : ''
      const currentTargetHash = hashContent(headerSection)

      if (!lastSync)
        return {
          ruleId,
          state: 'NEVER_SYNCED',
          sourceId: rule.source,
          targetId,
          message: `${changeName}/proposal.md: no constitutional header injected yet.`,
          remediation: 'Run `specfuse sync`.',
        }

      const srcChanged = currentConstitutionHash !== lastSync.sourceHash
      const tgtChanged = currentTargetHash !== lastSync.targetHash

      if (!srcChanged && !tgtChanged)
        return {
          ruleId,
          state: 'IN_SYNC',
          sourceId: rule.source,
          targetId,
          message: `${changeName}: constitutional header is current.`,
          remediation: '',
        }

      const state =
        srcChanged && tgtChanged
          ? 'BOTH_CHANGED'
          : srcChanged
            ? 'SOURCE_CHANGED'
            : 'TARGET_CHANGED'

      const result = {
        ruleId,
        state,
        sourceId: rule.source,
        targetId,
        message: `${changeName}: constitutional header is stale.`,
        remediation:
          state === 'BOTH_CHANGED'
            ? 'Run `specfuse resolve <rule-id>` to resolve the conflict.'
            : 'Run `specfuse sync`.',
      }

      if (state === 'BOTH_CHANGED') {
        result.sourceContent = constitutionContent ?? ''
        result.targetContent = headerSection
      }

      return result
    }),
  )
}

export async function checkAllDrift(projectRoot, registry, rules) {
  const results = []
  for (const rule of rules) {
    if (rule.isMultiTarget) {
      results.push(...(await checkMultiTargetDrift(projectRoot, registry, rule)))
    } else {
      results.push(await checkSingleRuleDrift(projectRoot, registry, rule))
    }
  }
  return results
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ids(rule) {
  return { sourceId: rule.source, targetId: rule.target, ruleId: rule.id }
}

function getSourceRemedy(source) {
  if (source.includes('prd')) return 'Run `specfuse plan prd` to create the PRD.'
  if (source.includes('architecture'))
    return 'Run `specfuse plan arch` to create the architecture doc.'
  if (source.includes('design/system'))
    return 'Run `specfuse plan design system` to create the design system doc.'
  if (source.includes('stories')) return 'Run `specfuse plan story` to add user stories.'
  if (source.includes('archive'))
    return 'Archive a completed change with `specfuse change archive <name>`.'
  return 'Create the source artifact first.'
}
