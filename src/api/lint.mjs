/**
 * Lint API — programmatic access to the SpecFuse Markdown linter.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath, join, relative, dirname } from 'path'
import { readFile, writeFile, readdir } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'

import {
  loadLintConfig,
  lintContent as _lintContent,
  lintFiles as _lintFiles,
  fixContent as _fixContent,
  collectMarkdownFiles,
  DEFAULT_RULE_CONFIG,
} from '../core/linter.js'
import { pathExists } from '../utils/fs.js'
import { SpecFuseApiError } from './errors.mjs'

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * Lint Markdown content string.
 *
 * @param {string} content   - Markdown content to lint
 * @param {{ filePath?: string, rules?: object, default?: string, ruleFilter?: string[], artifactFilter?: string }} [options]
 * @returns {{ results: Array<object> }}
 */
export function lintContent(content, options = {}) {
  const filePath = options.filePath ?? '<inline>'
  const config = {
    rules: { ...DEFAULT_RULE_CONFIG.rules, ...(options.rules ?? {}) },
    default: options.default ?? DEFAULT_RULE_CONFIG.default,
  }

  const results = _lintContent(filePath, content, config, {
    ruleFilter: options.ruleFilter,
    artifactFilter: options.artifactFilter,
  })

  return { results }
}

/**
 * Lint all Markdown files in a SpecFuse project.
 *
 * @param {string} root - Project root path
 * @param {{ rules?: object, default?: string, configPath?: string, ruleFilter?: string[], artifactFilter?: string }} [options]
 * @returns {Promise<{ results: Array<object>, fileCount: number, errorCount: number, warnCount: number }>}
 */
export async function lint(root, options = {}) {
  const projectRoot = resolveRoot(root)

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    const err = new SpecFuseApiError('.specfuse/ directory not found — run `specfuse init` first.')
    err.code = 'ENOENT'
    throw err
  }

  const config = await loadLintConfig(projectRoot, { configPath: options.configPath })

  // Override config with options
  if (options.rules) {
    config.rules = { ...config.rules, ...options.rules }
  }
  if (options.default) {
    config.default = options.default
  }

  const { results, fileCount } = await _lintFiles(projectRoot, config, {
    ruleFilter: options.ruleFilter,
    artifactFilter: options.artifactFilter,
  })

  return {
    results,
    fileCount,
    errorCount: results.filter((r) => r.severity === 'error').length,
    warnCount: results.filter((r) => r.severity === 'warn').length,
  }
}

/**
 * Auto-fix fixable issues in all Markdown files.
 *
 * @param {string} root - Project root path
 * @param {{ configPath?: string, rules?: object, default?: string }} [options]
 * @returns {Promise<{ fixedCount: number, fileCount: number }>}
 */
export async function fix(root, options = {}) {
  const projectRoot = resolveRoot(root)

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    const err = new SpecFuseApiError('.specfuse/ directory not found — run `specfuse init` first.')
    err.code = 'ENOENT'
    throw err
  }

  const config = await loadLintConfig(projectRoot, { configPath: options.configPath })

  if (options.rules) {
    config.rules = { ...config.rules, ...options.rules }
  }
  if (options.default) {
    config.default = options.default
  }

  const files = await collectMarkdownFiles(specDir, projectRoot)

  // Also include root-level .specfuse/*.md files
  const rootMdFiles = (await readdir(specDir).catch(() => [])).filter((f) =>
    /\.md$/i.test(f),
  )

  const allFiles = [...files, ...rootMdFiles.map((f) => join(specDir, f))]
  let fixedCount = 0

  for (const absPath of allFiles) {
    try {
      const content = await readFile(absPath, 'utf8')
      const fixed = _fixContent(content, config)
      if (fixed !== content) {
        await writeFile(absPath, fixed, 'utf8')
        fixedCount++
      }
    } catch {
      // Skip unreadable / unwritable files
    }
  }

  return {
    fixedCount,
    fileCount: allFiles.length,
  }
}
