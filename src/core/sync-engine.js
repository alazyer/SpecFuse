import { join, basename } from 'path'
import { readFileSafe, writeFileAtomic } from '../utils/fs.js'
import { upsertManagedSection, readManagedSection, hashContent } from '../utils/markdown.js'
import { resolveConstitutionPath } from './drift-detector.js'
import { checkAllDrift } from './drift-detector.js'
import { applyResolution } from './resolver.js'
import { buildRuleContext } from './rule-context.js'
import { recordTraceLinks } from './traceability.js'
import { recordEvent, EVENT_TYPES } from './history.js'
import { InterruptedSyncPendingError } from '../api/errors.mjs'
import { logger } from '../utils/logger.js'
import { stat } from 'fs/promises'

/**
 * @typedef {object} SyncResult
 * @property {string}   ruleId
 * @property {boolean}  changed
 * @property {'changed'|'unchanged'|'forced_overwrite'|'skipped'|'skipped_conflict'|'failed'} state
 * @property {string}   message
 * @property {'A'|'B'}  pass
 * @property {string}   [sourceId]    - Source id used for the registry record (when applicable)
 * @property {string}   [targetId]    - Target id used for the registry record (when applicable)
 * @property {string}   [sourceHash]  - Hash of the raw source content this run (when applicable)
 * @property {string}   [targetHash]  - Hash of the proposed managed content this run (when applicable)
 */

