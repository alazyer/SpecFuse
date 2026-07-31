/**
 * Config API — Unified configuration management.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors (ConfigError) instead of calling process.exit.
 */

import { resolveRoot } from './utils.mjs'
import {
  loadConfig as _loadConfig,
  getConfigValue as _getConfigValue,
  setConfigValue as _setConfigValue,
  validateConfig as _validateConfig,
  configPaths as _configPaths,
  listSchema as _listSchema,
} from '../core/config-manager.js'
import { ConfigError } from './errors.mjs'

/**
 * Load unified config from all three sources.
 *
 * @param {string} root - Project root path
 * @param {{ schemaPath?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<{ registry: object, schema: object, rules: object }>}
 */
export async function load(root, options = {}) {
  const projectRoot = resolveRoot(root)
  return _loadConfig(projectRoot, options)
}

/**
 * Get a single config value by dot-notation key.
 *
 * @param {string} root - Project root path
 * @param {string} key - Dot-notation key (e.g. "registry.phase")
 * @param {{ schemaPath?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<{ key: string, value: any, source: string, mutable: boolean }>}
 * @throws {ConfigError} If the key is unknown
 */
export async function get(root, key, options = {}) {
  const projectRoot = resolveRoot(root)
  const config = await _loadConfig(projectRoot, options)
  const result = _getConfigValue(config, key)

  if (!result.ok) {
    throw new ConfigError(result.error, { key })
  }

  return {
    key,
    value: result.value,
    source: result.source,
    mutable: result.mutable,
  }
}

/**
 * Set a config value by dot-notation key. Persists to the underlying source.
 *
 * @param {string} root - Project root path
 * @param {string} key - Dot-notation key (e.g. "registry.maxHistory")
 * @param {any} value - The value to set (will be coerced if string)
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ key: string, value: any }>}
 * @throws {ConfigError} If the key is unknown, read-only, or value is invalid
 */
export async function set(root, key, value, options = {}) {
  const projectRoot = resolveRoot(root)
  const result = await _setConfigValue(projectRoot, key, value, options)

  if (!result.ok) {
    throw new ConfigError(result.error, { key, value })
  }

  return { key: result.key, value: result.value }
}

/**
 * Validate all configuration values against their schema constraints.
 *
 * @param {string} root - Project root path
 * @param {{ schemaPath?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<{ valid: boolean, errors: Array<{ key: string, error: string }> }>}
 */
export async function validate(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const config = await _loadConfig(projectRoot, options)
  return _validateConfig(config)
}

/**
 * Return the file paths for all config sources.
 *
 * @param {string} root - Project root path
 * @returns {{ registry: string, schema: string, rules: string }}
 */
export function paths(root) {
  const projectRoot = resolveRoot(root)
  return _configPaths(projectRoot)
}

/**
 * Get all known config keys with their metadata.
 *
 * @returns {Array<{ key: string, type: string, mutable: boolean, source: string, computed?: boolean }>}
 */
export function schema() {
  return _listSchema()
}
