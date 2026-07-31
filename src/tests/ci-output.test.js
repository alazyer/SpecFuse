import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatGitHub,
  formatJUnit,
  formatSarif,
  formatAuto,
  detectFormat,
} from '../core/ci-output.js'

// ── Test fixtures ────────────────────────────────────────────────────────────

const mixedResults = {
  results: [
    { id: 'sections:prd:overview', state: 'PASS', message: 'PRD has section "Overview".', file: '.specfuse/plan/prd.md' },
    { id: 'sections:prd:missing', state: 'WARN', message: 'PRD is missing section "Missing".', remediation: 'Add "## Missing" heading.', file: '.specfuse/plan/prd.md' },
    { id: 'markers:broken', state: 'FAIL', message: 'Unclosed markers.', remediation: 'Fix the markers.', file: '.specfuse/constitution.md', line: 10 },
  ],
}

const driftResults = {
  results: [
    { id: 'plan:arch→constitution:plan-decisions', state: 'IN_SYNC', message: 'Arch decisions are current.', file: '.specfuse/constitution.md' },
    { id: 'plan:prd→constitution:overview', state: 'SOURCE_CHANGED', message: 'PRD changed — overview is stale.', remediation: 'Run `specfuse sync`.', file: '.specfuse/plan/prd.md' },
    { id: 'constitution→changes:add-auth', state: 'BOTH_CHANGED', message: 'Both constitution and add-auth changed.', remediation: 'Run `specfuse resolve`.', file: '.specfuse/changes/add-auth/proposal.md' },
    { id: 'plan:stories→constitution:stories', state: 'NEVER_SYNCED', message: 'Never synced.', remediation: 'Run `specfuse sync`.', file: '.specfuse/plan/stories' },
    { id: 'plan:design→constitution:design', state: 'SOURCE_MISSING', message: 'Design doc not found.', remediation: 'Create it first.', file: '.specfuse/plan/design/system.md' },
  ],
}

const allPassResults = {
  results: [
    { id: 'sections:prd:overview', state: 'PASS', message: 'OK', file: '.specfuse/plan/prd.md' },
    { id: 'ac:proposal:auth:format', state: 'PASS', message: 'OK', file: '.specfuse/changes/auth/proposal.md' },
  ],
}

const emptyResults = { results: [] }

// ── formatGitHub ─────────────────────────────────────────────────────────────

describe('formatGitHub', () => {
  test('annotates FAIL as ::error with file param', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /::error file=\.specfuse\/constitution\.md/)
    assert.match(out, /markers:broken/)
  })

  test('annotates WARN as ::warning with file param', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /::warning file=\.specfuse\/plan\/prd\.md/)
    assert.match(out, /sections:prd:missing/)
  })

  test('annotates PASS as ::notice', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /::notice/)
    assert.match(out, /sections:prd:overview/)
  })

  test('includes line param when available', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /line=10/)
  })

  test('includes remediation on separate line', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /↳ Fix the markers/)
  })

  test('uses ::group and ::endgroup', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /::group::specfuse ci/)
    assert.match(out, /::endgroup::/)
  })

  test('summary line on failure', () => {
    const out = formatGitHub(mixedResults)
    assert.match(out, /::error::specfuse ci failed: 1 failure\(s\), 1 warning\(s\), 1 passed/)
  })

  test('summary line on all pass', () => {
    const out = formatGitHub(allPassResults)
    assert.match(out, /::notice::specfuse ci passed: 2 check\(s\) OK/)
  })

  test('drift SOURCE_CHANGED → warning', () => {
    const out = formatGitHub(driftResults)
    assert.match(out, /::warning/)
    assert.match(out, /plan:prd→constitution:overview/)
  })

  test('drift BOTH_CHANGED → error', () => {
    const out = formatGitHub(driftResults)
    assert.match(out, /::error/)
    assert.match(out, /constitution→changes:add-auth/)
  })

  test('drift IN_SYNC → notice', () => {
    const out = formatGitHub(driftResults)
    assert.match(out, /::notice/)
    assert.match(out, /plan:arch→constitution:plan-decisions/)
  })

  test('custom command name', () => {
    const out = formatGitHub(allPassResults, { command: 'specfuse ci drift' })
    assert.match(out, /::group::specfuse ci drift/)
    assert.match(out, /::notice::specfuse ci drift passed/)
  })

  test('empty results produce pass summary', () => {
    const out = formatGitHub(emptyResults)
    assert.match(out, /::notice::specfuse ci passed: 0 check\(s\) OK/)
  })
})

// ── formatJUnit ─────────────────────────────────────────────────────────────

