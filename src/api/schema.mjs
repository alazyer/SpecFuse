/**
 * Schema API — CRUD operations for artifact schema.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolveRoot } from './utils.mjs'
import {
  initArtifactSchema,
  loadArtifactSchema,
} from '../core/artifact-schema.js'

/**
 * Initialize the artifact schema file.
 *
 * @param {string} root - Project root path
 * @param {{ force?: boolean, schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, created: boolean }>}
 */
export async function init(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const result = await initArtifactSchema(projectRoot, {
    schemaPath: options.schemaPath,
    force: options.force,
  })
  return { path: result.path, created: result.created }
}

/**
 * Read the current artifact schema.
 *
 * Unlike the CLI which shows help when missing, the API returns
 * an empty-state object for composability — callers can check `exists`.
 *
 * @param {string} root - Project root path
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, displayPath: string, exists: boolean, version: number, artifacts: object }>}
 */
export async function show(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const schema = await loadArtifactSchema(projectRoot, { schemaPath: options.schemaPath })

  return {
    path: schema.path,
    displayPath: schema.displayPath,
    exists: schema.exists,
    version: schema.version,
    artifacts: schema.artifacts,
  }
}
