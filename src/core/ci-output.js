/**
 * SpecFuse CI Output Formatters
 *
 * Pure formatting functions for CI-optimized output.
 * No I/O — these transform data structures into formatted strings.
 *
 * Supported formats:
 *   github  — GitHub Actions workflow commands (::group, ::error, ::warning, ::notice)
 *   junit   — JUnit XML (<testsuites> wrapper with per-category <testsuite>)
 *   sarif   — SARIF 2.1.0 JSON for GitHub code scanning
 *   auto    — picks 'github' when GITHUB_ACTIONS env var is set, else 'junit'
 */

import { CiUnsupportedModeError } from '../api/errors.mjs'

// ── GitHub Actions format ───────────────────────────────────────────────────

/**
 * Format drift/validation results as GitHub Actions annotations.
 * Includes file and line parameters when available in result data.
 *
 * @param {{ results: Array<{ id: string, state: string, message: string, remediation?: string, file?: string, line?: number }> }} data
 * @param {{ command?: string }} [meta]
 * @returns {string}
 */
export function formatGitHub(data, meta = {}) {
  const lines = []
  const command = meta.command ?? 'specfuse ci'

  lines.push(`::group::${command} — SpecFuse CI Check`)

  const { passCount, warnCount, failCount } = tallyResults(data.results)

  for (const r of data.results) {
    const severity = stateToGithubSeverity(r.state)
    const annotation = formatGithubAnnotation(r, severity)
    lines.push(annotation)
    if (r.remediation) {
      lines.push(`  ↳ ${r.remediation}`)
    }
  }

  lines.push('::endgroup::')
  lines.push('')

  // Summary line
  if (failCount > 0) {
    lines.push(`::error::${command} failed: ${failCount} failure(s), ${warnCount} warning(s), ${passCount} passed`)
  } else if (warnCount > 0) {
    lines.push(`::warning::${command} passed with warnings: ${warnCount} warning(s), ${passCount} passed`)
  } else {
    lines.push(`::notice::${command} passed: ${passCount} check(s) OK`)
  }

  return lines.join('\n')
}

/**
 * Format a single GitHub annotation with file/line params when available.
 */
function formatGithubAnnotation(r, severity) {
  const parts = []
  if (r.file) parts.push(`file=${r.file}`)
  if (r.line !== undefined && r.line !== null) parts.push(`line=${r.line}`)

  const params = parts.length > 0 ? ` ${parts.join(',')}::` : '::'
  return `::${severity}${params}${r.id}: ${r.message}`
}

function stateToGithubSeverity(state) {
  switch (state) {
    case 'FAIL':
      return 'error'
    case 'WARN':
      return 'warning'
    case 'PASS':
      return 'notice'
    // Drift states
    case 'SOURCE_CHANGED':
    case 'TARGET_CHANGED':
      return 'warning'
    case 'BOTH_CHANGED':
      return 'error'
    case 'IN_SYNC':
      return 'notice'
    case 'NEVER_SYNCED':
    case 'SOURCE_MISSING':
      return 'warning'
    // Sync-result states (lowercase) — `unchanged` is a passing no-op.
    case 'unchanged':
      return 'notice'
    default:
      return 'notice'
  }
}

// ── JUnit XML format ────────────────────────────────────────────────────────

/**
 * Format drift/validation results as JUnit XML.
 * Uses <testsuites> root with one <testsuite> per check category.
 *
 * @param {{ results: Array<{ id: string, state: string, message: string, remediation?: string, file?: string, line?: number }> }} data
 * @param {{ command?: string, timestamp?: string, time?: number }} [meta]
 * @returns {string}
 */
export function formatJUnit(data, meta = {}) {
  const command = meta.command ?? 'specfuse.ci'
  const timestamp = meta.timestamp ?? new Date().toISOString()
  const totalTime = meta.time ?? 0

  // Group results by category (first segment of id before ':')
  const groups = groupByCategory(data.results)
  const groupNames = Object.keys(groups).sort()

  const xml = []
  xml.push('<?xml version="1.0" encoding="UTF-8"?>')

  const totalTests = data.results.length
  const { passCount, failCount, warnCount } = tallyResults(data.results)

  xml.push(`<testsuites name="${escAttr(command)}" tests="${totalTests}" failures="${failCount}" errors="${warnCount}" skipped="0" time="${totalTime.toFixed(3)}">`)

  for (const groupName of groupNames) {
    const groupResults = groups[groupName]
    const groupTests = groupResults.length
    const groupFails = groupResults.filter((r) => r.state === 'FAIL' || r.state === 'BOTH_CHANGED').length
    const groupWarns = groupResults.filter((r) => r.state === 'WARN' || r.state === 'SOURCE_CHANGED' || r.state === 'TARGET_CHANGED' || r.state === 'NEVER_SYNCED' || r.state === 'SOURCE_MISSING').length

    xml.push(`  <testsuite name="${escAttr(groupName)}" tests="${groupTests}" failures="${groupFails}" errors="${groupWarns}" skipped="0" timestamp="${escAttr(timestamp)}">`)

    for (const r of groupResults) {
      const testName = r.id
      xml.push(`    <testcase name="${escAttr(testName)}" classname="${escAttr(groupName)}">`)

      if (r.state === 'FAIL' || r.state === 'BOTH_CHANGED') {
        xml.push(`      <failure message="${escAttr(r.message)}">`)
        if (r.remediation) xml.push(`        ${escContent(r.remediation)}`)
        xml.push('      </failure>')
      } else if (r.state === 'WARN' || r.state === 'SOURCE_CHANGED' || r.state === 'TARGET_CHANGED' || r.state === 'NEVER_SYNCED' || r.state === 'SOURCE_MISSING') {
        xml.push(`      <error message="${escAttr(r.message)}">`)
        if (r.remediation) xml.push(`        ${escContent(r.remediation)}`)
        xml.push('      </error>')
      }
      // PASS / IN_SYNC — empty testcase = pass

      xml.push('    </testcase>')
    }

    xml.push('  </testsuite>')
  }

  xml.push('</testsuites>')

  return xml.join('\n')
}

