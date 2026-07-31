/**
 * Export command — create portable spec bundles.
 *
 * Usage:
 *   specfuse export [output]           # default: <projectName>-specfuse-bundle.zip
 *     --changes <names...>             # export selected changes only
 *     --full                           # export entire .specfuse/ directory
 *     --preview                        # show what would be exported
 *     --json                           # machine-readable output
 */

import { resolve, basename } from 'path'
import chalk from 'chalk'

import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  createBundle,
  createFullBundle,
  formatBundleTable,
  formatBundleJson,
} from '../core/bundle.js'
import { pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

/**
 * Run the export command.
 *
 * @param {string} [outputPath] - Optional output path for the bundle
 * @param {{ root?: string, changes?: string[], full?: boolean, preview?: boolean, json?: boolean }} options
 */
export async function exportCommand(outputPath, options = {}) {
  // Handle case where outputPath is actually the options object (no path specified)
  if (typeof outputPath !== 'string') {
    options = outputPath ?? {}
    outputPath = undefined
  }

  const projectRoot = resolve(options.root ?? '.')
  const { changes, full, preview, json } = options

  const specDir = resolve(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    logger.error('.specfuse/ directory not found — run `specfuse init` first.')
    process.exit(1)
  }

  const registry = new Registry(projectRoot)
  await registry.load()

  try {
    let result

    if (full) {
      result = await createFullBundle(projectRoot, { output: outputPath, preview })
    } else {
      result = await createBundle(projectRoot, registry, { changes, output: outputPath, preview })
    }

    if (json) {
      console.log(JSON.stringify({
        manifest: result.manifest,
        files: result.files,
        output: result.output,
        preview: result.preview,
      }, null, 2))
      return
    }

    // Human output
    logger.header('SpecFuse Export')

    if (preview) {
      logger.info('Preview mode — no files will be written.')
      logger.br()
    }

    console.log(formatBundleTable(result.manifest))
    logger.br()

    if (result.files.length > 0) {
      logger.info(`Files to include:`)
      for (const f of result.files.slice(0, 20)) {
        console.log(`  ${chalk.dim('-')} ${f}`)
      }
      if (result.files.length > 20) {
        console.log(`  ${chalk.dim('...')} and ${result.files.length - 20} more`)
      }
      logger.br()
    }

    if (result.output) {
      logger.success(`Bundle created: ${chalk.bold(result.output)}`)
    } else if (preview) {
      const projectName = registry.getProjectName() || 'project'
      logger.info(`Would create: ${projectName}-specfuse-bundle.zip`)
    }

    logger.br()

  } catch (err) {
    if (err.name === 'BundleValidationError' || err.name === 'BundleError') {
      logger.error(err.message)
      process.exit(1)
    }
    throw err
  }
}
