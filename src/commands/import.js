/**
 * Import command — import portable spec bundles.
 *
 * Usage:
 *   specfuse import <bundle>
 *     --merge                          # merge with local constitution
 *     --replace                        # replace local constitution
 *     --conflict <strategy>            # skip | overwrite | rename (default: skip)
 *     --preview                        # show what would be imported
 *     --json                           # machine-readable output
 */

import { resolve, basename } from 'path'
import chalk from 'chalk'

import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  inspectBundle,
  importBundle,
  formatImportReportTable,
  formatImportReportJson,
} from '../core/bundle.js'
import { pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

/**
 * Run the import command.
 *
 * @param {string} bundlePath - Path to the bundle zip file
 * @param {{ root?: string, merge?: boolean, replace?: boolean, preview?: boolean, conflict?: string, json?: boolean }} options
 */
export async function importCommand(bundlePath, options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  const { merge, replace, preview, conflict, json } = options

  // Validate bundle path
  if (!bundlePath) {
    logger.error('Bundle path is required.')
    logger.info('Usage: specfuse import <bundle.zip> --merge|--replace')
    process.exit(1)
  }

  const resolvedBundle = resolve(bundlePath)
  if (!pathExists(resolvedBundle)) {
    logger.error(`Bundle not found: ${resolvedBundle}`)
    process.exit(1)
  }

  const specDir = resolve(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    logger.error('Target project has no .specfuse/ directory — run `specfuse init` first.')
    process.exit(1)
  }

  // Require --merge or --replace (unless preview)
  if (!merge && !replace && !preview) {
    logger.error('Specify --merge or --replace to define how the constitution should be handled.')
    logger.info('  --merge    Merge imported rules into local constitution')
    logger.info('  --replace  Replace local constitution entirely')
    process.exit(1)
  }

  const registry = new Registry(projectRoot)
  await registry.load()

  try {
    if (preview) {
      // Preview mode: just inspect and show what would happen
      const { manifest, files } = await inspectBundle(resolvedBundle)

      // Build preview report manually
      const report = {
        source: manifest.projectName,
        exportedAt: manifest.exportedAt,
        mode: manifest.mode,
        constitution: {
          exists: files.some(f => f === '.specfuse/constitution.md'),
          action: merge ? 'merge' : replace ? 'replace' : 'unspecified',
        },
        changes: _summarizeChange(files, projectRoot),
        plan: { files: files.filter(f => f.startsWith('.specfuse/plan/')).length },
        other: { files: files.filter(f => !f.startsWith('.specfuse/changes/') && !f.startsWith('.specfuse/plan/') && f !== '.specfuse/constitution.md').length },
        preview: true,
      }

      if (json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      logger.header('SpecFuse Import (preview)')
      logger.br()
      console.log(formatImportReportTable(report))
      logger.br()
      logger.info('Run without --preview to apply.')
      logger.br()
      return
    }

    // Perform actual import
    const report = await importBundle(resolvedBundle, projectRoot, registry, { merge, replace, conflict })

    if (json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    // Human output
    logger.header('SpecFuse Import')
    logger.br()

    console.log(formatImportReportTable(report))
    logger.br()

    if (report.imported.length > 0) {
      logger.success(`Imported ${report.imported.length} file(s).`)
    }
    if (report.skipped.length > 0) {
      logger.info(`Skipped ${report.skipped.length} file(s).`)
    }
    if (report.renamed.length > 0) {
      logger.info(`Renamed ${report.renamed.length} change(s) due to conflicts.`)
    }

    logger.br()

  } catch (err) {
    if (err.name === 'BundleValidationError') {
      logger.error(`Bundle validation failed: ${err.message}`)
      process.exit(1)
    }
    if (err.name === 'BundleVersionMismatchError') {
      logger.error(err.message)
      process.exit(1)
    }
    if (err.name === 'ConstitutionConflictError') {
      logger.error(err.message)
      process.exit(1)
    }
    if (err.name === 'BundleError') {
      logger.error(err.message)
      process.exit(1)
    }
    throw err
  }
}

/**
 * Summarize change files for preview report.
 */
function _summarizeChange(files, projectRoot) {
  const changeFiles = files.filter(f => f.startsWith('.specfuse/changes/') && !f.startsWith('.specfuse/changes/archive/'))
  const changeNames = new Set()
  for (const f of changeFiles) {
    const parts = f.split('/')
    if (parts.length >= 3 && parts[0] === '.specfuse' && parts[1] === 'changes') {
      changeNames.add(parts[2])
    }
  }

  const conflicts = []
  const wouldImport = []
  for (const name of changeNames) {
    if (pathExists(resolve(projectRoot, '.specfuse', 'changes', name))) {
      conflicts.push(name)
    } else {
      wouldImport.push(name)
    }
  }

  return {
    total: changeNames.size,
    wouldImport: [...wouldImport],
    conflicts,
    conflictStrategy: 'skip',
  }
}
