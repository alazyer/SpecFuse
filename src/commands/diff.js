import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import {
  computeDiffWithProposed,
  groupByFile,
  applyDiff,
  formatStat,
} from '../core/differ.js'
import { logger } from '../utils/logger.js'
import { readFileSafe } from '../utils/fs.js'
import { createPatch } from 'diff'
import chalk from 'chalk'

/**
 * Preview what specfuse sync would change — no files are written unless --apply.
 *
 * @param {string} projectRoot
 * @param {{ json?: boolean, allowPlugins?: boolean, apply?: boolean, stat?: boolean, color?: boolean }} [options]
 */
export async function diffCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const { diffs, proposedFiles } = await computeDiffWithProposed(projectRoot, rules)
  const filePatches = groupByFile(diffs, proposedFiles, projectRoot)

  const hasChanges = diffs.some((d) => d.hasChanges)

  // ── JSON output ────────────────────────────────────────────────────────
  if (options.json) {
    const out = {
      hasChanges,
      changes: diffs
        .filter((d) => d.hasChanges)
        .map((d) => ({
          file: d.file,
          section: d.section,
          ruleId: d.ruleId,
          added: d.added,
          removed: d.removed,
          diff: d.patch,
        })),
      files: filePatches
        .filter((fp) => fp.hasChanges)
        .map((fp) => ({
          file: fp.file,
          sections: fp.sections.map((s) => ({
            section: s.section,
            ruleId: s.ruleId,
            added: s.added,
            removed: s.removed,
            hasChanges: s.hasChanges,
          })),
          totalAdded: fp.totalAdded,
          totalRemoved: fp.totalRemoved,
          patch: fp.patch ?? '',
        })),
    }

    // If --apply, write the changes first then report
    if (options.apply) {
      const applied = await applyDiff(projectRoot, proposedFiles)
      out.applied = true
      out.appliedFiles = applied
      console.log(JSON.stringify(out, null, 2))
      const allWritten = applied.every((a) => a.written)
      process.exit(allWritten ? 0 : 1)
    }

    console.log(JSON.stringify(out, null, 2))
    process.exit(hasChanges ? 1 : 0)
  }

  // ── Stat output ────────────────────────────────────────────────────────
  if (options.stat) {
    const statOutput = formatStat(filePatches)
    console.log(statOutput)

    if (options.apply) {
      if (!hasChanges) {
        logger.info('No changes to apply.')
        process.exit(0)
      }
      const applied = await applyDiff(projectRoot, proposedFiles)
      logger.br()
      logger.header('Applied')
      for (const a of applied) {
        if (a.written) {
          logger.success(`Written: ${a.file}`)
        } else {
          logger.error(`Failed:  ${a.file} — ${a.error}`)
        }
      }
      const allWritten = applied.every((a) => a.written)
      process.exit(allWritten ? 0 : 1)
    }

    process.exit(hasChanges ? 1 : 0)
  }

  // ── Apply without stat/json ────────────────────────────────────────────
  if (options.apply) {
    if (!hasChanges) {
      logger.info('No changes to apply.')
      process.exit(0)
    }

    const applied = await applyDiff(projectRoot, proposedFiles)

    // Show file-level summary of what was applied
    logger.header('SpecFuse Diff  v2  —  Apply')
    for (const a of applied) {
      if (a.written) {
        logger.success(`Written: ${a.file}`)
      } else {
        logger.error(`Failed:  ${a.file} — ${a.error}`)
      }
    }

    // Show stat summary
    logger.br()
    logger.header('Summary')
    logger.row('Files written', String(applied.filter((a) => a.written).length), chalk.green)
    logger.row('Files failed', String(applied.filter((a) => !a.written).length), chalk.red)
    logger.row('Total lines added', String(filePatches.reduce((n, fp) => n + fp.totalAdded, 0)), chalk.green)
    logger.row('Total lines removed', String(filePatches.reduce((n, fp) => n + fp.totalRemoved, 0)), chalk.red)
    logger.br()

    const allWritten = applied.every((a) => a.written)
    process.exit(allWritten ? 0 : 1)
  }

  // ── Human output (default) — file-level grouping ──────────────────────
  const useColor = options.color !== false // default true; --no-color sets it to false

  logger.header('SpecFuse Diff  v2')
  logger.info('Previewing sync changes — no files will be written.')
  logger.br()

  const changed = filePatches.filter((fp) => fp.hasChanges)

  if (!changed.length) {
    logger.success('No changes. All managed sections are already current.')
    logger.br()
    process.exit(0)
  }

  for (const fp of changed) {
    const fileHeader = useColor ? chalk.bold(fp.file) : fp.file
    console.log(`  ${useColor ? chalk.cyan('~') : '~'} ${fileHeader}`)
    console.log(`    ${useColor ? chalk.green('+' + fp.totalAdded) : '+' + fp.totalAdded} ${useColor ? chalk.red('-' + fp.totalRemoved) : '-' + fp.totalRemoved}`)
    logger.br()

    for (const s of fp.sections) {
      if (!s.hasChanges) continue
      const sectionLabel = useColor ? chalk.dim('[' + s.section + ']') : '[' + s.section + ']'
      console.log(`    ${sectionLabel}  ${useColor ? chalk.green('+' + s.added) : '+' + s.added} ${useColor ? chalk.red('-' + s.removed) : '-' + s.removed}`)

      // Pretty-print the section patch with colours
      for (const line of s.patch.split('\n')) {
        if (!line) continue
        if (line.startsWith('+') && useColor) console.log('      ' + chalk.green(line))
        else if (line.startsWith('+')) console.log('      ' + line)
        else if (line.startsWith('-') && useColor) console.log('      ' + chalk.red(line))
        else if (line.startsWith('-')) console.log('      ' + line)
        else if (line.startsWith('@') && useColor) console.log('      ' + chalk.cyan(line))
        else if (line.startsWith('@')) console.log('      ' + line)
        else if (useColor) console.log('      ' + chalk.dim(line))
        else console.log('      ' + line)
      }
      logger.br()
    }
  }

  logger.header('Summary')
  logger.row('Files with changes', String(changed.length), chalk.yellow)
  logger.row('Total lines added', String(changed.reduce((n, fp) => n + fp.totalAdded, 0)), chalk.green)
  logger.row('Total lines removed', String(changed.reduce((n, fp) => n + fp.totalRemoved, 0)), chalk.red)
  logger.br()
  logger.info(`Run ${chalk.cyan('specfuse sync')} or ${chalk.cyan('specfuse diff --apply')} to apply these changes.`)
  logger.br()

  process.exit(1) // exit 1 = changes exist (CI-friendly)
}