async function executeRule(rule, projectRoot, registry, ctx, options = {}) {
  const { force, driftMap, onConflict } = options

  // ── Single-target rule: drift guard ──────────────────────────────────────────
  if (!rule.isMultiTarget && driftMap) {
    const driftResult = driftMap.get(rule.id)
    if (driftResult?.state === 'BOTH_CHANGED') {
      if (force) {
        logger.warn(`${rule.id}: BOTH_CHANGED — overwriting with --force.`)
        // Fall through to normal execution below
      } else if (onConflict) {
        const resolution = await onConflict(rule, driftResult)
        if (resolution) {
          const result = await applyResolution(rule, driftResult, resolution, projectRoot, registry)
          result.pass = rule.pass
          return [result]
        }
        // Resolution declined — skip
        return [
          {
            ruleId: rule.id,
            pass: rule.pass,
            changed: false,
            state: 'skipped_conflict',
            message: `skipped — BOTH_CHANGED conflict, run \`specfuse resolve ${rule.id}\``,
          },
        ]
      } else {
        logger.warn(
          `${rule.id}: BOTH_CHANGED — skipping. Run \`specfuse resolve ${rule.id}\` or use --force.`,
        )
        return [
          {
            ruleId: rule.id,
            pass: rule.pass,
            changed: false,
            state: 'skipped_conflict',
            message: `skipped — BOTH_CHANGED conflict, run \`specfuse resolve ${rule.id}\``,
          },
        ]
      }
    }
  }

  try {
    const extracted = await rule.extract(ctx)
    if (!extracted) {
      return [
        {
          ruleId: rule.id,
          pass: rule.pass,
          changed: false,
          state: 'skipped',
          message: 'Source not found or empty — skipped.',
        },
      ]
    }

    const managedContent = rule.transform(extracted, ctx)
    if (!managedContent) {
      return [
        {
          ruleId: rule.id,
          pass: rule.pass,
          changed: false,
          state: 'skipped',
          message: 'Transform returned empty — skipped.',
        },
      ]
    }

    // Multi-target: inject into each resolved target file (e.g. proposal.md in change dirs)
    if (rule.isMultiTarget && rule.resolveTargets) {
      const targetFiles = await rule.resolveTargets(ctx)
      if (!targetFiles.length) {
        return [
          {
            ruleId: rule.id,
            pass: rule.pass,
            changed: false,
            state: 'skipped',
            message: 'No active change directories found in .specfuse/changes/.',
          },
        ]
      }

      const constitutionContent = await readFileSafe(resolveConstitutionPath(projectRoot))
      const sourceHash = hashContent(constitutionContent ?? '')
      const results = []

      for (const targetFile of targetFiles) {
        const changeDir = basename(join(targetFile, '..')) // parent dir = change name
        const targetId = `changes:${changeDir}`
        const compoundRuleId = `${rule.id}:${changeDir}`

        // Per-target drift guard for multi-target rules
        if (driftMap) {
          const driftResult = driftMap.get(compoundRuleId)
          if (driftResult?.state === 'BOTH_CHANGED') {
            if (force) {
              logger.warn(`${compoundRuleId}: BOTH_CHANGED — overwriting with --force.`)
              // Fall through to normal execution
            } else if (onConflict) {
              const resolution = await onConflict(rule, driftResult)
              if (resolution) {
                const result = await applyResolution(
                  rule,
                  driftResult,
                  resolution,
                  projectRoot,
                  registry,
                )
                result.pass = rule.pass
                results.push({
                  ...result,
                  state: result.state ?? (result.changed ? 'changed' : 'skipped'),
                })
                continue
              }
              // Resolution declined — skip this target
              results.push({
                ruleId: compoundRuleId,
                pass: rule.pass,
                changed: false,
                state: 'skipped_conflict',
                message: `skipped — BOTH_CHANGED conflict, run \`specfuse resolve ${compoundRuleId}\``,
              })
              continue
            } else {
              logger.warn(
                `${compoundRuleId}: BOTH_CHANGED — skipping. Run \`specfuse resolve ${compoundRuleId}\` or use --force.`,
              )
              results.push({
                ruleId: compoundRuleId,
                pass: rule.pass,
                changed: false,
                state: 'skipped_conflict',
                message: `skipped — BOTH_CHANGED conflict, run \`specfuse resolve ${compoundRuleId}\``,
              })
              continue
            }
          }
        }

        // Normal execution for this target
        const existing = (await readFileSafe(targetFile)) ?? ''
        const currentSection = readManagedSection(existing, rule.section) ?? ''
        const targetHash = hashContent(managedContent)

        // Compare-before-write: if the proposed managed content is byte-identical
        // to what is already on disk, this is a true no-op — skip the write and
        // the registry recordSync (so syncedAt is not bumped).
        // `--force` bypasses the check (user explicitly wants the overwrite).
        if (!force && currentSection.trim() === managedContent.trim()) {
          logger.sync(`${rule.id} → ${changeDir}/proposal.md [${rule.section}] (unchanged)`)
          results.push({
            ruleId: compoundRuleId,
            pass: rule.pass,
            changed: false,
            state: 'unchanged',
            message: `No content change — [${rule.section}] in ${changeDir}/proposal.md unchanged.`,
            sourceId: 'constitution',
            targetId,
            sourceHash,
            targetHash,
          })
          continue
        }

        const updated = upsertManagedSection(existing, rule.section, managedContent)

        // Non-determinism heuristic (per-target): compare to the prior sync
        // record for this source/target pair (read BEFORE recordSync).
        const priorSync = registry.getLastSync('constitution', targetId)
        const nonDeterministic =
          !!priorSync &&
          priorSync.sourceHash === sourceHash &&
          priorSync.targetHash !== targetHash

        await writeFileAtomic(targetFile, updated)
        registry.recordSync('constitution', targetId, sourceHash, targetHash)

        logger.sync(`${rule.id} → ${changeDir}/proposal.md [${rule.section}]`)
        results.push({
          ruleId: compoundRuleId,
          pass: rule.pass,
          changed: true,
          state: force ? 'forced_overwrite' : 'changed',
          message: `Injected [${rule.section}] into ${changeDir}/proposal.md.`,
          sourceId: 'constitution',
          targetId,
          sourceHash,
          targetHash,
          nonDeterministic,
        })
      }
      return results
    }

    // Single-target rule
    const targetPath =
      rule.target === '.specfuse/constitution.md'
        ? resolveConstitutionPath(projectRoot)
        : join(projectRoot, rule.target)

    const existing = (await readFileSafe(targetPath)) ?? defaultConstitution()

    // Source hash: use raw file content so drift-detector comparisons align
    const rawSourcePath = join(projectRoot, rule.source)
    const sourceStats = await stat(rawSourcePath).catch(() => null)
    const rawFileContent = sourceStats?.isDirectory()
      ? `dir:${rule.source}`
      : ((await readFileSafe(rawSourcePath)) ?? '')

    const sourceHash = hashContent(rawFileContent)
    const targetHash = hashContent(managedContent)

    // Compare-before-write: if the proposed managed content is byte-identical
    // to what is already on disk, this is a true no-op — skip the write and
    // registry.recordSync (so syncedAt is not bumped for unchanged content).
    // A missing managed section (currentSection === '' because the section
    // markers are absent) is treated as "differs" so the first sync writes
    // normally and reports `changed`, not `unchanged`.
    // `--force` bypasses the check (user explicitly wants the overwrite).
    const currentSection = readManagedSection(existing, rule.section) ?? ''
    if (!force && currentSection.trim() !== '' && currentSection.trim() === managedContent.trim()) {
      logger.sync(`${rule.id} [${rule.section}] (unchanged)`)
      return [
        {
          ruleId: rule.id,
          pass: rule.pass,
          changed: false,
          state: 'unchanged',
          message: `No content change — [${rule.section}] in ${rule.target} unchanged.`,
          sourceId: rule.source,
          targetId: rule.target,
          sourceHash,
          targetHash,
        },
      ]
    }

    const updated = upsertManagedSection(existing, rule.section, managedContent)

    // Non-determinism heuristic: compare this run's hashes to the prior sync
    // record (read BEFORE recordSync overwrites it). If the source hash is
    // unchanged but the transformed output differs, the transform() is likely
    // non-deterministic. Reactive detection only — the rule still runs.
    const priorSync = registry.getLastSync(rule.source, rule.target)
    const nonDeterministic =
      !!priorSync &&
      priorSync.sourceHash === sourceHash &&
      priorSync.targetHash !== targetHash

    await writeFileAtomic(targetPath, updated)
    registry.recordSync(rule.source, rule.target, sourceHash, targetHash)

    logger.sync(`${rule.id} [${rule.section}]`)
    return [
      {
        ruleId: rule.id,
        pass: rule.pass,
        changed: true,
        state: force ? 'forced_overwrite' : 'changed',
        message: `Synced [${rule.section}] to ${rule.target}.`,
        sourceId: rule.source,
        targetId: rule.target,
        sourceHash,
        targetHash,
        nonDeterministic,
      },
    ]
  } catch (err) {
    logger.error(`Rule ${rule.id} failed: ${err.message}`)
    logger.debug(err.stack ?? '')
    return [
      {
        ruleId: rule.id,
        pass: rule.pass,
        changed: false,
        state: 'failed',
        message: `Error: ${err.message}`,
      },
    ]
  }
}

