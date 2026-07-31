/**
 * Template Resolver — resolves, lists, validates, and copies templates.
 *
 * Resolution order: .specfuse/templates/ → built-in templates/
 * The constitution template is a special case: it's an inline string,
 * not a file, so copy must handle it differently.
 */

import { join, dirname, resolve as resolvePath } from 'path'
import { fileURLToPath } from 'url'
import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises'
import { existsSync } from 'fs'

const __dir = dirname(fileURLToPath(import.meta.url))
const BUILTIN_TEMPLATES_DIR = join(__dir, '..', '..', 'templates')

// ── Fill Template ─────────────────────────────────────────────────────────────

/**
 * Fill template placeholders like {{key}} with values.
 * Preserves escaped delimiters \{{ and \}}.
 *
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function fillTemplate(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template)
}

/**
 * Map of user-facing template names to { subDir, filename }.
 * Special entry: constitution → inline template string.
 */
export const TEMPLATE_NAME_MAP = {
  // Plan category
  prd: { subDir: 'plan', filename: 'prd.md', category: 'plan', label: 'PRD' },
  architecture: { subDir: 'plan', filename: 'architecture.md', category: 'plan', label: 'Architecture' },
  story: { subDir: 'plan', filename: 'story.md', category: 'plan', label: 'User Story' },

  // Plan / Design category
  'design-system': { subDir: 'plan/design', filename: 'system.md', category: 'plan/design', label: 'Design System' },
  'design-flow': { subDir: 'plan/design', filename: 'flow.md', category: 'plan/design', label: 'Design Flow' },
  'design-screen': { subDir: 'plan/design', filename: 'screen.md', category: 'plan/design', label: 'Design Screen' },

  // Change category
  proposal: { subDir: 'change', filename: 'proposal.md', category: 'change', label: 'Change Proposal' },
  'change-design': { subDir: 'change', filename: 'design.md', category: 'change', label: 'Change Design' },
  tasks: { subDir: 'change', filename: 'tasks.md', category: 'change', label: 'Change Tasks' },
  review: { subDir: 'change', filename: 'review.md', category: 'change', label: 'Review' },
  verify: { subDir: 'change', filename: 'verify.md', category: 'change', label: 'Verify' },

  // Specify category (inline, not a file)
  constitution: { subDir: null, filename: null, category: 'specify', label: 'Constitution', inline: true },
}

/**
 * Inline constitution template — extracted from specify.mjs.
 */
export const CONSTITUTION_TEMPLATE = `# Project Constitution

> The single authoritative source of project constraints, standards, and architectural rules.
> Managed by SpecFuse. Sections inside \`<!-- specfuse:*:start/end -->\` are auto-generated.
> Add your own rules in the non-managed sections below.

---

## Core Principles

*(Add your project's guiding principles here)*

## Technical Constraints

*(Add technical constraints here — not covered by architecture or PRD)*

## Code Standards

*(Code quality, naming conventions, test coverage thresholds, style rules)*

## Security Rules

*(Authentication, secrets management, input validation, data handling)*

## Performance Budgets

*(Page load targets, API latency, bundle size limits)*
`

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve a template by name, checking .specfuse/templates/ first, then built-in.
 * Returns { content, source: 'custom' | 'builtin' } or null if not found.
 *
 * @param {string} projectRoot - Absolute project root
 * @param {string} name - User-facing template name (e.g. 'prd', 'proposal')
 * @returns {Promise<{content: string, source: string, path: string}|null>}
 */
export async function resolveTemplate(projectRoot, name) {
  const entry = TEMPLATE_NAME_MAP[name]
  if (!entry) return null

  // Constitution is always inline — no file to resolve
  if (entry.inline) {
    return { content: CONSTITUTION_TEMPLATE, source: 'builtin', path: null }
  }

  const relPath = join(entry.subDir, entry.filename)

  // Check custom override first
  const customPath = join(projectRoot, '.specfuse', 'templates', relPath)
  if (existsSync(customPath)) {
    const content = await readFile(customPath, 'utf8')
    return { content, source: 'custom', path: customPath }
  }

  // Fall back to built-in
  const builtinPath = join(BUILTIN_TEMPLATES_DIR, relPath)
  if (existsSync(builtinPath)) {
    const content = await readFile(builtinPath, 'utf8')
    return { content, source: 'builtin', path: builtinPath }
  }

  return null
}

