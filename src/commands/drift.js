import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { checkAllDrift } from '../core/drift-detector.js'
import { diagnoseArtifactRoots } from '../core/artifact-diagnostics.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

const BADGE = {
  IN_SYNC: chalk.bgGreen.black('  IN SYNC  '),
  SOURCE_CHANGED: chalk.bgYellow.black(' STALE SRC '),
  TARGET_CHANGED: chalk.bgYellow.black(' MANUAL ED '),
  BOTH_CHANGED: chalk.bgRed.white(' CONFLICT  '),
  NEVER_SYNCED: chalk.bgMagenta.white(' UNSYNCED  '),
  SOURCE_MISSING: chalk.bgGray.white('  MISSING  '),
}

/**
 * @param {string} projectRoot
 * @param {{ failOnDrift?: boolean, allowPlugins?: boolean, json?: boolean }} [options]
 */
export async function driftCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const results = await checkAllDrift(projectRoot, registry, rules)

  const artifactRootStatus = await diagnoseArtifactRoots(projectRoot)

  if (options.json) {
    console.log(JSON.stringify({
      results,
      artifactRoots: artifactRootStatus,
    }, null, 2))
    return
  }

  // Report artifact root diagnostics
  let driftCount = 0,
    syncedCount = 0,
    missingCount = 0

  if (artifactRootStatus.diagnostics.length > 0) {
    logger.header('Artifact Root Diagnostics')
    for (const diag of artifactRootStatus.diagnostics) {
      const color = diag.severity === 'error' ? chalk.red : diag.severity === 'warning' ? chalk.yellow : chalk.blue
      console.log(`  ${color(`[${diag.code}]`)} ${diag.severity.toUpperCase()}`)
      console.log(`     ${diag.message}`)
      if (diag.severity === 'warning') driftCount++
      logger.br()
    }
  }

  logger.header('SpecFuse Drift  v2')
  logger.br()

  if (!results.length) {
    logger.info('No artifact pairs to check. Run `specfuse init` first.')
    logger.br()
    return
  }

  for (const r of results) {
    const badge = BADGE[r.state] ?? chalk.bgGray.white(' UNKNOWN   ')
    console.log(`  ${badge}  ${chalk.bold(r.ruleId)}`)
    console.log(`           ${r.message}`)
    if (r.state !== 'IN_SYNC' && r.state !== 'SOURCE_MISSING') {
      console.log(`           ${chalk.dim('→')} ${chalk.italic.cyan(r.remediation)}`)
      driftCount++
    } else if (r.state === 'SOURCE_MISSING') {
      missingCount++
    } else {
      syncedCount++
    }
    logger.br()
  }

  logger.header('Summary')
  logger.row('In sync', String(syncedCount), chalk.green)
  logger.row('Drift detected', String(driftCount), driftCount > 0 ? chalk.yellow : chalk.green)
  logger.row('Source missing', String(missingCount), missingCount > 0 ? chalk.dim : chalk.green)
  logger.br()

  if (driftCount > 0) {
    logger.warn(`${driftCount} pair(s) out of sync.`)
    logger.info(
      `Run ${chalk.cyan('specfuse sync')} to resolve, or ${chalk.cyan('specfuse diff')} to preview changes.`,
    )
  } else if (!missingCount) {
    logger.success('All tracked pairs are in sync. ✓')
  }
  logger.br()

  if (options.failOnDrift && driftCount > 0) process.exit(1)
}
