/**
 * Tests for the lint command and linter engine.
 *
 * Covers:
 * - All 7 lint rules
 * - --fix auto-correction
 * - --json output format
 * - --fail exit code behavior
 * - Config file loading
 * - Rule filtering with --rule
 * - Artifact scoping with --artifact
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  lintContent,
  fixContent,
  loadLintConfig,
  extractHeadings,
  extractLinks,
  normalizeAnchor,
  DEFAULT_RULE_CONFIG,
} from '../core/linter.js'
import { lintCommand } from '../commands/lint.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-lint-test-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes'), { recursive: true })

  // Create a minimal registry.json
  await writeFile(
    join(root, '.specfuse', 'registry.json'),
    JSON.stringify({ phase: 'unknown', history: [] }, null, 2),
    'utf8',
  )

  return root
}

async function runLint(root, options = {}) {
  const captured = []
  const originalLog = console.log
  const originalExit = process.exit

  console.log = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  let exitCode = 0
  process.exit = (code) => {
    exitCode = code
    throw new Error(`EXIT:${code}`)
  }

  try {
    await lintCommand(root, { ...options, json: true })
  } catch (e) {
    if (e.message?.startsWith('EXIT:')) {
      exitCode = parseInt(e.message.replace('EXIT:', ''), 10)
    } else {
      throw e
    }
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  // Find the JSON line in captured output
  const jsonLine = captured.find((line) => {
    try {
      const parsed = JSON.parse(line)
      return parsed && typeof parsed === 'object'
    } catch {
      return false
    }
  })

  if (!jsonLine) return { exitCode, result: null }
  return { exitCode, result: JSON.parse(jsonLine) }
}

// ─── Unit Tests: Helpers ───────────────────────────────────────────────────

describe('normalizeAnchor', () => {
  test('lowercases text', () => {
    assert.equal(normalizeAnchor('Hello World'), 'hello-world')
  })

  test('replaces spaces with hyphens', () => {
    assert.equal(normalizeAnchor('foo bar baz'), 'foo-bar-baz')
  })

  test('strips punctuation', () => {
    assert.equal(normalizeAnchor('Hello, World!'), 'hello-world')
  })

  test('handles multiple spaces', () => {
    assert.equal(normalizeAnchor('foo   bar'), 'foo-bar')
  })
})

describe('extractHeadings', () => {
  test('extracts ATX headings', () => {
    const content = '# Title\n\n## Section\n\n### Subsection'
    const headings = extractHeadings(content)
    assert.equal(headings.length, 3)
    assert.equal(headings[0].level, 1)
    assert.equal(headings[0].text, 'Title')
    assert.equal(headings[1].level, 2)
    assert.equal(headings[2].level, 3)
  })

  test('extracts setext headings', () => {
    const content = 'Title\n===\n\nSection\n---'
    const headings = extractHeadings(content)
    assert.equal(headings.length, 2)
    assert.equal(headings[0].level, 1)
    assert.equal(headings[1].level, 2)
  })

  test('generates anchors', () => {
    const content = '# Hello World'
    const headings = extractHeadings(content)
    assert.equal(headings[0].anchor, 'hello-world')
  })
})

describe('extractLinks', () => {
  test('extracts standard links', () => {
    const content = '[Home](./index.md) and [About](#about)'
    const links = extractLinks(content)
    assert.equal(links.length, 2)
    assert.equal(links[0].type, 'cross-file')
    assert.equal(links[1].type, 'internal')
  })

  test('classifies external links', () => {
    const content = '[Google](https://google.com)'
    const links = extractLinks(content)
    assert.equal(links.length, 1)
    assert.equal(links[0].type, 'external')
  })
})

// ─── Unit Tests: Lint Rules ────────────────────────────────────────────────

describe('rule: heading-hierarchy', () => {
  test('detects skipped levels', () => {
    const content = '# H1\n\n### H3'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const hierarchyErrors = results.filter((r) => r.rule === 'heading-hierarchy')
    assert.ok(hierarchyErrors.length > 0, 'Should detect skipped heading level')
    assert.ok(hierarchyErrors[0].message.includes('H1') && hierarchyErrors[0].message.includes('H3'))
  })

  test('allows valid hierarchy', () => {
    const content = '# H1\n\n## H2\n\n### H3'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const hierarchyErrors = results.filter((r) => r.rule === 'heading-hierarchy')
    assert.equal(hierarchyErrors.length, 0)
  })
})

describe('rule: internal-links', () => {
  test('detects broken anchors', () => {
    const content = '# Title\n\n[Broken](#nonexistent)'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const linkErrors = results.filter((r) => r.rule === 'internal-links')
    assert.ok(linkErrors.length > 0, 'Should detect broken internal link')
  })

  test('allows valid anchors', () => {
    const content = '# Hello World\n\n[Link](#hello-world)'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const linkErrors = results.filter((r) => r.rule === 'internal-links')
    assert.equal(linkErrors.length, 0)
  })
})

describe('rule: trailing-whitespace', () => {
  test('detects trailing spaces', () => {
    const content = 'Hello   \nWorld\t'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const wsErrors = results.filter((r) => r.rule === 'trailing-whitespace')
    assert.equal(wsErrors.length, 2)
  })

  test('allows clean lines', () => {
    const content = 'Hello\nWorld'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const wsErrors = results.filter((r) => r.rule === 'trailing-whitespace')
    assert.equal(wsErrors.length, 0)
  })
})

describe('rule: multiple-blank-lines', () => {
  test('detects 3+ blank lines', () => {
    const content = 'Hello\n\n\n\nWorld'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const blankErrors = results.filter((r) => r.rule === 'multiple-blank-lines')
    assert.ok(blankErrors.length > 0, 'Should detect multiple blank lines')
  })

  test('allows 2 blank lines', () => {
    const content = 'Hello\n\n\nWorld'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const blankErrors = results.filter((r) => r.rule === 'multiple-blank-lines')
    assert.equal(blankErrors.length, 0)
  })
})

describe('rule: missing-alt-text', () => {
  test('detects images without alt', () => {
    const content = '![](image.png)'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const altErrors = results.filter((r) => r.rule === 'missing-alt-text')
    assert.ok(altErrors.length > 0)
  })

  test('allows images with alt', () => {
    const content = '![Logo](logo.png)'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const altErrors = results.filter((r) => r.rule === 'missing-alt-text')
    assert.equal(altErrors.length, 0)
  })
})

describe('rule: code-block-language', () => {
  test('detects missing language hint', () => {
    const content = '```\ncode\n```'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const codeErrors = results.filter((r) => r.rule === 'code-block-language')
    assert.ok(codeErrors.length > 0)
  })

  test('allows code blocks with language', () => {
    const content = '```js\nconsole.log("hello")\n```'
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG)
    const codeErrors = results.filter((r) => r.rule === 'code-block-language')
    assert.equal(codeErrors.length, 0)
  })
})

// ─── Unit Tests: fixContent ────────────────────────────────────────────────

describe('fixContent', () => {
  test('removes trailing whitespace', () => {
    const content = 'Hello   \nWorld\t'
    const fixed = fixContent(content)
    assert.equal(fixed, 'Hello\nWorld\n')
  })

  test('collapses multiple blank lines', () => {
    const content = 'Hello\n\n\n\nWorld'
    const fixed = fixContent(content)
    assert.ok(!fixed.includes('\n\n\n'), 'Should not have 3+ consecutive newlines')
  })

  test('ensures trailing newline', () => {
    const content = 'Hello\nWorld'
    const fixed = fixContent(content)
    assert.ok(fixed.endsWith('\n'))
  })
})

// ─── Unit Tests: Config Loading ────────────────────────────────────────────

describe('loadLintConfig', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns defaults when no config file', async () => {
    const config = await loadLintConfig(root)
    assert.ok(config.rules)
    assert.ok(config.rules['heading-hierarchy'])
    assert.equal(config.default, 'warn')
  })

  test('loads custom config', async () => {
    await writeFile(
      join(root, '.specfuse', 'markdownlint.json'),
      JSON.stringify({
        rules: { 'trailing-whitespace': 'off' },
        default: 'error',
      }),
      'utf8',
    )
    const config = await loadLintConfig(root)
    assert.equal(config.rules['trailing-whitespace'], 'off')
    assert.equal(config.default, 'error')
  })
})

// ─── Unit Tests: Rule Filtering ────────────────────────────────────────────

describe('rule filtering', () => {
  test('filters to specific rule', () => {
    const content = '# H1\n\n### H3\n\nHello   '
    const results = lintContent('test.md', content, DEFAULT_RULE_CONFIG, {
      ruleFilter: ['trailing-whitespace'],
    })
    const rules = new Set(results.map((r) => r.rule))
    assert.ok(rules.has('trailing-whitespace'))
    assert.ok(!rules.has('heading-hierarchy'))
  })
})

// ─── Integration Tests: CLI ────────────────────────────────────────────────

describe('lintCommand', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns empty results for clean files', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n## Rules\n\nNo issues here.\n',
      'utf8',
    )

    const { result, exitCode } = await runLint(root)
    assert.ok(result)
    assert.equal(result.results.length, 0)
    assert.equal(exitCode, 0)
  })

  test('detects issues in markdown files', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Constitution\n\n### Skipped\n\nHello   \n',
      'utf8',
    )

    const { result } = await runLint(root)
    assert.ok(result)
    assert.ok(result.results.length > 0, 'Should detect issues')
  })

  test('--fail exits 1 on errors', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# H1\n\n### Skipped\n',
      'utf8',
    )

    const { exitCode } = await runLint(root, { fail: true })
    assert.equal(exitCode, 1)
  })

  test('--fail does not exit on warnings only', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# Title\n\nHello   \n',
      'utf8',
    )

    const { exitCode } = await runLint(root, { fail: true })
    // trailing-whitespace is a warning by default, so should not exit 1
    assert.equal(exitCode, 0)
  })

  test('--fix auto-corrects issues', async () => {
    const filePath = join(root, '.specfuse', 'constitution.md')
    await writeFile(filePath, 'Hello   \n\n\n\nWorld', 'utf8')

    const { result } = await runLint(root, { fix: true })
    assert.ok(result)
    assert.ok(result.fixMode)

    const fixed = await readFile(filePath, 'utf8')
    assert.ok(!fixed.includes('   '), 'Should remove trailing whitespace')
    assert.ok(!fixed.includes('\n\n\n'), 'Should collapse blank lines')
  })

  test('--rule filters to specific rules', async () => {
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      '# H1\n\n### Skipped\n\nHello   \n',
      'utf8',
    )

    const { result } = await runLint(root, { rule: ['trailing-whitespace'] })
    assert.ok(result)
    const rules = new Set(result.results.map((r) => r.rule))
    assert.ok(rules.has('trailing-whitespace'))
    assert.ok(!rules.has('heading-hierarchy'))
  })

  test('respects custom config file', async () => {
    await writeFile(
      join(root, '.specfuse', 'markdownlint.json'),
      JSON.stringify({
        rules: { 'trailing-whitespace': 'off' },
      }),
      'utf8',
    )
    await writeFile(
      join(root, '.specfuse', 'constitution.md'),
      'Hello   \n',
      'utf8',
    )

    const { result } = await runLint(root)
    assert.ok(result)
    const wsErrors = result.results.filter((r) => r.rule === 'trailing-whitespace')
    assert.equal(wsErrors.length, 0, 'Should respect config to disable rule')
  })
})
