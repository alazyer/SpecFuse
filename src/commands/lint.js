/**
 * `specfuse lint` — Lint Markdown artifacts for style and structural issues.
 *
 * Flags:
 *   --fix           Auto-fix whitespace/blank-line issues
 *   --json          Machine-readable JSON output
 *   --fail          Exit 1 on errors (CI mode)
 *   --config <path> Custom config file path
 *   --rule <name>   Run only specified rule(s)
 *   --artifact <n>  Lint only a specific artifact
 */

import { resolve, relative, join, dirname } from 'path'
import { readFile, writeFile, readdir } from 'fs/promises'
import chalk from 'chalk'

import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import {
  loadLintConfig,
  lintFiles,
  lintContent,
  fixContent,
  collectMarkdownFiles,
  DEFAULT_RULE_CONFIG,
} from '../core/linter.js'
import { pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

/**
 * Run the lint command.
 *
 * @param {string} projectRoot
 * @param {{ fix?: boolean, json?: boolean, fail?: boolean, config?: string, rule?: string[], artifact?: string }} options
 */
export async function lintCommand(projectRoot, options = {}) {
  const fixMode = options.fix ?? false
  const jsonMode = options.json ?? false
  const failMode = options.fail ?? false
  const configPath = options.config
  const ruleFilter = options.rule ?? []
  const artifactFilter = options.artifact

  // Load config
  const config = await loadLintConfig(projectRoot, { configPath })

  // Load registry for history recording
  const registry = new Registry(projectRoot)
  await registry.load().catch(() => null)

  // Auto-fix mode
  if (fixMode) {
    const specDir = join(projectRoot, '.specfuse')
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
        const fixed = fixContent(content, config)
        if (fixed !== content) {
          await writeFile(absPath, fixed, 'utf8')
          fixedCount++
        }
      } catch {
        // Skip unreadable / unwritable files
      }
    }

    if (registry) {
      recordEvent(registry, EVENT_TYPES.lint, `Auto-fixed ${fixedCount} file(s)`, { fixMode: true, fixedCount })
      await registry.save().catch(() => null)
    }

    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            results: [],
            fixedCount,
            fileCount: allFiles.length,
            fixMode: true,
          },
          null,
          2,
        ),
      )
      return
    }

    if (fixedCount > 0) {
      logger.success(`Fixed ${fixedCount} file(s).`)
    } else {
      logger.success('No fixable issues found. ✓')
    }
    logger.br()
    return
  }

  // Lint all files
  const { results, fileCount } = await lintFiles(projectRoot, config, {
    ruleFilter,
    artifactFilter,
  })

  // Record history event
  if (registry) {
    const errorCount = results.filter((r) => r.severity === 'error').length
    const warnCount = results.filter((r) => r.severity === 'warn').length
    recordEvent(registry, EVENT_TYPES.lint, `Linted ${fileCount} file(s): ${errorCount} error(s), ${warnCount} warning(s)`, {
      errorCount,
      warnCount,
      fileCount,
    })
    await registry.save().catch(() => null)
  }

  // JSON output
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          results,
          fileCount,
          errorCount: results.filter((r) => r.severity === 'error').length,
          warnCount: results.filter((r) => r.severity === 'warn').length,
        },
        null,
        2,
      ),
    )

    if (failMode && results.some((r) => r.severity === 'error')) {
      process.exit(1)
    }
    return
  }

  // Human-readable output
  logger.header('SpecFuse Lint')
  logger.br()

  if (results.length === 0) {
    logger.success('All clear — no lint issues found. ✓')
    logger.br()
    return
  }

  // Group results by file
  const byFile = new Map()
  for (const r of results) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file).push(r)
  }

  for (const [file, fileResults] of byFile) {
    console.log(`  ${chalk.bold(file)}`)
    for (const r of fileResults) {
      const badge =
        r.severity === 'error'
          ? chalk.bgRed.white(' ERROR ')
          : chalk.bgYellow.black(' WARN  ')
      console.log(
        `    ${chalk.dim(`L${r.line}`)}  ${badge}  ${chalk.dim(r.rule)}  ${r.message}`,
      )
    }
    logger.br()
  }

  const errorCount = results.filter((r) => r.severity === 'error').length
  const warnCount = results.filter((r) => r.severity === 'warn').length

  logger.header('Summary')
  logger.row('Errors', String(errorCount), errorCount > 0 ? chalk.red : chalk.green)
  logger.row('Warnings', String(warnCount), warnCount > 0 ? chalk.yellow : chalk.green)
  logger.row('Files linted', String(fileCount), chalk.dim)
  logger.br()

  if (errorCount > 0) {
    logger.warn(`${errorCount} error(s) found. Run with ${chalk.cyan('--fix')} to auto-fix whitespace issues.`)
  } else {
    logger.info(`${warnCount} warning(s). Run with ${chalk.cyan('--fix')} to auto-fix whitespace issues.`)
  }
  logger.br()

  if (failMode && errorCount > 0) {
    process.exit(1)
  }
}