describe('formatJUnit', () => {
  test('produces valid XML declaration', () => {
    const out = formatJUnit(mixedResults)
    assert.match(out, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  })

  test('root element is testsuites (plural)', () => {
    const out = formatJUnit(mixedResults)
    assert.match(out, /<testsuites name=/)
    assert.match(out, /<\/testsuites>/)
  })

  test('groups results by category into separate testsuite elements', () => {
    const out = formatJUnit(mixedResults)
    // Should have <testsuite name="sections"> and <testsuite name="markers">
    assert.match(out, /<testsuite name="sections"/)
    assert.match(out, /<testsuite name="markers"/)
  })

  test('testsuites has correct aggregate counts', () => {
    const out = formatJUnit(mixedResults)
    // 3 total, 1 fail, 1 error (warn)
    assert.match(out, /tests="3" failures="1" errors="1"/)
  })

  test('FAIL result becomes <failure>', () => {
    const out = formatJUnit(mixedResults)
    assert.ok(out.includes('<failure message="Unclosed markers.">'))
    assert.match(out, /Fix the markers/)
  })

  test('WARN result becomes <error>', () => {
    const out = formatJUnit(mixedResults)
    // The message contains quotes which are escaped
    assert.ok(out.includes('PRD is missing section &quot;Missing&quot;.'))
  })

  test('PASS result is empty testcase', () => {
    const out = formatJUnit(allPassResults)
    // Two testcases, no <failure> or <error> inside them
    const testcases = out.match(/<testcase[^>]*>[\s\S]*?<\/testcase>/g) ?? []
    assert.equal(testcases.length, 2)
    for (const tc of testcases) {
      assert.equal(tc.includes('<failure'), false)
      assert.equal(tc.includes('<error'), false)
    }
  })

  test('escapes XML special characters', () => {
    const data = {
      results: [
        { id: 'test<"bad"', state: 'FAIL', message: 'A & B < C > D', remediation: 'Fix "quotes" & <things>', file: 'test.md' },
      ],
    }
    const out = formatJUnit(data)
    // Attribute values should be escaped
    assert.match(out, /A &amp; B &lt; C &gt; D/)
    // Content (remediation): only &, <, > are escaped; quotes are NOT
    assert.match(out, /Fix "quotes" &amp; &lt;things&gt;/)
  })

  test('drift SOURCE_CHANGED becomes <error>', () => {
    const out = formatJUnit(driftResults)
    assert.ok(out.includes('<error message='))
    assert.match(out, /PRD changed/)
  })

  test('drift BOTH_CHANGED becomes <failure>', () => {
    const out = formatJUnit(driftResults)
    assert.ok(out.includes('<failure message='))
    assert.match(out, /Both constitution and add-auth changed/)
  })

  test('drift IN_SYNC is empty testcase', () => {
    const out = formatJUnit(driftResults)
    // The IN_SYNC testcase should have no failure/error child
    const inSyncMatch = out.match(/<testcase name="plan:arch→constitution:plan-decisions"[^>]*>[\s\S]*?<\/testcase>/)
    assert.ok(inSyncMatch)
    assert.equal(inSyncMatch[0].includes('<failure'), false)
    assert.equal(inSyncMatch[0].includes('<error'), false)
  })

  test('custom command and timestamp', () => {
    const out = formatJUnit(allPassResults, { command: 'mycheck', timestamp: '2026-01-01T00:00:00Z' })
    assert.match(out, /name="mycheck"/)
    assert.match(out, /timestamp="2026-01-01T00:00:00Z"/)
  })

  test('empty results produce testsuites with 0 tests', () => {
    const out = formatJUnit(emptyResults)
    assert.match(out, /tests="0" failures="0" errors="0"/)
  })
})

// ── formatSarif ─────────────────────────────────────────────────────────────

describe('formatSarif', () => {
  test('produces valid SARIF 2.1.0 JSON', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    assert.equal(parsed.version, '2.1.0')
    assert.ok(parsed.$schema)
    assert.equal(parsed.runs.length, 1)
  })

  test('tool driver has name and version', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    const driver = parsed.runs[0].tool.driver
    assert.equal(driver.name, 'SpecFuse')
    assert.equal(driver.version, '4.0.0')
  })

  test('only non-PASS results appear in results array', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    // 1 WARN + 1 FAIL = 2 results
    assert.equal(parsed.runs[0].results.length, 2)
  })

  test('FAIL state maps to error level', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    const failResult = parsed.runs[0].results.find((r) => r.ruleId === 'markers:broken')
    assert.ok(failResult)
    assert.equal(failResult.level, 'error')
  })

  test('WARN state maps to warning level', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    const warnResult = parsed.runs[0].results.find((r) => r.ruleId === 'sections:prd:missing')
    assert.ok(warnResult)
    assert.equal(warnResult.level, 'warning')
  })

  test('result message includes remediation', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    const failResult = parsed.runs[0].results.find((r) => r.ruleId === 'markers:broken')
    assert.ok(failResult)
    assert.match(failResult.message.text, /Fix the markers/)
  })

  test('artifactLocation.uri uses actual file path', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    const failResult = parsed.runs[0].results.find((r) => r.ruleId === 'markers:broken')
    assert.ok(failResult)
    assert.ok(failResult.locations)
    assert.equal(failResult.locations[0].physicalLocation.artifactLocation.uri, '.specfuse/constitution.md')
  })

  test('region.startLine is set when line available', () => {
    const out = formatSarif(mixedResults)
    const parsed = JSON.parse(out)
    const failResult = parsed.runs[0].results.find((r) => r.ruleId === 'markers:broken')
    assert.ok(failResult)
    assert.ok(failResult.locations[0].physicalLocation.region)
    assert.equal(failResult.locations[0].physicalLocation.region.startLine, 10)
  })

  test('rules are deduplicated by id', () => {
    const data = {
      results: [
        { id: 'same-rule', state: 'WARN', message: 'First', file: 'a.md' },
        { id: 'same-rule', state: 'WARN', message: 'Second', file: 'b.md' },
      ],
    }
    const out = formatSarif(data)
    const parsed = JSON.parse(out)
    // Only one rule entry
    assert.equal(parsed.runs[0].tool.driver.rules.length, 1)
    // Two results, both referencing the same rule
    assert.equal(parsed.runs[0].results.length, 2)
    assert.equal(parsed.runs[0].results[0].ruleIndex, parsed.runs[0].results[1].ruleIndex)
  })

  test('drift BOTH_CHANGED → error level', () => {
    const out = formatSarif(driftResults)
    const parsed = JSON.parse(out)
    const bc = parsed.runs[0].results.find((r) => r.ruleId === 'constitution→changes:add-auth')
    assert.ok(bc)
    assert.equal(bc.level, 'error')
  })

  test('drift SOURCE_CHANGED → warning level', () => {
    const out = formatSarif(driftResults)
    const parsed = JSON.parse(out)
    const sc = parsed.runs[0].results.find((r) => r.ruleId === 'plan:prd→constitution:overview')
    assert.ok(sc)
    assert.equal(sc.level, 'warning')
  })

  test('PASS / IN_SYNC results are excluded', () => {
    const out = formatSarif(allPassResults)
    const parsed = JSON.parse(out)
    assert.equal(parsed.runs[0].results.length, 0)
  })

  test('custom toolVersion', () => {
    const out = formatSarif(mixedResults, { toolVersion: '5.0.0' })
    const parsed = JSON.parse(out)
    assert.equal(parsed.runs[0].tool.driver.version, '5.0.0')
  })

  test('empty results produce empty SARIF results array', () => {
    const out = formatSarif(emptyResults)
    const parsed = JSON.parse(out)
    assert.equal(parsed.runs[0].results.length, 0)
    assert.equal(parsed.runs[0].tool.driver.rules.length, 0)
  })
})

