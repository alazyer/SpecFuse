import { validateArtifacts } from '../core/validator.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

/**
 * Run spec artifact validation checks.
 *
 * @param {string} projectRoot
 * @param {{ json?: boolean, fail?: boolean, artifact?: string }} [options]
 */
export async function validateCommand(projectRoot, options = {}) {
  const { results } = await validateArtifacts(projectRoot, {
    artifact: options.artifact,
  })

  if (options.json) {
    const hasFail = results.some((r) => r.state === 'FAIL')
    const hasWarn = results.some((r) => r.state === 'WARN')
    const shouldFail = hasFail || (options.fail && hasWarn)
    console.log(JSON.stringify({ valid: !shouldFail, checks: results }, null, 2))
    if (shouldFail) process.exit(1)
    return
  }

  // Human output — same layout as doctor
  logger.header('SpecFuse Validate')
  logger.br()

  for (const r of results) {
    const icon =
      r.state === 'PASS'
        ? chalk.green('✔')
        : r.state === 'WARN'
          ? chalk.yellow('⚠')
          : chalk.red('✗')
    const color = r.state === 'PASS' ? chalk.white : r.state === 'WARN' ? chalk.yellow : chalk.red
    console.log(`  ${icon}  ${chalk.dim(r.id.padEnd(32))} ${color(r.message)}`)
    if (r.remediation) console.log(`                                  ${chalk.dim('→')} ${chalk.italic(r.remediation)}`)
  }

  logger.br()
  const passes = results.filter((r) => r.state === 'PASS').length
  const warns = results.filter((r) => r.state === 'WARN').length
  const fails = results.filter((r) => r.state === 'FAIL').length
  logger.header('Summary')
  logger.row('Passed', String(passes), chalk.green)
  if (warns) logger.row('Warnings', String(warns), chalk.yellow)
  if (fails) logger.row('Failed', String(fails), chalk.red)
  logger.br()

  if (fails) {
    logger.error(`${fails} check(s) failed.`)
    process.exit(1)
  } else if (options.fail && warns) {
    logger.warn(`${warns} warning(s). Exiting with code 1 (--fail mode).`)
    process.exit(1)
  } else if (warns) {
    logger.warn(`${warns} warning(s). Artifacts may be incomplete — review above.`)
  } else {
    logger.success('All validation checks passed. ✓')
  }
  logger.br()
}
