/**
 * SpecFuse CI Integration Commands
 *
 * Thin command layer that reuses existing core logic and delegates
 * formatting to src/core/ci-output.js.
 *
 * Commands:
 *   specfuse ci drift     — Run drift check with CI-optimized output
 *   specfuse ci validate  — Run validation with CI-optimized output
 *   specfuse ci check     — Combined drift + validation
 *   specfuse ci init      — Generate GitHub Actions workflow file
 */

import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { checkAllDrift } from '../core/drift-detector.js'
import { validateArtifacts } from '../core/validator.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import { formatAuto, detectFormat } from '../core/ci-output.js'
import { logger } from '../utils/logger.js'
import { pathExists, writeFileAtomic, ensureDir } from '../utils/fs.js'
import { join, resolve } from 'path'
import { readFile, writeFile as fsWriteFile } from 'fs/promises'

// ── ci drift ──────────────────────────────────────────────────────────────────

/**
 * Run drift check with CI-optimized output.
 *
 * @param {string} projectRoot
 * @param {{ format?: 'github'|'junit'|'sarif'|'auto', allowPlugins?: boolean, failOnWarn?: boolean, output?: string }} [options]
 * @returns {Promise<{ results: object[], exitCode: number, output: string }>}
 */
export async function ciDrift(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const rawResults = await checkAllDrift(projectRoot, registry, rules)
  const results = normalizeResults(rawResults)

  const hasFail = results.some((r) => r.state === 'BOTH_CHANGED')
  const hasWarn = results.some(
    (r) => r.state !== 'IN_SYNC' && r.state !== 'BOTH_CHANGED' && r.state !== 'SOURCE_MISSING',
  )
  const exitCode = hasFail || (options.failOnWarn && hasWarn) ? 1 : 0

  const output = formatAuto({ results }, {
    format: options.format,
    command: 'specfuse ci drift',
    toolVersion: await _getVersion(),
    root: projectRoot,
  })

  // Write to file if --output specified
  if (options.output) {
    await ensureDir(resolve(options.output, '..'))
    await fsWriteFile(resolve(options.output), output, 'utf8')
  }

  // Record history
  const syncedCount = results.filter((r) => r.state === 'IN_SYNC').length
  const driftCount = results.filter((r) => r.state !== 'IN_SYNC').length
  recordEvent(registry, EVENT_TYPES.drift, `CI drift: ${syncedCount} in sync, ${driftCount} drifted`, {
    syncedCount,
    driftCount,
    ciFormat: options.format ?? 'auto',
  })
  await registry.save()

  return { results, exitCode, output }
}

// ── ci validate ───────────────────────────────────────────────────────────────

/**
 * Run validation with CI-optimized output.
 *
 * @param {string} projectRoot
 * @param {{ format?: 'github'|'junit'|'sarif'|'auto', artifact?: string, allowPlugins?: boolean, failOnWarn?: boolean, output?: string }} [options]
 * @returns {Promise<{ results: object[], exitCode: number, output: string }>}
 */
export async function ciValidate(projectRoot, options = {}) {
  const rawData = await validateArtifacts(projectRoot, {
    artifact: options.artifact,
  })
  const results = normalizeResults(rawData.results)

  const hasFail = results.some((r) => r.state === 'FAIL')
  const hasWarn = results.some((r) => r.state === 'WARN')
  const exitCode = hasFail || (options.failOnWarn && hasWarn) ? 1 : 0

  const output = formatAuto({ results }, {
    format: options.format,
    command: 'specfuse ci validate',
    toolVersion: await _getVersion(),
    root: projectRoot,
  })

  // Write to file if --output specified
  if (options.output) {
    await ensureDir(resolve(options.output, '..'))
    await fsWriteFile(resolve(options.output), output, 'utf8')
  }

  // Record history
  const passes = results.filter((r) => r.state === 'PASS').length
  const warns = results.filter((r) => r.state === 'WARN').length
  const fails = results.filter((r) => r.state === 'FAIL').length
  const registry = new Registry(projectRoot)
  await registry.load()
  recordEvent(registry, EVENT_TYPES.validate, `CI validate: ${passes} passed, ${warns} warnings, ${fails} failed`, {
    passes,
    warns,
    fails,
    artifact: options.artifact ?? 'all',
    ciFormat: options.format ?? 'auto',
  })
  await registry.save()

  return { results, exitCode, output }
}

// ── ci check ──────────────────────────────────────────────────────────────────

/**
 * Combined drift + validation check with CI-optimized output.
 * Exits 1 on any FAIL-state (BOTH_CHANGED or validation FAIL).
 *
 * @param {string} projectRoot
 * @param {{ format?: 'github'|'junit'|'sarif'|'auto', artifact?: string, allowPlugins?: boolean, failOnWarn?: boolean, output?: string }} [options]
 * @returns {Promise<{ driftResults: object[], validateResults: object[], exitCode: number, output: string }>}
 */
