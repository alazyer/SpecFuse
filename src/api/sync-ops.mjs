/**
 * SpecFuse sync/observability API functions.
 *
 * Extracted from src/api.mjs for module consistency.
 * No behavioral changes — pure refactor.
 */

import { resolve as resolvePath } from 'path'
import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { runTwoPassSync } from '../core/sync-engine.js'
import { checkAllDrift } from '../core/drift-detector.js'
import {
  computeDiffWithProposed,
  groupByFile,
  applyDiff,
  formatStat,
} from '../core/differ.js'
import { applyResolution } from '../core/resolver.js'
import { detectPhase } from '../core/phase-detector.js'

function selectRules(allRules, ruleIds = []) {
  return ruleIds?.length && !ruleIds.includes('all')
    ? allRules.filter((rule) => ruleIds.includes(rule.id))
    : allRules
}

/**
 * Run sync rules in two passes.
 *
 * @param {{ root?: string, rules?: string[], allowPlugins?: boolean, force?: boolean }} [options]
 * @returns {Promise<{ passA: object[], passB: object[] }>}
 */
export async function sync(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const registry = new Registry(projectRoot)
  await registry.load()

  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const rules = selectRules(allRules, options.rules)

  return runTwoPassSync(projectRoot, registry, rules, { force: !!options.force })
}

/**
 * Check spec drift across all tracked artifact pairs.
 *
 * @param {{ root?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function drift(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  return checkAllDrift(projectRoot, registry, rules)
}

/**
 * Preview what sync would change without writing anything.
 * Optionally apply changes and/or get file-level grouping.
 *
 * @param {{ root?: string, rules?: string[], allowPlugins?: boolean, apply?: boolean, stat?: boolean }} [options]
 * @returns {Promise<{ diffs: object[], filePatches: object[], applied?: object[] }>}
 */
export async function diff(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const rules = selectRules(allRules, options.rules)

  const { diffs, proposedFiles } = await computeDiffWithProposed(projectRoot, rules)
  const filePatches = groupByFile(diffs, proposedFiles, projectRoot)

  const result = { diffs, filePatches }

  if (options.apply) {
    const applied = await applyDiff(projectRoot, proposedFiles)
    result.applied = applied
  }

  if (options.stat) {
    result.stat = formatStat(filePatches)
  }

  return result
}

/**
 * Get current project status summary.
 *
 * @param {{ root?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function status(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const registry = new Registry(projectRoot)
  await registry.load()

  const { phase, evidence } = await detectPhase(projectRoot)
  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const driftResults = await checkAllDrift(projectRoot, registry, rules)

  return {
    projectRoot,
    projectName: registry.getProjectName(),
    phase,
    evidence,
    hooksInstalled: registry.getHooksInstalled(),
    rules: rules.map((rule) => ({
      id: rule.id,
      pass: rule.pass,
      source: rule.source,
      target: rule.target,
    })),
    drift: driftResults,
  }
}

/**
 * Detect current SpecFuse lifecycle phase.
 *
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ phase: string, evidence: string[] }>}
 */
export async function phase(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  return detectPhase(projectRoot)
}

/**
 * Resolve a BOTH_CHANGED conflict programmatically.
 *
 * @param {{ root?: string, ruleId: string, choice: 'source'|'target'|'merge', mergedContent?: string }} options
 * @returns {Promise<{ ruleId: string, changed: boolean, message: string }>}
 */
export async function resolve(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const { ruleId, choice, mergedContent } = options

  if (!ruleId) throw new Error('ruleId is required for resolve().')
  if (!['source', 'target', 'merge'].includes(choice)) {
    throw new Error(`Invalid choice: ${choice}. Must be 'source', 'target', or 'merge'.`)
  }
  if (choice === 'merge' && !mergedContent) {
    throw new Error('mergedContent is required when choice is "merge".')
  }

  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot)
  const driftResults = await checkAllDrift(projectRoot, registry, rules)

  const driftResult = driftResults.find((r) => r.ruleId === ruleId)
  if (!driftResult) {
    throw new Error(`Rule not found: ${ruleId}`)
  }

  if (driftResult.state !== 'BOTH_CHANGED') {
    throw new Error(
      `Rule ${ruleId} is not in a conflicted state (current: ${driftResult.state}). Only BOTH_CHANGED rules can be resolved.`,
    )
  }

  const rule = rules.find((r) => ruleId === r.id || ruleId.startsWith(r.id + ':'))
  if (!rule) {
    throw new Error(`No loaded rule matches ${ruleId}.`)
  }

  const resolution = { type: choice }
  if (choice === 'merge') {
    resolution.mergedContent = mergedContent
  }

  const result = await applyResolution(rule, driftResult, resolution, projectRoot, registry)
  await registry.save()

  return result
}
