import { selectSyncRules, executeSync, tallySyncResults } from '../core/sync-service.js'
import { loadRules } from '../core/rule-loader.js'
import { computeConflict, applyResolution } from '../core/resolver.js'
import { InterruptedSyncPendingError } from '../api/errors.mjs'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { createInterface } from 'readline'

/**
 * @param {string} projectRoot
 * @param {{ rules?: string[], allowPlugins?: boolean, force?: boolean, resolve?: boolean, json?: boolean, noRecover?: boolean }} [options]
 */
export async function syncCommand(projectRoot, options = {}) {
  // Human-only banner: suppress entirely in --json mode so stdout is pure JSON.
  if (!options.json) {
    logger.header('SpecFuse Sync  v2')
    logger.br()

    // Warn if both --force and --resolve are set
    if (options.force && options.resolve) {
      logger.warn('Both --force and --resolve specified — --force takes precedence.')
      logger.br()
    }
  }

  // Rule selection validation happens upfront for CLI UX (error reporting for invalid rule IDs)
  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  let selectedRules = allRules
  if (options.rules?.length && !options.rules.includes('all')) {
    const { selected, unmatched } = selectSyncRules(allRules, options.rules)
    selectedRules = selected
    if (selectedRules.length === 0) {
      logger.error(`No rules matched: ${options.rules.map((r) => chalk.bold(r)).join(', ')}`)
      logger.br()
      logger.info('Available rule IDs:')
      for (const r of allRules) {
        logger.row(`  [Pass ${r.pass}]`, r.id, chalk.cyan)
      }
      logger.br()
      process.exit(1)
    }
    if (unmatched.length) {
      logger.warn(
        `Unknown rule ID(s): ${unmatched.map((u) => chalk.bold(u)).join(', ')} — skipping.`,
      )
      logger.br()
    }
  }

  // Build the onConflict callback for --resolve mode (CLI-only interactive behavior)
  let onConflict = null
  if (options.resolve && !options.force) {
    onConflict = async (rule, driftResult) => {
      const conflict = computeConflict(rule, driftResult)

      logger.header(`Conflict — ${driftResult.ruleId}`)
      logger.br()
      logger.info('Source (re-extracted) vs. Target (current managed section):')
      logger.br()

      const diffLines = conflict.patch.split('\n')
      for (const line of diffLines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          console.log(`  ${chalk.green(line)}`)
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          console.log(`  ${chalk.red(line)}`)
        } else if (line.startsWith('@@')) {
          console.log(`  ${chalk.cyan(line)}`)
        } else {
          console.log(`  ${chalk.dim(line)}`)
        }
      }
      logger.br()

      logger.info('Choose a resolution:')
      console.log(
        `  ${chalk.bold('1')}  Accept source  ${chalk.dim('— overwrite managed section with re-extracted content')}`,
      )
      console.log(
        `  ${chalk.bold('2')}  Keep target   ${chalk.dim('— preserve manual edits inside managed section')}`,
      )
      console.log(
        `  ${chalk.bold('s')}  Skip          ${chalk.dim('— skip this rule and continue sync')}`,
      )
      logger.br()

      const choice = await promptChoice()

      if (choice === '1') {
        return { type: 'source' }
      } else if (choice === '2') {
        return { type: 'target' }
      } else if (choice.toLowerCase() === 's') {
        return null // skip
      } else {
        logger.warn('Invalid choice — skipping this rule.')
        return null
      }
    }
  }

  const start = Date.now()
  // In --json mode the engine's per-rule logger.sync()/info() calls would
  // pollute stdout and corrupt the JSON document. Temporarily silence
  // console.log (the logger's stdout channel) around the sync run; warnings
  // still go to stderr via console.warn and are also captured in the
  // `warnings` array for structured consumption.
  const jsonMode = !!options.json
  const origLog = console.log
  if (jsonMode) console.log = () => {}
  let passA, passB, warnings, recovery, tally
  try {
    // Use shared core sync service for parity with API sync
    const result = await executeSync({
      root: projectRoot,
      rules: options.rules,
      allowPlugins: options.allowPlugins,
      force: options.force,
      onConflict,
      noRecover: options.noRecover,
    })
    passA = result.passA
    passB = result.passB
    warnings = result.warnings
    recovery = result.recovery
    tally = result.tally
  } catch (err) {
    // --no-recover with an interrupted prior sync: surface a clear error in
    // both human and JSON modes instead of a raw stack trace. The registry
    // is left untouched (recovery was declined by the operator).
    if (err instanceof InterruptedSyncPendingError) {
      if (jsonMode) {
        console.log = origLog
        console.log(
          JSON.stringify(
            { error: { code: err.code, message: err.message, startedAt: err.startedAt } },
            null,
            2,
          ),
        )
      } else {
        logger.br()
        logger.error(err.message)
        logger.br()
        logger.info(
          `Re-run ${chalk.cyan('specfuse sync')} to reconcile automatically, or inspect .specfuse/registry.json.`,
        )
        logger.br()
      }
      process.exit(1)
    }
    throw err
  } finally {
    if (jsonMode) console.log = origLog
  }

  // ── --json output ───────────────────────────────────────────────────────
  // Full structured result: each rule carries its `state` (which may be
  // `unchanged`), plus a top-level `warnings` array for non-determinism
  // heuristic findings, plus a `recovery` field that is null on a clean run
  // and an object describing a reconciliation when one was performed. A run
  // with zero `changed` rules is distinguishable from a change run via the
  // per-rule `state` / top-level tally.
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          passA,
          passB,
          warnings,
          recovery,
          tally,
        },
        null,
        2,
      ),
    )
    return
  }

  // ── Pass A results ──────────────────────────────────────────────────────
  logger.br()
  logger.header('Pass A — Inbound (→ constitution)')
  printResults(passA)

  // ── Pass B results ──────────────────────────────────────────────────────
  if (passB.length) {
    logger.header('Pass B — Outbound (constitution →)')
    printResults(passB)
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const all = [...passA, ...passB]
  const bothChangedSkipped = all.filter(
    (r) => r.state === 'skipped_conflict' || (!r.changed && r.message.includes('BOTH_CHANGED')),
  )
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)

  logger.header('Summary')
  logger.success(
    `${tally.changed} synced, ${tally.unchanged} unchanged, ${tally.skipped} skipped — ${elapsed}s`,
  )

  // ── Recovery notice ──────────────────────────────────────────────────────
  // When the run reconciled a prior interrupted sync, surface a one-line
  // notice after the Summary so a human operator can tell a clean sync from a
  // recovered one without inspecting the registry.
  if (recovery) {
    logger.br()
    const detail =
      recovery.strategy === 'rollback'
        ? `${recovery.rolledBackEntries} entr(y/ies) rolled back to the pre-sync snapshot`
        : `${recovery.replayedWrites} intended write(s) replayed from the manifest`
    logger.warn(
      `Recovered an interrupted sync from ${recovery.priorStartedAt ?? 'an unknown time'} — ${detail}.`,
    )
    for (const note of recovery.notes ?? []) {
      logger.warn(`  · ${note}`)
    }
  }

  if (warnings.length) {
    logger.br()
    for (const w of warnings) {
      logger.warn(`${w.ruleId}: ${w.message}`)
    }
  }

  if (bothChangedSkipped.length) {
    logger.br()
    logger.warn(`${bothChangedSkipped.length} rule(s) skipped due to BOTH_CHANGED conflict:`)
    for (const r of bothChangedSkipped) {
      console.log(`    ${chalk.bold(r.ruleId)}`)
      console.log(`      ${chalk.dim(r.message)}`)
    }
    logger.br()
    logger.info(
      `Run ${chalk.cyan('specfuse resolve <rule-id>')} to resolve conflicts, or ${chalk.cyan('specfuse sync --force')} to overwrite.`,
    )
  }

  if (tally.changed > 0 && !bothChangedSkipped.length) {
    logger.br()
    logger.info(`Run ${chalk.cyan('specfuse drift')} to verify all pairs are IN_SYNC.`)
    logger.info(`Run ${chalk.cyan('specfuse diff')}  to preview next-cycle changes.`)
  }
  logger.br()
}