/**
 * Group results by category (first segment of id before ':').
 */
function groupByCategory(results) {
  const groups = {}
  for (const r of results) {
    const category = r.id.includes(':') ? r.id.split(':')[0] : 'other'
    if (!groups[category]) groups[category] = []
    groups[category].push(r)
  }
  return groups
}

// ── SARIF 2.1.0 format ──────────────────────────────────────────────────────

/**
 * Format drift/validation results as SARIF 2.1.0 JSON.
 * Uses actual file paths from result data when available.
 *
 * @param {{ results: Array<{ id: string, state: string, message: string, remediation?: string, file?: string, line?: number }> }} data
 * @param {{ command?: string, toolVersion?: string, root?: string }} [meta]
 * @returns {string} JSON string
 */
export function formatSarif(data, meta = {}) {
  const toolVersion = meta.toolVersion ?? '4.0.0'
  const command = meta.command ?? 'specfuse.ci'
  const root = meta.root ?? ''

  const rules = []
  const sarifResults = []
  const ruleIndexMap = {}

  for (const r of data.results) {
    // Only non-PASS results go into SARIF. `unchanged` (a sync no-op) is
    // passing and produces no finding, like `PASS`/`IN_SYNC`.
    if (r.state === 'PASS' || r.state === 'IN_SYNC' || r.state === 'unchanged') continue

    // Create a rule entry per unique ID
    if (!(r.id in ruleIndexMap)) {
      ruleIndexMap[r.id] = rules.length
      rules.push({
        id: r.id,
        shortDescription: { text: r.message },
        helpUri: `https://specfuse.dev/docs/rules/${encodeURIComponent(r.id)}`,
        properties: {
          category: r.id.split(':')[0] ?? 'other',
          severity: stateToSarifLevel(r.state),
        },
      })
    }

    const level = stateToSarifLevel(r.state)

    // Build location with actual file path if available
    const locations = []
    if (r.file) {
      const uri = root ? `${root}/${r.file}` : r.file
      const loc = {
        physicalLocation: {
          artifactLocation: { uri },
        },
      }
      if (r.line !== undefined && r.line !== null) {
        loc.physicalLocation.region = { startLine: r.line }
      }
      locations.push(loc)
    }

    sarifResults.push({
      ruleId: r.id,
      ruleIndex: ruleIndexMap[r.id],
      level,
      message: {
        text: r.remediation ? `${r.message} — ${r.remediation}` : r.message,
      },
      locations: locations.length > 0 ? locations : undefined,
    })
  }

  const sarif = {
    $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'SpecFuse',
            version: toolVersion,
            informationUri: 'https://specfuse.dev',
            rules,
          },
        },
        results: sarifResults,
      },
    ],
  }

  return JSON.stringify(sarif, null, 2)
}

function stateToSarifLevel(state) {
  switch (state) {
    case 'FAIL':
    case 'BOTH_CHANGED':
      return 'error'
    case 'WARN':
    case 'SOURCE_CHANGED':
    case 'TARGET_CHANGED':
    case 'NEVER_SYNCED':
    case 'SOURCE_MISSING':
      return 'warning'
    // Sync-result states (lowercase) — `unchanged` is a passing no-op.
    case 'unchanged':
      return 'note'
    default:
      return 'note'
  }
}

// ── Auto-detect format ──────────────────────────────────────────────────────

/**
 * Auto-detect the best CI format based on environment.
 * Returns 'github' when GITHUB_ACTIONS is set, otherwise 'junit'.
 *
 * @param {typeof process.env} [env]
 * @returns {'github'|'junit'}
 */
export function detectFormat(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' ? 'github' : 'junit'
}

/**
 * Format results using the best format for the current CI environment,
 * or an explicitly specified format.
 *
 * @param {{ results: Array<{ id: string, state: string, message: string, remediation?: string, file?: string, line?: number }> }} data
 * @param {{ format?: 'github'|'junit'|'sarif'|'auto', command?: string, toolVersion?: string, timestamp?: string, time?: number, root?: string }} [options]
 * @returns {string}
 */
export function formatAuto(data, options = {}) {
  const format = options.format === 'auto' || !options.format
    ? detectFormat()
    : options.format

  switch (format) {
    case 'github':
      return formatGitHub(data, options)
    case 'junit':
      return formatJUnit(data, options)
    case 'sarif':
      return formatSarif(data, options)
    default:
      throw new CiUnsupportedModeError(`Unknown CI output format: "${format}". Use: github, junit, sarif, auto`, {
        requestedMode: format,
        supportedMode: 'github|junit|sarif|auto',
      })
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Tally results into pass/warn/fail counts.
 */
function tallyResults(results) {
  let passCount = 0
  let warnCount = 0
  let failCount = 0

  for (const r of results) {
    if (r.state === 'PASS' || r.state === 'IN_SYNC' || r.state === 'unchanged') {
      passCount++
    } else if (r.state === 'FAIL' || r.state === 'BOTH_CHANGED') {
      failCount++
    } else {
      warnCount++
    }
  }

  return { passCount, warnCount, failCount }
}

/**
 * Escape a string for use as an XML attribute value.
 */
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Escape a string for use as XML text content.
 */
function escContent(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