/**
 * Build a Map<ruleId, driftResult> from drift check results.
 */
function buildDriftMap(driftResults) {
  const map = new Map()
  for (const r of driftResults) {
    map.set(r.ruleId, r)
  }
  return map
}

/**
 * Collect non-determinism heuristic warnings from sync results.
 * A result flagged `nonDeterministic` means the rule's transform() produced
 * different output for identical source hashes across two runs.
 *
 * @param {SyncResult[]} results
 * @returns {{ type: 'non-deterministic-rule', ruleId: string, message: string }[]}
 */
function detectNonDeterminism(results) {
  const warnings = []
  for (const r of results) {
    if (r.nonDeterministic) {
      warnings.push({
        type: 'non-deterministic-rule',
        ruleId: r.ruleId,
        message: `Rule '${r.ruleId}' produced different output with identical sources — transform may be non-deterministic.`,
      })
    }
  }
  return warnings
}

// ── Crash-recovery journal (Improvement 2 — sync-atomicity-and-recovery) ──────
//
// The journal makes an interrupted two-pass sync detectable and reconcilable.
// Before any target-file mutation, `runTwoPassSync` persists a `pendingSync`
// marker holding: a deep copy of the pre-sync registry state (the snapshot) and
// a manifest of every target file the run intends to write, with the exact
// transformed content that would land on disk. The marker is cleared only after
// the final `registry.save()` succeeds, so a crash in between leaves a resolvable
// marker rather than a silently-stale registry. On the next invocation the
// marker is detected and reconciled: intended writes are replayed from the
// manifest (preferred) or the registry is rolled back to the snapshot (fallback
// when replay is impossible, e.g. the source was deleted).