export async function ciCheck(projectRoot, options = {}) {
  // Run drift and validation in parallel
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })

  const [rawDriftResults, validateData] = await Promise.all([
    checkAllDrift(projectRoot, registry, rules),
    validateArtifacts(projectRoot, { artifact: options.artifact }),
  ])

  const driftResults = normalizeResults(rawDriftResults)
  const validateResults = normalizeResults(validateData.results)
  const allResults = [...driftResults, ...validateResults]

  const hasFail =
    driftResults.some((r) => r.state === 'BOTH_CHANGED') ||
    validateResults.some((r) => r.state === 'FAIL')
  const hasWarn =
    driftResults.some((r) => r.state !== 'IN_SYNC' && r.state !== 'BOTH_CHANGED' && r.state !== 'SOURCE_MISSING') ||
    validateResults.some((r) => r.state === 'WARN')
  const exitCode = hasFail || (options.failOnWarn && hasWarn) ? 1 : 0

  const output = formatAuto({ results: allResults }, {
    format: options.format,
    command: 'specfuse ci check',
    toolVersion: await _getVersion(),
    root: projectRoot,
  })

  // Write to file if --output specified
  if (options.output) {
    await ensureDir(resolve(options.output, '..'))
    await fsWriteFile(resolve(options.output), output, 'utf8')
  }

  // Record combined history
  const driftSynced = driftResults.filter((r) => r.state === 'IN_SYNC').length
  const driftFailed = driftResults.filter((r) => r.state !== 'IN_SYNC').length
  const valPasses = validateResults.filter((r) => r.state === 'PASS').length
  const valFails = validateResults.filter((r) => r.state !== 'PASS').length
  recordEvent(registry, EVENT_TYPES.drift, `CI check: drift ${driftSynced}/${driftResults.length} ok, validate ${valPasses}/${validateResults.length} ok`, {
    driftSynced,
    driftFailed,
    valPasses,
    valFails,
    ciFormat: options.format ?? 'auto',
  })
  await registry.save()

  return { driftResults, validateResults, exitCode, output }
}

// ── ci init ───────────────────────────────────────────────────────────────────

/**
 * Generate a GitHub Actions workflow file for SpecFuse CI.
 *
 * @param {string} projectRoot
 * @param {{ github?: boolean, output?: string, force?: boolean }} [options]
 * @returns {Promise<{ path: string, created: boolean }>}
 */
export async function ciInit(projectRoot, options = {}) {
  // Default to specfuse.yml to match spec
  const defaultPath = join(projectRoot, '.github', 'workflows', 'specfuse.yml')
  const outputPath = options.output ?? defaultPath
  const resolvedPath = resolve(outputPath)

  if (pathExists(resolvedPath) && !options.force) {
    return { path: resolvedPath, created: false }
  }

  // Only generate GitHub Actions if --github is true (default true)
  if (options.github === false) {
    throw new Error('Only GitHub Actions workflow is supported. Use --github (default) to generate.')
  }

  const template = await _loadGitHubActionsTemplate()
  await ensureDir(join(resolvedPath, '..'))
  await writeFileAtomic(resolvedPath, template)

  return { path: resolvedPath, created: true }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize drift results (which use `ruleId`) and validation results (which use `id`)
 * into a uniform shape with `id`, `state`, `message`, `remediation`, `file`, `line`.
 */
function normalizeResults(results) {
  return results.map((r) => ({
    id: r.id ?? r.ruleId,
    state: r.state,
    message: r.message,
    remediation: r.remediation ?? '',
    file: r.file,
    line: r.line,
  }))
}

// ── internal helpers ─────────────────────────────────────────────────────────

async function _getVersion() {
  try {
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    const pkg = require('../../package.json')
    return pkg.version
  } catch {
    return '4.0.0'
  }
}

async function _loadGitHubActionsTemplate() {
  // Try the templates/ci/ directory first (overrides), then embedded fallback
  const templatePath = join(new URL(import.meta.url).pathname, '..', '..', '..', 'templates', 'ci', 'github-actions.yml')

  try {
    const content = await readFile(templatePath, 'utf8')
    if (content.trim()) return content
  } catch {
    // fallback to embedded template
  }

  return _embeddedGitHubActionsTemplate()
}

function _embeddedGitHubActionsTemplate() {
  return `# SpecFuse CI — Generated by specfuse ci init
# Docs: https://specfuse.dev/docs/ci-integration

name: SpecFuse CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    # Weekly validation every Sunday at 00:00 UTC
    - cron: '0 0 * * 0'

jobs:
  specfuse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: SpecFuse Drift Check
        run: pnpm specfuse ci drift --format github

      - name: SpecFuse Validate
        run: pnpm specfuse ci validate --format github

      # Combined check (uncomment to use instead of separate steps):
      # - name: SpecFuse Check
      #   run: pnpm specfuse ci check --format github

      # SARIF upload for GitHub code scanning (uncomment to enable):
      # - name: SpecFuse SARIF
      #   if: always()
      #   run: pnpm specfuse ci check --format sarif > specfuse-results.sarif
      # - name: Upload SARIF
      #   if: always()
      #   uses: github/codeql-action/upload-sarif@v3
      #   with:
      #     sarif_file: specfuse-results.sarif
`
}