// ── detectFormat ─────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  test('returns github when GITHUB_ACTIONS=true', () => {
    assert.equal(detectFormat({ GITHUB_ACTIONS: 'true' }), 'github')
  })

  test('returns junit when GITHUB_ACTIONS is not set', () => {
    assert.equal(detectFormat({}), 'junit')
  })

  test('returns junit when GITHUB_ACTIONS is something else', () => {
    assert.equal(detectFormat({ GITHUB_ACTIONS: 'false' }), 'junit')
  })
})

// ── formatAuto ───────────────────────────────────────────────────────────────

describe('formatAuto', () => {
  test('auto delegates to github when GITHUB_ACTIONS=true', () => {
    const orig = process.env.GITHUB_ACTIONS
    process.env.GITHUB_ACTIONS = 'true'
    try {
      const out = formatAuto(allPassResults, { format: 'auto' })
      // Should contain ::notice — GitHub format marker
      assert.match(out, /::notice::/)
    } finally {
      if (orig === undefined) delete process.env.GITHUB_ACTIONS
      else process.env.GITHUB_ACTIONS = orig
    }
  })

  test('explicit format overrides auto-detect', () => {
    const out = formatAuto(allPassResults, { format: 'junit' })
    assert.match(out, /<testsuites/)
  })

  test('sarif format produces valid JSON', () => {
    const out = formatAuto(mixedResults, { format: 'sarif' })
    const parsed = JSON.parse(out)
    assert.equal(parsed.version, '2.1.0')
  })

  test('unknown format throws', () => {
    assert.throws(
      () => formatAuto(allPassResults, { format: 'csv' }),
      /Unknown CI output format/,
    )
  })

  test('default (no format) uses auto-detect', () => {
    // In a non-CI env this will be junit
    const out = formatAuto(allPassResults)
    assert.ok(out.includes('<testsuites') || out.includes('::group::'))
  })
})