/**
 * Deep-copy the pre-sync registry state that recovery may need to restore. Only
 * the mutation-prone collections are snapshotted — `version`, `projectName`,
 * and similar scalars are not touched by a sync run and need no rollback.
 *
 * @param {Registry} registry
 * @returns {{ syncs: object, traces: object, artifacts: object, phase: string }}
 */
function snapshotRegistryState(registry) {
  return {
    syncs: JSON.parse(JSON.stringify(registry.data?.syncs ?? {})),
    traces: JSON.parse(JSON.stringify(registry.data?.traces ?? {})),
    artifacts: JSON.parse(JSON.stringify(registry.data?.artifacts ?? {})),
    phase: registry.data?.phase ?? 'unknown',
  }
}

/**
 * Compute the target-file manifest for a set of rules WITHOUT writing anything
 * to disk. For each rule that would actually perform a write (i.e. the rule is
 * not skipped, skipped_conflict, or unchanged), record the target path, the
 * source/target hashes, and the exact transformed content that the run intends
 * to inject. This is the read-only pre-image of `executeRule`'s write path.
 *
 * The manifest is the recovery source of truth: a replay uses the recorded
 * `transformedContent` (not a re-run of `transform()`) so non-deterministic or
 * since-edited sources do not diverge the recovered state from the intended one.
 *
 * @param {string} projectRoot
 * @param {object[]} rules
 * @param {object} ctx
 * @param {{ force?: boolean, driftMap?: Map } } [options]
 * @returns {Promise<object[]>} manifest entries
 */
async function computeManifest(projectRoot, rules, ctx, options = {}) {
  const { force, driftMap } = options
  const manifest = []

  for (const rule of rules) {
    // Resolve the per-rule drift result the same way executeRule does.
    const driftResult =
      driftMap && !rule.isMultiTarget ? driftMap.get(rule.id) : null
    const bothChanged = driftResult?.state === 'BOTH_CHANGED'

    // A BOTH_CHANGED rule that is not forced is skipped_conflict — no write
    // intended, so it is excluded from the manifest (recovery won't replay it).
    if (bothChanged && !force) continue

    let extracted
    try {
      extracted = await rule.extract(ctx)
    } catch {
      // An extract that throws would be a `failed` rule — no write intended.
      continue
    }
    if (!extracted) continue // skipped — no write

    const managedContent = rule.transform(extracted, ctx)
    if (!managedContent) continue // transform empty — skipped, no write

    // Multi-target rule: one manifest entry per resolved target file.
    if (rule.isMultiTarget && rule.resolveTargets) {
      const targetFiles = await rule.resolveTargets(ctx)
      const constitutionContent = await readFileSafe(resolveConstitutionPath(projectRoot))
      const sourceHash = hashContent(constitutionContent ?? '')

      for (const targetFile of targetFiles) {
        const changeDir = basename(join(targetFile, '..'))
        const targetId = `changes:${changeDir}`
        const compoundRuleId = `${rule.id}:${changeDir}`

        // Per-target BOTH_CHANGED guard mirrors executeRule.
        const targetDrift = driftMap?.get(compoundRuleId)
        if (targetDrift?.state === 'BOTH_CHANGED' && !force) continue

        const existing = (await readFileSafe(targetFile)) ?? ''
        const currentSection = readManagedSection(existing, rule.section) ?? ''
        // Compare-before-write: an unchanged section is a no-op — skip the
        // manifest entry so replay does not touch an already-consistent file.
        if (!force && currentSection.trim() === managedContent.trim()) continue

        manifest.push({
          ruleId: compoundRuleId,
          section: rule.section,
          targetPath: targetFile,
          sourceId: 'constitution',
          targetId,
          sourceHash,
          targetHash: hashContent(managedContent),
          transformedContent: managedContent,
        })
      }
      continue
    }

    // Single-target rule.
    const targetPath =
      rule.target === '.specfuse/constitution.md'
        ? resolveConstitutionPath(projectRoot)
        : join(projectRoot, rule.target)

    const existing = (await readFileSafe(targetPath)) ?? defaultConstitution()
    const currentSection = readManagedSection(existing, rule.section) ?? ''
    // First sync (missing managed section) is treated as "differs" so it writes
    // normally — mirror executeRule's `currentSection.trim() !== ''` guard.
    if (!force && currentSection.trim() !== '' && currentSection.trim() === managedContent.trim()) {
      continue
    }

    const rawSourcePath = join(projectRoot, rule.source)
    const sourceStats = await stat(rawSourcePath).catch(() => null)
    const rawFileContent = sourceStats?.isDirectory()
      ? `dir:${rule.source}`
      : ((await readFileSafe(rawSourcePath)) ?? '')

    manifest.push({
      ruleId: rule.id,
      section: rule.section,
      targetPath,
      sourceId: rule.source,
      targetId: rule.target,
      sourceHash: hashContent(rawFileContent),
      targetHash: hashContent(managedContent),
      transformedContent: managedContent,
    })
  }

  return manifest
}

