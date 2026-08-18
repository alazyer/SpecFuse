/**
 * SpecFuse sync/observability API functions.
 *
 * Extracted from src/api.mjs for module consistency.
 * Uses shared core sync-service for behavior parity with CLI.
 */

import { resolve as resolvePath } from 'path'
import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { executeSync, selectSyncRules } from '../core/sync-service.js'
import { checkAllDrift } from '../core/drift-detector.js'
import { diagnoseArtifactRoots } from '../core/artifact-diagnostics.js'
import { computeDiffWithProposed, groupByFile, applyDiff, formatStat } from '../core/differ.js'
import { applyResolution } from '../core/resolver.js'
import { detectPhase } from '../core/phase-detector.js'
import { InvalidArgumentError, ArtifactNotFoundError } from './errors.mjs'

/**
 * Run sync rules in two passes.
 *
 * Each result in `passA`/`passB` carries a structured `state` field, one of:
 * `'changed'`, `'unchanged'`, `'forced_overwrite'`, `'skipped'`,
 * `'skipped_conflict'`, or `'failed'`. The `unchanged` state marks a true
 * no-op — the proposed content was byte-identical to the on-disk managed
 * section, so no file was written and `syncedAt` was not bumped.
 *
 * The result also carries a `recovery` field: `null` on a clean run, or an
 * object describing a reconciliation that was performed for a prior interrupted
 * sync (what was replayed/rolled back, the strategy used). Pass
 * `{ noRecover: true }` to decline automatic recovery — an interrupted prior
 * sync is then surfaced as an `InterruptedSyncPendingError` (code
 * `INTERRUPTED_SYNC_PENDING`) instead of being reconciled, so an operator can
 * inspect state first.
 *
 * Uses shared core sync-service to ensure parity with CLI sync command.
 *
 * @param {{ root?: string, rules?: string[], allowPlugins?: boolean, force?: boolean, noRecover?: boolean }} [options]
 * @returns {Promise<{ passA: object[], passB: object[], warnings: object[], recovery: object|null, tally: object }>}
 */
export async function sync(options = {}) {
  return executeSync({
    root: resolvePath(options.root ?? '.'),
    rules: options.rules,
    allowPlugins: options.allowPlugins,
    force: options.force,
    noRecover: options.noRecover,
  })
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
 * When `apply` is set, written pairs are reconciled into the registry so the
 * next `drift` reports `IN_SYNC` — the apply+record+save sequence runs inside
 * the advisory lock so a concurrent writer (e.g. watch) cannot interleave and
 * silently lose the recorded sync.
 *
 * @param {{ root?: string, rules?: string[], allowPlugins?: boolean, apply?: boolean, stat?: boolean }} [options]
 * @returns {Promise<{ diffs: object[], filePatches: object[], applied?: object[] }>}
 */
export async function diff(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const { selected: rules } = selectSyncRules(allRules, options.rules)

  const { diffs, proposedFiles, pairContexts } = await computeDiffWithProposed(projectRoot, rules)
  const filePatches = groupByFile(diffs, proposedFiles, projectRoot)

  const result = { diffs, filePatches }

  if (options.apply) {
    // Guard the load-apply-record-save sequence with the advisory lock so a
    // concurrent writer cannot interleave and overwrite the recorded sync.
    // Mirrors the resolve() path's locked transaction.
    const registry = new Registry(projectRoot)
    result.applied = await registry.withLock(async (reg) => {
      await reg.load()
      const applied = await applyDiff(projectRoot, proposedFiles, pairContexts, reg)
      await reg.save()
      return applied
    })
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
 * `choice` selects the resolution strategy:
 * - `'source'` — overwrite the managed section with re-extracted content.
 * - `'target'` — keep the current managed section (manual edits preserved).
 * - `'merge'` — apply `mergedContent` (requires the `mergedContent` option;
 *   reachable via the interactive editor flow, not the `--choice` CLI flag).
 * - `'skip'` — leave the pair in `BOTH_CHANGED` and make NO registry mutation.
 *   Mirrors the engine's `null`→`skipped_conflict` path: `applyResolution` is
 *   not called for `skip`, so no write and no `recordSync` occurs. The pair
 *   remains resolvable by a later `resolve()`/`sync` call.
 *
 * Note: `skip` is NOT added to the `applyResolution` enum (`source|target|merge`)
 * — it is handled here as a non-mutating early return.
 *
 * @param {{ root?: string, ruleId: string, choice: 'source'|'target'|'merge'|'skip', mergedContent?: string }} options
 * @returns {Promise<{ ruleId: string, changed: boolean, message: string }>}
 */
export async function resolve(options = {}) {
  const projectRoot = resolvePath(options.root ?? '.')
  const { ruleId, choice, mergedContent } = options

  if (!ruleId) throw new InvalidArgumentError('ruleId is required for resolve().', { argument: 'ruleId' })
  if (!['source', 'target', 'merge', 'skip'].includes(choice)) {
    throw new InvalidArgumentError(`Invalid choice: ${choice}. Must be 'source', 'target', 'merge', or 'skip'.`, {
      argument: 'choice',
      value: choice,
    })
  }
  if (choice === 'merge' && !mergedContent) {
    throw new InvalidArgumentError('mergedContent is required when choice is "merge".', {
      argument: 'mergedContent',
    })
  }

  const registry = new Registry(projectRoot)

  // Guard the load-mutate-save sequence (applyResolution mutates the registry,
  // then we save) with the advisory lock so a concurrent writer cannot
  // interleave and silently lose the resolution.
  const result = await registry.withLock(async (reg) => {
    await reg.load()

    const rules = await loadRules(projectRoot)
    const driftResults = await checkAllDrift(projectRoot, reg, rules)

    const driftResult = driftResults.find((r) => r.ruleId === ruleId)
    if (!driftResult) {
      throw new ArtifactNotFoundError(`Rule not found: ${ruleId}`, {
        artifactType: 'rule',
        name: ruleId,
      })
    }

    if (driftResult.state !== 'BOTH_CHANGED') {
      throw new ArtifactNotFoundError(
        `Rule ${ruleId} is not in a conflicted state (current: ${driftResult.state}). Only BOTH_CHANGED rules can be resolved.`,
        { artifactType: 'rule', name: ruleId },
      )
    }

    // `skip` is a non-mutating choice: do NOT call applyResolution, do NOT
    // recordSync. Leave the pair BOTH_CHANGED for a later resolution. Return
    // a result shaped like the engine's skipped_conflict path.
    if (choice === 'skip') {
      return {
        ruleId,
        changed: false,
        message: 'Resolution skipped — pair left in BOTH_CHANGED.',
      }
    }

    const rule = rules.find((r) => ruleId === r.id || ruleId.startsWith(r.id + ':'))
    if (!rule) {
      throw new ArtifactNotFoundError(`No loaded rule matches ${ruleId}.`, {
        artifactType: 'rule',
        name: ruleId,
      })
    }

    const resolution = { type: choice }
    if (choice === 'merge') {
      resolution.mergedContent = mergedContent
    }

    const resolved = await applyResolution(rule, driftResult, resolution, projectRoot, reg)
    await reg.save()

    return resolved
  })
  return result
}