/**
 * Resolve a template by subdirectory and filename (low-level).
 * Checks .specfuse/templates/ first, then built-in.
 *
 * @param {string} projectRoot
 * @param {string} subDir - e.g. 'plan', 'change', 'plan/design'
 * @param {string} filename - e.g. 'prd.md', 'review.md'
 * @returns {Promise<{content: string, source: string, path: string}|null>}
 */
export async function resolveTemplateByPath(projectRoot, subDir, filename) {
  const relPath = join(subDir, filename)

  // Check custom override first
  const customPath = join(projectRoot, '.specfuse', 'templates', relPath)
  if (existsSync(customPath)) {
    const content = await readFile(customPath, 'utf8')
    return { content, source: 'custom', path: customPath }
  }

  // Fall back to built-in
  const builtinPath = join(BUILTIN_TEMPLATES_DIR, relPath)
  if (existsSync(builtinPath)) {
    const content = await readFile(builtinPath, 'utf8')
    return { content, source: 'builtin', path: builtinPath }
  }

  return null
}

// ── Listing ──────────────────────────────────────────────────────────────────

/**
 * List all available templates, grouped by category.
 * For each template, checks if a custom override exists.
 *
 * @param {string} projectRoot
 * @returns {Promise<Array<{name: string, label: string, category: string, custom: boolean, builtinPath: string|null}>>}
 */
export async function listTemplates(projectRoot) {
  const results = []

  for (const [name, entry] of Object.entries(TEMPLATE_NAME_MAP)) {
    let custom = false

    if (entry.inline) {
      custom = false // constitution can't be overridden via file
    } else {
      const customPath = join(projectRoot, '.specfuse', 'templates', entry.subDir, entry.filename)
      custom = existsSync(customPath)
    }

    results.push({
      name,
      label: entry.label,
      category: entry.category,
      custom,
      builtinPath: entry.inline ? null : join(BUILTIN_TEMPLATES_DIR, entry.subDir, entry.filename),
    })
  }

  return results
}

// ── Variables ────────────────────────────────────────────────────────────────

/**
 * Extract documented template variables from @vars HTML comment block.
 *
 * Template files may include a comment block like:
 *   <!-- @vars
 *   date: Current date in YYYY-MM-DD format
 *   name: Project name
 *   -->
 *
 * @param {string} content - Template content
 * @returns {Array<{name: string, description: string}>}
 */
export function getTemplateVariables(content) {
  const match = content.match(/<!--\s*@vars\s*\n([\s\S]*?)-->/)
  if (!match) return []

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) return { name: line, description: '' }
      return {
        name: line.slice(0, colonIdx).trim(),
        description: line.slice(colonIdx + 1).trim(),
      }
    })
}

/**
 * Extract all {{variable}} references from template content.
 * Fallback when no @vars block exists.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractVariableReferences(content) {
  const refs = new Set()
  // Match {{name}} but not \{{name}} (escaped)
  const re = /(?<!\\)\{\{(\w+)\}\}/g
  let m
  while ((m = re.exec(content)) !== null) {
    refs.add(m[1])
  }
  return [...refs].sort()
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a template's syntax.
 * Checks for:
 * - Unmatched {{ / }} delimiters
 * - Empty variable names {{}}
 * - Unbalanced delimiters
 *
 * @param {string} content - Template content
 * @returns {{valid: boolean, errors: Array<{line: number, message: string}>}}
 */