/**
 * Reconcile an interrupted prior sync detected via a stale `pendingSync`
 * marker. Prefers replaying intended writes from the manifest (preserves
 * concurrent edits); falls back to rolling the registry back to the pre-sync
 * snapshot when replay is impossible (e.g. a manifest source file was deleted
 * and the target can no longer be made consistent).
 *
 * Mutates the registry in place: replayed writes update `recordSync` so the
 * registry hash comes into agreement with the on-disk content (or the content
 * is rolled back to match the registry). The caller persists the result and
 * clears the marker.
 *
 * @param {string} projectRoot
 * @param {Registry} registry
 * @returns {Promise<object>} recovery summary
 */
async function reconcileInterruptedSync(projectRoot, registry) {
  const marker = registry.getPendingSync()
  const manifest = Array.isArray(marker?.manifest) ? marker.manifest : []
  const snapshot = marker?.snapshot ?? null
  const startedAt = marker?.startedAt ?? null

  let replayed = 0
  let rolledBack = 0
  const notes = []

  // Replay preferred: for each intended write, ensure the on-disk managed
  // section matches the manifest's transformedContent. If it already matches
  // (the write landed before the crash, or was a no-op), reconcile the
  // registry record and move on — no file write needed.
  for (const entry of manifest) {
    // The whole read-compare-write is guarded: a target that cannot be read OR
    // written (e.g. parent directory missing/unusable) is an unreplayable
    // entry that the snapshot-rollback fallback handles below.
    let existing = ''
    try {
      existing = (await readFileSafe(entry.targetPath)) ?? ''
    } catch (err) {
      notes.push(`replay failed for ${entry.ruleId} → ${entry.targetPath}: ${err.message}`)
      continue
    }
    const currentSection = readManagedSection(existing, entry.section) ?? ''

    if (currentSection.trim() === entry.transformedContent.trim()) {
      // On disk already agrees with the intended content — just bring the
      // registry hash into agreement so the rule is not reported IN_SYNC on a
      // stale hash (the core correctness requirement).
      registry.recordSync(entry.sourceId, entry.targetId, entry.sourceHash, entry.targetHash)
      continue
    }

    // The section differs from the intended content. Could be: the write never
    // landed (replay it), or a concurrent edit landed instead (replay still
    // wins — the manifest records the run's intent).
    try {
      const updated = upsertManagedSection(existing, entry.section, entry.transformedContent)
      await writeFileAtomic(entry.targetPath, updated)
      registry.recordSync(entry.sourceId, entry.targetId, entry.sourceHash, entry.targetHash)
      replayed++
    } catch (err) {
      // Replay impossible for this target (e.g. target directory deleted).
      // Record the note; if a snapshot exists we fall back to rollback below.
      notes.push(`replay failed for ${entry.ruleId} → ${entry.targetPath}: ${err.message}`)
    }
  }

  // Snapshot-rollback fallback: only when a manifest entry could not be
  // replayed AND a pre-sync snapshot exists. Roll the mutation-prone registry
  // collections back to the pre-sync state so the registry no longer claims
  // outcomes for a run whose target writes did not land consistently.
  if (notes.length > 0 && snapshot) {
    if (snapshot.syncs) registry.data.syncs = JSON.parse(JSON.stringify(snapshot.syncs))
    if (snapshot.traces) registry.data.traces = JSON.parse(JSON.stringify(snapshot.traces))
    if (snapshot.artifacts) registry.data.artifacts = JSON.parse(JSON.stringify(snapshot.artifacts))
    if (snapshot.phase) registry.data.phase = snapshot.phase
    rolledBack = notes.length
    notes.unshift('One or more manifest writes could not be replayed — rolled back to the pre-sync snapshot.')
  }

  // The marker is cleared by the caller after save(); surface the outcome.
  const recovery = {
    performed: true,
    priorStartedAt: startedAt,
    strategy: rolledBack > 0 ? 'rollback' : 'replay',
    replayedWrites: replayed,
    rolledBackEntries: rolledBack,
    manifestEntries: manifest.length,
    notes,
    consistent: true,
  }

  // Record a recovery history event for forensic debugging (open question 1).
  recordEvent(
    registry,
    EVENT_TYPES.recovery,
    `Recovered interrupted sync (started ${startedAt ?? 'unknown'}): ${replayed} write(s) replayed, ${rolledBack} rolled back.`,
    { strategy: recovery.strategy, replayedWrites: replayed, rolledBackEntries: rolledBack },
  )

  return recovery
}

