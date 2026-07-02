/**
 * SpecFuse v4 Programmatic API
 *
 * Embed SpecFuse in other Node.js tools without spawning a subprocess.
 *
 * @example
 * import { sync, drift, diff, status } from 'specfuse/api.mjs';
 *
 * const result = await sync({ root: './my-project' });
 * const report = await drift({ root: './my-project' });
 */

import { resolve } from 'path'
import { Registry } from './core/registry.js'
import { loadRules } from './core/rule-loader.js'
import { runTwoPassSync } from './core/sync-engine.js'
import { checkAllDrift } from './core/drift-detector.js'
import { computeDiff } from './core/differ.js'
import { detectPhase } from './core/phase-detector.js'

function selectRules(allRules, ruleIds = []) {
  return ruleIds?.length && !ruleIds.includes('all')
    ? allRules.filter((rule) => ruleIds.includes(rule.id))
    : allRules
}

/**
 * Run sync rules in two passes.
 *
 * @param {{ root?: string, rules?: string[], allowPlugins?: boolean }} [options]
 * @returns {Promise<{ passA: object[], passB: object[] }>}
 */
export async function sync(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  const registry = new Registry(projectRoot)
  await registry.load()

  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const rules = selectRules(allRules, options.rules)

  return runTwoPassSync(projectRoot, registry, rules)
}

/**
 * Check spec drift across all tracked artifact pairs.
 *
 * @param {{ root?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function drift(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  return checkAllDrift(projectRoot, registry, rules)
}

/**
 * Preview what sync would change without writing anything.
 *
 * @param {{ root?: string, rules?: string[], allowPlugins?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function diff(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const rules = selectRules(allRules, options.rules)
  return computeDiff(projectRoot, rules)
}

/**
 * Get current project status summary.
 *
 * @param {{ root?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function status(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
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
  const projectRoot = resolve(options.root ?? '.')
  return detectPhase(projectRoot)
}

export default {
  sync,
  drift,
  diff,
  status,
  phase,
}
