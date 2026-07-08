import { buildTraceMatrix, computeCoverage } from '../core/traceability.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

/**
 * Run the `specfuse trace` command — display the traceability matrix.
 *
 * @param {string} projectRoot
 * @param {{ coverage?: boolean, json?: boolean }} [options]
 */
export async function traceCommand(projectRoot, options = {}) {
  const matrix = await buildTraceMatrix(projectRoot)

  // JSON output
  if (options.json) {
    const coverage = computeCoverage(matrix)
    const output = {
      stories: matrix.stories.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        activeChanges: s.activeChanges,
        implementedBy: s.implementedBy,
      })),
      unknown: matrix.unknown,
      coverage,
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  // No stories case
  if (matrix.stories.length === 0) {
    logger.info('No stories found. Run `specfuse plan story` to create stories.')
    return
  }

  // Coverage-only mode
  if (options.coverage) {
    printCoverage(matrix)
    return
  }

  // Full traceability matrix
  printMatrix(matrix)
  logger.br()
  printCoverage(matrix)
}

function printMatrix(matrix) {
  logger.header('Traceability Matrix')
  logger.br()

  for (const story of matrix.stories) {
    const statusLabel = formatStatus(story.status)
    const titleSuffix = story.title ? chalk.dim(` — ${story.title}`) : ''

    console.log(`  ${statusLabel}  ${chalk.bold(story.id)}${titleSuffix}`)

    if (story.activeChanges.length) {
      const changes = story.activeChanges.map((c) => chalk.cyan(c)).join(', ')
      console.log(`         Active: ${changes}`)
    }

    if (story.implementedBy) {
      console.log(`         Implemented by: ${chalk.green(story.implementedBy)}`)
    }

    if (story.status === 'uncovered') {
      console.log(chalk.dim('         No linked changes'))
    }

    if (story.status === 'unknown') {
      console.log(chalk.dim('         Story file not found in .specfuse/plan/stories/'))
    }
  }

  // Unknown IDs warning
  if (matrix.unknown.length) {
    logger.br()
    logger.warn(
      `Unknown story IDs referenced in proposals but not found in .specfuse/plan/stories/: ${matrix.unknown.map((id) => chalk.bold(id)).join(', ')}`,
    )
  }
}

function printCoverage(matrix) {
  const coverage = computeCoverage(matrix)

  logger.header('Coverage')
  logger.br()

  logger.row('Total stories', String(coverage.total), chalk.white)
  logger.row('Active changes', String(coverage.active), chalk.cyan)
  logger.row('Implemented', String(coverage.implemented), chalk.green)
  logger.row('Uncovered', String(coverage.uncovered), coverage.uncovered > 0 ? chalk.red : chalk.green)
  logger.row('Coverage', `${coverage.coveragePct}%`, coverage.coveragePct === 100 ? chalk.green : chalk.yellow)

  if (coverage.coveragePct === 100) {
    logger.br()
    logger.success('All stories have linked changes ✓')
  } else if (coverage.uncovered > 0) {
    logger.br()
    logger.info(
      `Add \`stories:\` frontmatter to proposals to link them, or run ${chalk.cyan('specfuse plan story')} to create new stories.`,
    )
  }
}

function formatStatus(status) {
  switch (status) {
    case 'active':
      return chalk.cyan('●')
    case 'implemented':
      return chalk.green('✔')
    case 'active+implemented':
      return chalk.yellow('◐')
    case 'uncovered':
      return chalk.red('○')
    case 'unknown':
      return chalk.dim('?')
    default:
      return chalk.dim('·')
  }
}