/**
 * Run all sync rules in two passes.
 * Pass A (inbound → constitution) runs first and completes before Pass B.
 * Pass B (constitution → targets) always sees a fully-settled constitution.
 *
 * The run is wrapped in a crash-recovery journal: a `pendingSync` marker
 * (pre-sync registry snapshot + target-file manifest) is persisted before any
 * target-file mutation and cleared only after the final `registry.save()`
 * succeeds. On entry, a stale marker from a prior interrupted run is detected
 * and reconciled (replay preferred, snapshot-rollback fallback). The `recovery`
 * field in the result is null on a clean run and an object describing the
 * reconciliation when one was performed.
 *
 * @param {string}  projectRoot
 * @param {object}  registry
 * @param {object[]} rules
 * @param {{ force?: boolean, onConflict?: Function, noRecover?: boolean }} [options]
 * @returns {Promise<{ passA: object[], passB: object[], warnings: object[], recovery: object|null }>}
 */
export async function runTwoPassSync(projectRoot, registry, rules, options = {}) {
  // ── Recovery: detect and reconcile a prior interrupted run ────────────────
  // The marker is written before any mutation and cleared after the final save,
  // so its presence here means the prior run was interrupted. Reconcile first,
  // then proceed with the new sync on a consistent baseline. The whole reconcile
  // (and the run that follows) sits inside the caller's withLock.
  let recovery = null
  const staleMarker = registry.getPendingSync()
  if (staleMarker) {
    if (options.noRecover) {
      // Operator asked to inspect state first — surface the marker rather than
      // silently reconciling. The CLI/API maps this to INTERRUPTED_SYNC_PENDING.
      throw new InterruptedSyncPendingError(
        `An interrupted sync from ${staleMarker.startedAt ?? 'an unknown time'} is pending recovery. ` +
          `Re-run \`specfuse sync\` to reconcile automatically, or inspect .specfuse/registry.json. ` +
          `Use --no-recover only to decline recovery (this run is aborted).`,
        { startedAt: staleMarker.startedAt, manifestEntries: (staleMarker.manifest ?? []).length },
      )
    }
    logger.warn(
      `Detected an interrupted sync from ${staleMarker.startedAt ?? 'an unknown time'} — reconciling before proceeding.`,
    )
    recovery = await reconcileInterruptedSync(projectRoot, registry)
    registry.clearPendingSync()
    await registry.save()
    logger.warn(
      `Recovery complete: ${recovery.replayedWrites} write(s) replayed, ${recovery.rolledBackEntries} rolled back via ${recovery.strategy}.`,
    )
  }

  const ctx = buildRuleContext(projectRoot)
  const passA = rules.filter((r) => r.pass === 'A')
  const passB = rules.filter((r) => r.pass === 'B')

  logger.info(`Pass A — ${passA.length} inbound rule(s) (→ constitution)`)

  // Compute drift state for Pass A rules
  const driftResultsA = await checkAllDrift(projectRoot, registry, passA)
  const driftMapA = buildDriftMap(driftResultsA)

  // ── Journal: persist the pendingSync marker before any target mutation ──
  // The manifest is computed read-only (extract+transform per rule, no writes)
  // so it captures the run's exact intended writes. Persisting it now means a
  // crash at any later point leaves a resolvable marker instead of a silently
  // stale registry. Two extra writeFileAtomic calls per run (marker + clear)
  // are negligible against per-rule writes.
  const startedAt = new Date().toISOString()
  const manifestA = await computeManifest(projectRoot, passA, ctx, {
    force: !!options.force,
    driftMap: driftMapA,
  })
  registry.setPendingSync({
    snapshot: snapshotRegistryState(registry),
    manifest: manifestA,
    startedAt,
  })
  await registry.save()

  const passAResults = []
  let passAFailed = false

  for (const rule of passA) {
    const results = await executeRule(rule, projectRoot, registry, ctx, {
      ...options,
      driftMap: driftMapA,
    })
    passAResults.push(...results)
    if (results.some((r) => r.state === 'failed')) passAFailed = true
  }

  if (passAFailed) {
    logger.error('Pass A had errors — skipping Pass B to prevent writing stale headers.')
    await registry.save()
    // Clear the marker now that the registry reflects the partial Pass A
    // outcome — recovery has already reconciled any prior run, and Pass B
    // was skipped so no further writes are pending.
    registry.clearPendingSync()
    await registry.save()
    return {
      passA: passAResults,
      passB: [],
      warnings: detectNonDeterminism(passAResults),
      recovery,
    }
  }

  logger.br()
  logger.info(`Pass B — ${passB.length} outbound rule(s) (constitution →)`)

  // Rebuild context so Pass B sees constitution updated by Pass A
  const freshCtx = buildRuleContext(projectRoot)

  // Re-compute drift for Pass B rules (constitution may have changed during Pass A)
  const driftResultsB = await checkAllDrift(projectRoot, registry, passB)
  const driftMapB = buildDriftMap(driftResultsB)

  // Refresh the manifest with Pass B's intended writes so a crash during Pass B
  // is also recoverable. The snapshot reflects the registry state after Pass A's
  // writes (the new consistent baseline).
  const manifestB = await computeManifest(projectRoot, passB, freshCtx, {
    force: !!options.force,
    driftMap: driftMapB,
  })
  registry.setPendingSync({
    snapshot: snapshotRegistryState(registry),
    manifest: manifestB,
    startedAt,
  })
  await registry.save()

  const passBResults = []

  for (const rule of passB) {
    const results = await executeRule(rule, projectRoot, registry, freshCtx, {
      ...options,
      driftMap: driftMapB,
    })
    passBResults.push(...results)
  }

  // ── Record trace links from active proposals ────────────────────────────────
  await recordTraceLinks(projectRoot, registry)

  await registry.save()

  // ── Journal: clear the marker now that the run is durable ──────────────────
  // The final save() above persisted all per-rule outcomes; clearing the marker
  // now and saving again means an interrupted run is detectable only while
  // writes are genuinely in flight.
  registry.clearPendingSync()
  await registry.save()

  // ── Non-determinism heuristic warnings ─────────────────────────────────────
  // Built from per-rule flags set in executeRule (where the prior-sync hashes
  // were available before recordSync overwrote them).
  const warnings = detectNonDeterminism([...passAResults, ...passBResults])
  for (const w of warnings) {
    logger.warn(
      `${w.ruleId}: rule produced different output with identical sources — ` +
        `transform may be non-deterministic.`,
    )
  }

  return { passA: passAResults, passB: passBResults, warnings, recovery }
}

function defaultConstitution() {
  return `# Project Constitution

> Managed by SpecFuse. Sections inside \`<!-- specfuse:*:start/end -->\` are auto-generated.
> Do not edit content inside those markers — add custom rules below.

---

## Core Principles

*(Add your project's guiding principles here)*

## Technical Constraints

*(Add technical constraints here)*

## Code Standards

*(Add code quality and style rules here)*

## Security Rules

*(Add security requirements here)*
`
}
