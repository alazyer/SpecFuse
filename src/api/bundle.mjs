/**
 * Bundle API — portable spec bundle creation and extraction.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath, basename } from 'path'

import { Registry } from '../core/registry.js'
import {
  createBundle as _createBundle,
  createFullBundle as _createFullBundle,
  inspectBundle as _inspectBundle,
  importBundle as _importBundle,
  formatBundleTable,
  formatBundleJson,
  formatImportReportTable,
  formatImportReportJson,
  BundleError,
  BundleVersionMismatchError,
  BundleValidationError,
  ConstitutionConflictError,
} from '../core/bundle.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import { pathExists } from '../utils/fs.js'

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * Create a partial bundle (constitution + selected changes + plan artifacts).
 *
 * @param {string} root - Project root path
 * @param {{ changes?: string[], output?: string, preview?: boolean }} [options]
 * @returns {Promise<{ manifest: object, files: string[], output?: string, preview: boolean }>}
 */
export async function createExport(root, options = {}) {
  const projectRoot = resolveRoot(root)

  const registry = new Registry(projectRoot)
  await registry.load()

  return _createBundle(projectRoot, registry, options)
}

/**
 * Create a full bundle of the entire `.specfuse/` directory.
 *
 * @param {string} root - Project root path
 * @param {{ output?: string, preview?: boolean }} [options]
 * @returns {Promise<{ manifest: object, files: string[], output?: string, preview: boolean }>}
 */
export async function createFullExport(root, options = {}) {
  const projectRoot = resolveRoot(root)
  return _createFullBundle(projectRoot, options)
}

/**
 * Inspect a bundle's manifest and file list without extracting.
 *
 * @param {string} bundlePath - Path to the bundle zip file
 * @returns {Promise<{ manifest: object, files: string[] }>}
 */
export async function inspect(bundlePath) {
  return _inspectBundle(bundlePath)
}

/**
 * Import a bundle into an existing project.
 *
 * @param {string} root - Project root path
 * @param {string} bundlePath - Path to the bundle zip file
 * @param {{ merge?: boolean, replace?: boolean, preview?: boolean, conflict?: string }} [options]
 * @returns {Promise<object>} import report
 */
export async function importBundle(root, bundlePath, options = {}) {
  const projectRoot = resolveRoot(root)

  const registry = new Registry(projectRoot)
  await registry.load()

  return _importBundle(bundlePath, projectRoot, registry, options)
}

// Re-export error classes
export {
  BundleError,
  BundleVersionMismatchError,
  BundleValidationError,
  ConstitutionConflictError,
}

// Re-export formatters
export { formatBundleTable, formatBundleJson, formatImportReportTable, formatImportReportJson }
