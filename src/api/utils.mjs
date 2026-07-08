/**
 * Shared internal helpers for the SpecFuse programmatic API modules.
 *
 * These wrap existing utility modules (artifact-schema, fs) but throw
 * typed errors instead of calling process.exit or logging.
 */

import { resolve as resolvePath, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  readFileSafe as _readFileSafe,
  writeFileAtomic as _writeFileAtomic,
  pathExists,
  ensureDir,
  getModifiedTime,
  listFiles,
} from '../utils/fs.js'
import {
  loadArtifactSchema,
  getArtifactSchemaInstructions,
  applyArtifactSchemaInstructions,
} from '../core/artifact-schema.js'
import { SchemaNotFoundError } from './errors.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dir, '..', '..', 'templates')

/**
 * Resolve and validate a project root path.
 * @param {string} root - Relative or absolute path
 * @returns {string} Absolute path
 */
export function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * Load artifact schema, throwing SchemaNotFoundError on failure.
 * @param {string} projectRoot - Absolute project root
 * @param {string} [schemaPath] - Optional override schema path
 * @returns {Promise<object>} Schema object from loadArtifactSchema
 * @throws {SchemaNotFoundError}
 */
export async function loadSchemaOrThrow(projectRoot, schemaPath) {
  try {
    return await loadArtifactSchema(projectRoot, { schemaPath })
  } catch (err) {
    throw new SchemaNotFoundError(`Artifact schema error: ${err.message}`, {
      path: schemaPath ?? '.specfuse/artifact-schema.json',
      cause: err,
    })
  }
}

/**
 * Fill template placeholders like {{key}} with values.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function fillTemplate(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template)
}

/**
 * Apply artifact schema instructions to content.
 * @param {string} content - Markdown content
 * @param {object} schema - Loaded schema object
 * @param {string} artifactId - e.g. 'plan.prd', 'change.proposal'
 * @returns {string} Content with schema instructions appended
 */
export function applySchema(content, schema, artifactId) {
  const instructions = getArtifactSchemaInstructions(schema, artifactId)
  return applyArtifactSchemaInstructions(content, instructions)
}

/**
 * Read a template file from the templates directory.
 * @param {'plan'|'change'|'plan/design'} subDir
 * @param {string} name - Template filename (e.g., 'prd.md')
 * @returns {Promise<string|null>}
 */
export async function readTemplate(subDir, name) {
  const tplPath = join(TEMPLATES_DIR, subDir, name)
  return _readFileSafe(tplPath)
}

/**
 * Read a file safely, returning null if missing.
 * Delegates to utils/fs.readFileSafe.
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
export const readFileSafe = _readFileSafe

/**
 * Write a file atomically (temp file + rename).
 * Delegates to utils/fs.writeFileAtomic.
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<void>}
 */
export const writeFileAtomic = _writeFileAtomic

/**
 * Check if a path exists.
 * @param {string} p
 * @returns {boolean}
 */
export { pathExists }

/**
 * Ensure a directory exists.
 * @param {string} dir
 * @returns {Promise<void>}
 */
export { ensureDir }

/**
 * Get last-modified time of a file, or null if missing.
 * @param {string} filePath
 * @returns {Promise<Date|null>}
 */
export { getModifiedTime }

/**
 * List files in a directory with optional extension filter.
 * @param {string} dir
 * @param {string} [ext]
 * @returns {Promise<string[]>}
 */
export { listFiles }
