/**
 * Tests for the Template Override System.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join, resolve } from 'node:path'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  resolveTemplate,
  resolveTemplateByPath,
  listTemplates,
  getTemplateVariables,
  extractVariableReferences,
  validateTemplate,
  validateAllCustomTemplates,
  copyTemplate,
  suggestTemplateName,
  fillTemplate,
  TEMPLATE_NAME_MAP,
  CONSTITUTION_TEMPLATE,
} from '../core/template-resolver.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '.test-fixtures', 'template')

// ── Template Name Map ────────────────────────────────────────────────────────

describe('TEMPLATE_NAME_MAP', () => {
  it('has all expected templates', () => {
    const expected = [
      'prd', 'architecture', 'story',
      'design-system', 'design-flow', 'design-screen',
      'proposal', 'change-design', 'tasks', 'review', 'verify',
      'constitution',
    ]
    for (const name of expected) {
      assert.ok(TEMPLATE_NAME_MAP[name], `Missing template: ${name}`)
    }
  })

  it('has correct category assignments', () => {
    assert.strictEqual(TEMPLATE_NAME_MAP.prd.category, 'plan')
    assert.strictEqual(TEMPLATE_NAME_MAP['design-system'].category, 'plan/design')
    assert.strictEqual(TEMPLATE_NAME_MAP.proposal.category, 'change')
    assert.strictEqual(TEMPLATE_NAME_MAP.constitution.category, 'specify')
  })

  it('constitution is marked inline', () => {
    assert.ok(TEMPLATE_NAME_MAP.constitution.inline)
  })
})

// ── CONSTITUTION_TEMPLATE ────────────────────────────────────────────────────

describe('CONSTITUTION_TEMPLATE', () => {
  it('is a non-empty string', () => {
    assert.ok(typeof CONSTITUTION_TEMPLATE === 'string')
    assert.ok(CONSTITUTION_TEMPLATE.length > 0)
  })

  it('contains expected sections', () => {
    assert.ok(CONSTITUTION_TEMPLATE.includes('# Project Constitution'))
    assert.ok(CONSTITUTION_TEMPLATE.includes('## Core Principles'))
    assert.ok(CONSTITUTION_TEMPLATE.includes('## Technical Constraints'))
  })
})

// ── fillTemplate ─────────────────────────────────────────────────────────────

describe('fillTemplate', () => {
  it('replaces single variable', () => {
    const result = fillTemplate('Hello {{name}}!', { name: 'World' })
    assert.strictEqual(result, 'Hello World!')
  })

  it('replaces multiple variables', () => {
    const result = fillTemplate('{{a}} and {{b}}', { a: 'X', b: 'Y' })
    assert.strictEqual(result, 'X and Y')
  })

  it('replaces repeated variables', () => {
    const result = fillTemplate('{{x}} {{x}} {{x}}', { x: 'hi' })
    assert.strictEqual(result, 'hi hi hi')
  })

  it('preserves unmatched variables', () => {
    const result = fillTemplate('{{a}} and {{b}}', { a: 'X' })
    assert.strictEqual(result, 'X and {{b}}')
  })

  it('handles empty vars object', () => {
    const result = fillTemplate('Hello {{name}}!', {})
    assert.strictEqual(result, 'Hello {{name}}!')
  })
})

// ── resolveTemplate ──────────────────────────────────────────────────────────

describe('resolveTemplate', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, 'resolve-test')
    await mkdir(join(projectRoot, '.specfuse', 'templates', 'plan'), { recursive: true })
  })

  afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  it('returns null for unknown template', async () => {
    const result = await resolveTemplate(projectRoot, 'nonexistent')
    assert.strictEqual(result, null)
  })

  it('returns constitution template inline', async () => {
    const result = await resolveTemplate(projectRoot, 'constitution')
    assert.ok(result)
    assert.strictEqual(result.source, 'builtin')
    assert.ok(result.content.includes('# Project Constitution'))
  })

  it('returns builtin template when no custom override', async () => {
    const result = await resolveTemplate(projectRoot, 'prd')
    assert.ok(result)
    assert.strictEqual(result.source, 'builtin')
    assert.ok(result.content.includes('# Product Requirements Document'))
  })

  it('returns custom template when override exists', async () => {
    const customPath = join(projectRoot, '.specfuse', 'templates', 'plan', 'prd.md')
    await writeFile(customPath, '# Custom PRD')

    const result = await resolveTemplate(projectRoot, 'prd')
    assert.ok(result)
    assert.strictEqual(result.source, 'custom')
    assert.strictEqual(result.content, '# Custom PRD')
  })
})

// ── resolveTemplateByPath ────────────────────────────────────────────────────

describe('resolveTemplateByPath', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, 'resolve-path-test')
    await mkdir(join(projectRoot, '.specfuse', 'templates', 'change'), { recursive: true })
  })

  afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  it('resolves builtin template by path', async () => {
    const result = await resolveTemplateByPath(projectRoot, 'change', 'proposal.md')
    assert.ok(result)
    assert.strictEqual(result.source, 'builtin')
  })

  it('resolves custom template by path', async () => {
    const customPath = join(projectRoot, '.specfuse', 'templates', 'change', 'proposal.md')
    await writeFile(customPath, '# Custom Proposal')

    const result = await resolveTemplateByPath(projectRoot, 'change', 'proposal.md')
    assert.ok(result)
    assert.strictEqual(result.source, 'custom')
    assert.strictEqual(result.content, '# Custom Proposal')
  })
})

// ── listTemplates ────────────────────────────────────────────────────────────

describe('listTemplates', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, 'list-test')
    await mkdir(join(projectRoot, '.specfuse', 'templates', 'plan'), { recursive: true })
  })

  afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  it('lists all templates', async () => {
    const result = await listTemplates(projectRoot)
    assert.ok(result.length >= 12) // 11 file templates + constitution
  })

  it('marks custom templates correctly', async () => {
    const customPath = join(projectRoot, '.specfuse', 'templates', 'plan', 'prd.md')
    await writeFile(customPath, '# Custom')

    const result = await listTemplates(projectRoot)
    const prd = result.find((t) => t.name === 'prd')
    assert.ok(prd)
    assert.strictEqual(prd.custom, true)
  })

  it('includes category and label', async () => {
    const result = await listTemplates(projectRoot)
    const proposal = result.find((t) => t.name === 'proposal')
    assert.ok(proposal)
    assert.strictEqual(proposal.category, 'change')
    assert.strictEqual(proposal.label, 'Change Proposal')
  })
})

// ── getTemplateVariables ─────────────────────────────────────────────────────

describe('getTemplateVariables', () => {
  it('extracts variables from @vars block', () => {
    const content = `<!--
@vars
name: Project name
date: Creation date
-->
# Template`
    const result = getTemplateVariables(content)
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].name, 'name')
    assert.strictEqual(result[0].description, 'Project name')
    assert.strictEqual(result[1].name, 'date')
    assert.strictEqual(result[1].description, 'Creation date')
  })

  it('returns empty array when no @vars block', () => {
    const content = '# Template without vars'
    const result = getTemplateVariables(content)
    assert.strictEqual(result.length, 0)
  })
})

// ── extractVariableReferences ────────────────────────────────────────────────

describe('extractVariableReferences', () => {
  it('extracts all {{var}} references', () => {
    const content = '{{name}} and {{date}} and {{title}}'
    const result = extractVariableReferences(content)
    assert.deepStrictEqual(result, ['date', 'name', 'title']) // sorted
  })

  it('ignores escaped delimiters', () => {
    const content = '\\{{escaped}} and {{real}}'
    const result = extractVariableReferences(content)
    assert.deepStrictEqual(result, ['real'])
  })

  it('deduplicates references', () => {
    const content = '{{x}} {{x}} {{x}}'
    const result = extractVariableReferences(content)
    assert.deepStrictEqual(result, ['x'])
  })
})

// ── validateTemplate ─────────────────────────────────────────────────────────

describe('validateTemplate', () => {
  it('validates correct template', () => {
    const content = '{{name}} and {{date}}'
    const result = validateTemplate(content)
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.errors.length, 0)
  })

  it('detects unmatched {{', () => {
    const content = '{{name and date'
    const result = validateTemplate(content)
    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.message.includes('Unmatched')))
  })

  it('detects empty variable name', () => {
    const content = '{{}}'
    const result = validateTemplate(content)
    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.message.includes('Empty')))
  })

  it('detects nested delimiters', () => {
    const content = '{{outer {{inner}}}}'
    const result = validateTemplate(content)
    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.message.includes('Nested')))
  })

  it('preserves escaped delimiters', () => {
    const content = '\\{{escaped\\}}'
    const result = validateTemplate(content)
    assert.strictEqual(result.valid, true)
  })
})

// ── validateAllCustomTemplates ───────────────────────────────────────────────

describe('validateAllCustomTemplates', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, 'validate-test')
    await mkdir(join(projectRoot, '.specfuse', 'templates', 'plan'), { recursive: true })
  })

  afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  it('returns empty array when no custom templates', async () => {
    const result = await validateAllCustomTemplates(projectRoot)
    assert.strictEqual(result.length, 0)
  })

  it('validates custom templates', async () => {
    const customPath = join(projectRoot, '.specfuse', 'templates', 'plan', 'prd.md')
    await writeFile(customPath, '{{name}} and {{date}}')

    const result = await validateAllCustomTemplates(projectRoot)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].valid, true)
  })

  it('reports errors for invalid templates', async () => {
    const customPath = join(projectRoot, '.specfuse', 'templates', 'plan', 'prd.md')
    await writeFile(customPath, '{{}}')

    const result = await validateAllCustomTemplates(projectRoot)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].valid, false)
    assert.ok(result[0].errors.length > 0)
  })
})

// ── copyTemplate ─────────────────────────────────────────────────────────────

describe('copyTemplate', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, 'copy-test')
    await mkdir(join(projectRoot, '.specfuse', 'templates', 'plan'), { recursive: true })
  })

  afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true })
  })

  it('copies builtin template', async () => {
    const result = await copyTemplate(projectRoot, 'prd')
    assert.strictEqual(result.created, true)
    assert.ok(existsSync(result.destPath))
  })

  it('refuses to overwrite without force', async () => {
    await copyTemplate(projectRoot, 'prd')
    const result = await copyTemplate(projectRoot, 'prd')
    assert.strictEqual(result.created, false)
    assert.strictEqual(result.alreadyExists, true)
  })

  it('overwrites with force', async () => {
    await copyTemplate(projectRoot, 'prd')
    const result = await copyTemplate(projectRoot, 'prd', { force: true })
    assert.strictEqual(result.created, true)
  })

  it('throws for unknown template', async () => {
    await assert.rejects(
      () => copyTemplate(projectRoot, 'nonexistent'),
      /Unknown template/,
    )
  })

  it('handles constitution template specially', async () => {
    const result = await copyTemplate(projectRoot, 'constitution')
    assert.strictEqual(result.created, true)
    const content = await readFile(result.destPath, 'utf8')
    assert.ok(content.includes('# Project Constitution'))
  })
})

// ── suggestTemplateName ──────────────────────────────────────────────────────

describe('suggestTemplateName', () => {
  it('suggests close matches', () => {
    const result = suggestTemplateName('prdd')
    assert.ok(result.includes('prd'))
  })

  it('suggests multiple matches', () => {
    const result = suggestTemplateName('desgn-systm')
    assert.ok(result.includes('design-system'))
  })

  it('returns empty array for no matches', () => {
    const result = suggestTemplateName('xyz')
    assert.strictEqual(result.length, 0)
  })

  it('returns empty array for empty input', () => {
    const result = suggestTemplateName('')
    assert.strictEqual(result.length, 0)
  })
})
