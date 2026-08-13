/**
 * Sync service: shared core logic for sync operations used by both CLI and API surfaces.
 * Extracts duplicated rule selection, option normalization, and result shaping logic
 * to ensure behavior parity between CLI sync command and programmatic API sync calls.
 * W2: Deepen CLI/API/core seam for sync workflow
 */

import { Registry } from './registry.js'
import { loadRules } from './rule-loader.js'
import { runTwoPassSync } from './sync-engine.js'

/**
 * Normalize and validate sync options, applying defaults.
 * @param {SyncOptions} options
 * @returns {SyncOptions} Normalized options with defaults applied
 */
export function normalizeSyncOptions(options = {}) {
  return {
    root: options.root ?? process.cwd(),
    rules: options.rules ?? [],
    allowPlugins: !!options.allowPlugins,
    force: !!options.force,
    onConflict: options.onConflict ?? null,
    noRecover: !!options.noRecover,
  }
}

/**
 * Select rules to run based on provided rule IDs, with validation.
 * @param {any[]} allRules All loaded rules
 * @param {string[]} ruleIds Requested rule IDs, empty or ['all'] for all rules
 * @returns {{ selected: any[], unmatched: string[] }} Selected rules and any unmatched rule IDs
 */
export function selectSyncRules(allRules, ruleIds = []) {
  if (!ruleIds.length || ruleIds.includes('all')) {
    return { selected: allRules, unmatched: [] }
  }

  const selected = allRules.filter(rule => ruleIds.includes(rule.id))
  const unmatched = ruleIds.filter(id => !allRules.some(rule => rule.id === id))

  return { selected, unmatched }
}

/**
 * Tally sync results by structured state, normalizing legacy results without state field.
 * @param {any[]} results Combined passA + passB results
 * @returns {object} Tally counts by state
 */
export function tallySyncResults(results) {
  const tally = { changed: 0, unchanged: 0, skipped: 0, failed: 0, forced: 0, conflicted: 0 }
  for (const r of results) {
    switch (r.state) {
      case 'changed':
        tally.changed++
        break
      case 'forced_overwrite':
        tally.forced++
        break
      case 'unchanged':
        tally.unchanged++
        break
      case 'skipped_conflict':
        tally.conflicted++
        break
      case 'failed':
        tally.failed++
        break
      case 'skipped':
      default:
        // Legacy results predating the `state` field fall back to `changed` flag
        if (r.changed) tally.changed++
        else tally.skipped++
        break
    }
  }
  return tally
}

/**
 * Execute sync workflow with the given options, shared between CLI and API.
 * Handles locking, rule loading/selection, and two-pass sync execution.
 * @param {object} options
 * @returns {Promise<object>} Sync result with passA, passB, warnings, recovery, tally
 */
export async function executeSync(options = {}) {
  const normalized = normalizeSyncOptions(options)
  const projectRoot = normalized.root
  const registry = new Registry(projectRoot)

  // Load and select rules outside the lock first (read-only operation)
  const allRules = await loadRules(projectRoot, { allowPlugins: normalized.allowPlugins })
  const { selected: rules } = selectSyncRules(allRules, normalized.rules)

  // Guard the load-mutate-save sequence with the advisory lock to serialize
  // concurrent writers (e.g. watch + manual sync) and prevent lost mutations.
  const result = await registry.withLock(async (reg) => {
    await reg.load()
    reg.setLoadedRules(rules)

    return runTwoPassSync(projectRoot, reg, rules, {
      force: normalized.force,
      onConflict: normalized.onConflict,
      noRecover: normalized.noRecover,
    })
  })

  const allResults = [...result.passA, ...result.passB]
  const tally = tallySyncResults(allResults)

  return {
    passA: result.passA,
    passB: result.passB,
    warnings: result.warnings ?? [],
    recovery: result.recovery ?? null,
    tally,
  }
}