/**
 * Tally results by structured state. `unchanged` is counted separately from
 * `skipped`/conflicted so a no-op run is distinguishable from a change run.
 * @param {Array<{ state?: string, changed?: boolean }>} results
 */
function tallyByState(results) {
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
        // Results predating the `state` field fall back to `changed` flag.
        if (r.changed) tally.changed++
        else tally.skipped++
        break
    }
  }
  // `skipped` in the summary lumps non-conflict, non-unchanged non-changed results.
  return tally
}

function printResults(results) {
  for (const r of results) {
    const state = r.state ?? (r.changed ? 'changed' : 'skipped')
    if (state === 'changed' || state === 'forced_overwrite') {
      logger.success(r.ruleId)
      console.log(`              ${chalk.dim(r.message)}`)
    } else if (state === 'unchanged') {
      // Distinct dim checkmark — a true no-op, not an error or a skip.
      console.log(`  ${chalk.green('✔')}  ${chalk.dim(r.ruleId)} ${chalk.dim('· unchanged')}`)
      console.log(`              ${chalk.dim(r.message)}`)
    } else if (state === 'failed') {
      console.log(`  ${chalk.red('✖')}  ${chalk.bold(r.ruleId)}`)
      console.log(`              ${chalk.dim(r.message)}`)
    } else {
      console.log(`  ${chalk.dim('–')}  ${chalk.dim(r.ruleId)}`)
      console.log(`              ${chalk.dim(r.message)}`)
    }
  }
  logger.br()
}

/**
 * Prompt the user for a choice during --resolve mode.
 * @returns {Promise<string>}
 */
function promptChoice() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(chalk.bold('Enter choice (1/2/s): '), (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}