export function validateTemplate(content) {
  const errors = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip escaped delimiters
    const cleaned = line.replaceAll('\\{{', '').replaceAll('\\}}', '')

    // Check for empty variable names
    const emptyMatch = cleaned.match(/\{\{\s*\}\}/)
    if (emptyMatch) {
      errors.push({ line: i + 1, message: 'Empty variable name: {{}}' })
      continue
    }

    // Count opening and closing delimiters
    const opens = (cleaned.match(/\{\{/g) || []).length
    const closes = (cleaned.match(/\}\}/g) || []).length

    if (opens !== closes) {
      if (opens > closes) {
        errors.push({ line: i + 1, message: `Unmatched {{ delimiter (${opens} opens, ${closes} closes)` })
      } else {
        errors.push({ line: i + 1, message: `Unmatched }} delimiter (${opens} opens, ${closes} closes)` })
      }
    }

    // Check for nested delimiters like {{foo {{bar}}}}
    const nestedMatch = cleaned.match(/\{\{[^}]*\{\{/)
    if (nestedMatch) {
      errors.push({ line: i + 1, message: 'Nested template delimiters detected' })
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate all custom templates in .specfuse/templates/.
 *
 * @param {string} projectRoot
 * @returns {Promise<Array<{path: string, valid: boolean, errors: Array<{line: number, message: string}>}>>}
 */
export async function validateAllCustomTemplates(projectRoot) {
  const customDir = join(projectRoot, '.specfuse', 'templates')
  const results = []

  if (!existsSync(customDir)) return results

  async function walkDir(dir, relPrefix = '') {
    let entries = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await walkDir(fullPath, relPath)
      } else if (entry.name.endsWith('.md')) {
        try {
          const content = await readFile(fullPath, 'utf8')
          const { valid, errors } = validateTemplate(content)
          results.push({ path: `.specfuse/templates/${relPath}`, valid, errors })
        } catch (err) {
          results.push({ path: `.specfuse/templates/${relPath}`, valid: false, errors: [{ line: 0, message: err.message }] })
        }
      }
    }
  }

  await walkDir(customDir)
  return results
}

// ── Copy ─────────────────────────────────────────────────────────────────────

/**
 * Copy a built-in template to .specfuse/templates/ for customization.
 * Returns the destination path.
 *
 * @param {string} projectRoot
 * @param {string} name - Template name (e.g. 'prd', 'proposal')
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{destPath: string, created: boolean, alreadyExists: boolean}>}
 */
export async function copyTemplate(projectRoot, name, options = {}) {
  const entry = TEMPLATE_NAME_MAP[name]
  if (!entry) {
    throw new Error(`Unknown template: '${name}'`)
  }

  // Constitution is inline — must handle specially
  if (entry.inline) {
    const destPath = join(projectRoot, '.specfuse', 'templates', 'specify', 'constitution.md')
    if (existsSync(destPath) && !options.force) {
      return { destPath, created: false, alreadyExists: true }
    }
    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, CONSTITUTION_TEMPLATE, 'utf8')
    return { destPath, created: true, alreadyExists: false }
  }

  const relPath = join(entry.subDir, entry.filename)
  const destPath = join(projectRoot, '.specfuse', 'templates', relPath)

  if (existsSync(destPath) && !options.force) {
    return { destPath, created: false, alreadyExists: true }
  }

  const srcPath = join(BUILTIN_TEMPLATES_DIR, relPath)
  if (!existsSync(srcPath)) {
    throw new Error(`Built-in template file not found: ${relPath}`)
  }

  await mkdir(dirname(destPath), { recursive: true })
  await copyFile(srcPath, destPath)
  return { destPath, created: true, alreadyExists: false }
}

// ── Suggestion ───────────────────────────────────────────────────────────────

/**
 * Suggest close matches for an invalid template name.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function suggestTemplateName(input) {
  const source = String(input ?? '').trim().toLowerCase()
  if (!source) return []

  const candidates = Object.keys(TEMPLATE_NAME_MAP)
  const ranked = candidates
    .map((c) => ({ name: c, score: levenshtein(source, c) }))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))

  const threshold = Math.max(2, Math.floor(source.length / 2))
  return ranked.filter((r) => r.score <= threshold).slice(0, 3).map((r) => r.name)
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}
