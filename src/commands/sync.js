import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { runTwoPassSync } from '../core/sync-engine.js'
import { checkAllDrift } from '../core/drift-detector.js'
import { computeConflict, applyResolution } from '../core/resolver.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { createInterface } from 'readline'

/**
 * @param {string} projectRoot
 * @param {{ rules?: string[], allowPlugins?: boolean, force?: boolean, resolve?: boolean }} [options]
 */
export async function syncCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Sync  v2')
  logger.br()

  // Warn if both --force and --resolve are set
  if (options.force && options.resolve) {
    logger.warn('Both --force and --resolve specified — --force takes precedence.')
    logger.br()
  }

  const registry = new Registry(projectRoot)
  await registry.load()

  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })

  let rules
  if (options.rules?.length && !options.rules.includes('all')) {
    rules = allRules.filter((r) => options.rules.includes(r.id))
    if (rules.length === 0) {
      logger.error(`No rules matched: ${options.rules.map((r) => chalk.bold(r)).join(', ')}`)
      logger.br()
      logger.info('Available rule IDs:')
      for (const r of allRules) {
        logger.row(`  [Pass ${r.pass}]`, r.id, chalk.cyan)
      }
      logger.br()
      process.exit(1)
    }
    const unmatched = options.rules.filter((id) => !allRules.some((r) => r.id === id))
    if (unmatched.length) {
      logger.warn(
        `Unknown rule ID(s): ${unmatched.map((u) => chalk.bold(u)).join(', ')} — skipping.`,
      )
      logger.br()
    }
  } else {
    rules = allRules
  }

  registry.setLoadedRules(rules)

  // Build the onConflict callback for --resolve mode
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
      console.log(`  ${chalk.bold('1')}  Accept source  ${chalk.dim('— overwrite managed section with re-extracted content')}`)
      console.log(`  ${chalk.bold('2')}  Keep target   ${chalk.dim('— preserve manual edits inside managed section')}`)
      console.log(`  ${chalk.bold('s')}  Skip          ${chalk.dim('— skip this rule and continue sync')}`)
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
  const { passA, passB } = await runTwoPassSync(projectRoot, registry, rules, {
    force: !!options.force,
    onConflict,
  })

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
  const changed = all.filter((r) => r.changed).length
  const skipped = all.length - changed
  const bothChangedSkipped = all.filter(
    (r) => !r.changed && r.message.includes('BOTH_CHANGED'),
  )
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)

  logger.header('Summary')
  logger.success(`${changed} rule(s) synced, ${skipped} skipped — ${elapsed}s`)

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

  if (changed > 0 && !bothChangedSkipped.length) {
    logger.br()
    logger.info(`Run ${chalk.cyan('specfuse drift')} to verify all pairs are IN_SYNC.`)
    logger.info(`Run ${chalk.cyan('specfuse diff')}  to preview next-cycle changes.`)
  }
  logger.br()
}

function printResults(results) {
  for (const r of results) {
    if (r.changed) {
      logger.success(r.ruleId)
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
