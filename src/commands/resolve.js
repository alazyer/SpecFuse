import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { checkAllDrift } from '../core/drift-detector.js'
import { computeConflict } from '../core/resolver.js'
import { resolve as resolveSyncOp } from '../api/sync-ops.mjs'
import { logger } from '../utils/logger.js'
import { isInteractive } from '../utils/fs.js'
import chalk from 'chalk'
import { createInterface } from 'readline'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { spawnSync } from 'child_process'

/**
 * Interactive conflict resolution command.
 *
 * Honors a decision matrix over the conflict path:
 *  - `--inspect`            → structured conflict JSON, exit 0 (no mutation).
 *  - `--choice <c>`          → apply source/target, or skip, no prompt.
 *  - no choice + non-TTY/CI → fail fast (non-zero), suggest `--choice`.
 *  - no choice + TTY         → existing interactive prompt.
 * `--json` composes with each cell (structured apply result, or conflict data +
 * non-zero on an unresolvable conflict in a non-interactive context).
 *
 * @param {string} projectRoot
 * @param {{ ruleId: string, json?: boolean, choice?: 'source'|'target'|'skip', inspect?: boolean, root?: string }} options
 */
export async function resolveCommand(projectRoot, options = {}) {
  const ruleId = options.ruleId

  if (!ruleId) {
    logger.error('Usage: specfuse resolve <rule-id>')
    process.exit(1)
  }

  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot)
  const driftResults = await checkAllDrift(projectRoot, registry, rules)

  // Find the drift result for the requested rule
  const driftResult = driftResults.find((r) => r.ruleId === ruleId)

  if (!driftResult) {
    const availableIds = driftResults.map((r) => r.ruleId)
    logger.error(`Rule not found: ${chalk.bold(ruleId)}`)
    if (availableIds.length) {
      logger.info('Available rule IDs:')
      for (const id of availableIds) {
        logger.row(`  ${id}`, '', chalk.dim)
      }
    }
    process.exit(1)
  }

  if (driftResult.state !== 'BOTH_CHANGED') {
    logger.error(`Rule ${chalk.bold(ruleId)} is not in a conflicted state (current: ${chalk.yellow(driftResult.state)}).`)
    logger.info('Only BOTH_CHANGED rules can be resolved.')
    if (options.json) {
      console.log(JSON.stringify({ error: `Rule ${ruleId} is not in a conflicted state (current: ${driftResult.state}).` }))
    }
    process.exit(1)
  }

  // ── Mutual exclusion: --inspect never applies, --choice does. ──────────────
  if (options.inspect && options.choice) {
    logger.error('`--inspect` and `--choice` are mutually exclusive — inspect never applies a resolution.')
    process.exit(1)
  }

  // Find the rule object (for multi-target rules, use the parent rule)
  const rule = rules.find((r) => ruleId === r.id || ruleId.startsWith(r.id + ':'))

  if (!rule) {
    logger.error(`No loaded rule matches ${chalk.bold(ruleId)}.`)
    process.exit(1)
  }

  const conflict = computeConflict(rule, driftResult)

  // ── (a) --inspect: structured conflict data, exit 0 (no mutation). ──────────
  if (options.inspect) {
    console.log(JSON.stringify(conflict, null, 2))
    process.exit(0)
  }

  // ── (b) --choice provided: apply without prompting. ────────────────────────
  if (options.choice) {
    // `--choice skip` leaves the pair conflicted — no registry mutation.
    if (options.choice === 'skip') {
      if (options.json) {
        console.log(
          JSON.stringify(
            { ruleId, changed: false, choice: 'skip', message: 'Resolution skipped — pair left in BOTH_CHANGED.' },
            null,
            2,
          ),
        )
      } else {
        logger.header(`Conflict Resolution — ${ruleId}`)
        logger.br()
        logger.info(`Skipped — pair left BOTH_CHANGED, no changes written.`)
        logger.br()
      }
      process.exit(0)
    }

    // source/target: print the diff for review (unless --json), then apply.
    if (!options.json) {
      printDiff(ruleId, conflict)
      logger.br()
    }
    const result = await resolveSyncOp({ root: projectRoot, ruleId, choice: options.choice })
    if (options.json) {
      console.log(JSON.stringify({ ...result, choice: options.choice }, null, 2))
    } else {
      logger.success(result.message)
    }
    process.exit(0)
  }

  // ── (c) no --choice + non-interactive: fail fast (do not hang on stdin). ────
  if (!isInteractive()) {
    const guide = `Re-run with --choice source|target|skip, or --inspect for conflict data.`
    if (options.json) {
      // Non-interactive --json on an unresolved conflict: structured conflict
      // data + non-zero exit with guidance (the behavior change from the old
      // always-exit-0 short-circuit; preserved for a TTY below).
      console.log(JSON.stringify({ ...conflict, error: `Rule ${ruleId} has an unresolved BOTH_CHANGED conflict. ${guide}` }, null, 2))
    } else {
      logger.error(`Rule ${chalk.bold(ruleId)} has an unresolved BOTH_CHANGED conflict.`)
      logger.info(guide)
    }
    process.exit(1)
  }

  // ── (d) no --choice + interactive (TTY): existing prompt flow. ─────────────
  // In a TTY, bare --json on a conflict stays exit-0 inspect-like (coordinator
  // decision 3): emit conflict data and exit 0.
  if (options.json) {
    console.log(JSON.stringify(conflict, null, 2))
    process.exit(0)
  }

  logger.header(`Conflict Resolution — ${ruleId}`)
  logger.br()

  logger.info('Source (re-extracted) vs. Target (current managed section):')
  logger.br()

  printDiff(ruleId, conflict)
  logger.br()

  logger.info('Choose a resolution:')
  console.log(`  ${chalk.bold('1')}  Accept source  ${chalk.dim('— overwrite managed section with re-extracted content')}`)
  console.log(`  ${chalk.bold('2')}  Keep target   ${chalk.dim('— preserve manual edits inside managed section')}`)
  console.log(`  ${chalk.bold('3')}  Merge manually ${chalk.dim('— open $EDITOR to resolve conflicts')}`)
  logger.br()

  const choice = await promptChoice()

  if (choice === '1') {
    // Accept source
    const result = await resolveSyncOp({ root: projectRoot, ruleId, choice: 'source' })
    logger.br()
    logger.success(result.message)
  } else if (choice === '2') {
    // Keep target
    const result = await resolveSyncOp({ root: projectRoot, ruleId, choice: 'target' })
    logger.br()
    logger.success(result.message)
  } else if (choice === '3') {
    // Manual merge
    const editor = process.env.EDITOR || process.env.VISUAL || findVi()
    if (!editor) {
      logger.error(
        'No editor available. Set $EDITOR or $VISUAL, or install vi.',
      )
      logger.info(
        'Alternatively, use `specfuse resolve <rule-id> --json` and resolve programmatically.',
      )
      process.exit(1)
    }

    // Write conflict markers to temp file
    const tmpFile = join(tmpdir(), `specfuse-resolve-${randomBytes(6).toString('hex')}.md`)
    const conflictContent =
      `<<<<<<< SOURCE\n${conflict.sourceContent}\n=======\n${conflict.targetContent}\n>>>>>>> TARGET\n`

    try {
      writeFileSync(tmpFile, conflictContent, 'utf8')

      logger.info(`Opening ${chalk.cyan(editor)} on temp conflict file…`)
      logger.info('Resolve the conflict markers, save, and close the editor.')
      logger.br()

      const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' })

      if (result.status !== 0) {
        logger.warn('Editor exited with error — merge aborted, no changes written.')
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
        process.exit(1)
      }

      // Read back the edited content and strip conflict markers
      let edited = readFileSync(tmpFile, 'utf8')

      // Check if conflict markers are still present
      if (edited.includes('<<<<<<< SOURCE') || edited.includes('>>>>>>> TARGET')) {
        logger.warn('Conflict markers still present — merge aborted, no changes written.')
        logger.info('Remove all conflict markers (<<<<<<<, =======, >>>>>>>) and try again.')
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
        process.exit(1)
      }

      // Clean the merged content: strip the ======= separator if it's alone on a line
      edited = edited.replace(/^=======\s*$/gm, '').trim()

      try { unlinkSync(tmpFile) } catch { /* ignore */ }

      const resolutionResult = await resolveSyncOp({
        root: projectRoot,
        ruleId,
        choice: 'merge',
        mergedContent: edited,
      })
      logger.br()
      logger.success(resolutionResult.message)
    } catch (err) {
      logger.error(`Merge failed: ${err.message}`)
      try { unlinkSync(tmpFile) } catch { /* ignore */ }
      process.exit(1)
    }
  } else {
    logger.warn('Invalid choice — no changes written.')
    process.exit(1)
  }

  logger.br()
}

/**
 * Prompt the user for a numeric choice (1, 2, or 3).
 * @returns {Promise<string>}
 */
function promptChoice() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question(chalk.bold('Enter choice (1/2/3): '), (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Print a colorized unified diff of the conflict (source vs. target managed
 * section). Shared by the `--choice` review view and the interactive prompt.
 *
 * @param {string} ruleId
 * @param {{ patch: string }} conflict
 */
function printDiff(ruleId, conflict) {
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
}

/**
 * Try to find `vi` on PATH.
 * @returns {string|null}
 */
function findVi() {
  try {
    const result = spawnSync('which', ['vi'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) return 'vi'
  } catch { /* ignore */ }
  return null
}
