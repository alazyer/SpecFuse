/**
 * Markdown Linter Engine for SpecFuse.
 *
 * Self-contained linting engine using only Node.js built-ins + existing `diff` package.
 * Each rule is a pure function: (filePath, content, config) → LintResult[]
 *
 * Config file: .specfuse/markdownlint.json
 * Schema: { "rules": { "rule-name": "error"|"warn"|"off", ... }, "default": "warn" }
 */

import { join, relative, extname, dirname, resolve } from 'path'
import { readdir, stat, readFile, writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { pathExists } from '../utils/fs.js'

// ─── Default Rule Configuration ──────────────────────────────────────────────

export const DEFAULT_RULE_CONFIG = {
  rules: {
    'heading-hierarchy': 'error',
    'internal-links': 'error',
    'cross-file-links': 'error',
    'trailing-whitespace': 'warn',
    'multiple-blank-lines': 'warn',
    'missing-alt-text': 'warn',
    'code-block-language': 'warn',
  },
  default: 'warn',
}

/** Rules that can be auto-fixed by `fixContent()` */
export const FIXABLE_RULES = new Set(['trailing-whitespace', 'multiple-blank-lines'])

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively collect all Markdown files under a directory.
 *
 * Thin wrapper over `collectMarkdownFilesDetailed` that returns only the file
 * list, preserving the original `string[]` return type for existing callers.
 *
 * @param {string} dir - Directory to scan
 * @param {string} [baseDir] - Base directory for computing relative paths
 * @returns {Promise<string[]>}  Array of absolute paths
 */
export async function collectMarkdownFiles(dir, baseDir = dir) {
  const scan = await collectMarkdownFilesDetailed(dir, baseDir)
  return scan.files
}

/**
 * Recursively collect all Markdown files under a directory, surfacing any
 * unreadable files or directories as `issues` alongside the collected files.
 *
 * Unlike `collectMarkdownFiles`, a directory whose entries cannot be read
 * (e.g. permission denied) is recorded as an issue rather than throwing, so
 * the caller (e.g. `lint --fix`) can report what was skipped and continue.
 *
 * @param {string} dir - Directory to scan
 * @param {string} [baseDir] - Base directory for computing relative paths
 * @returns {Promise<{ files: string[], issues: Array<{ path: string, state: string, error?: string }> }>}
 */
export async function collectMarkdownFilesDetailed(dir, baseDir = dir) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { files: [], issues: [] }
    }
    return {
      files: [],
      issues: [
        {
          path: dir,
          state: 'unreadable',
          error: err?.message ?? 'Unable to read directory.',
        },
      ],
    }
  }

  const files = []
  const issues = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip .git, node_modules, etc. — but allow .specfuse
      if (entry.name.startsWith('.') && entry.name !== '.specfuse') continue
      if (entry.name === 'node_modules') continue
      const nested = await collectMarkdownFilesDetailed(fullPath, baseDir)
      files.push(...nested.files)
      issues.push(...nested.issues)
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return { files, issues }
}

/**
 * Normalize an anchor string using GitHub's algorithm:
 * lowercase, spaces→hyphens, strip most punctuation.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeAnchor(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-鿿-]/g, '') // keep word chars, CJK, and hyphens
}

/**
 * Extract all headings from Markdown content.
 *
 * @param {string} content
 * @returns {Array<{ level: number, text: string, line: number, anchor: string }>}
 */
export function extractHeadings(content) {
  const headings = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ATX-style headings (# Heading)
    const atxMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (atxMatch) {
      const level = atxMatch[1].length
      const text = atxMatch[2].replace(/#+\s*$/, '').trim()
      headings.push({ level, text, line: i + 1, anchor: normalizeAnchor(text) })
      continue
    }

    // Setext-style headings (underlined with === or ---)
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1]
      if (/^=+\s*$/.test(nextLine) && line.trim().length > 0) {
        headings.push({ level: 1, text: line.trim(), line: i + 1, anchor: normalizeAnchor(line.trim()) })
      } else if (/^-+\s*$/.test(nextLine) && line.trim().length > 0) {
        headings.push({ level: 2, text: line.trim(), line: i + 1, anchor: normalizeAnchor(line.trim()) })
      }
    }
  }

  return headings
}

/**
 * Extract all links from Markdown content.
 *
 * @param {string} content
 * @returns {Array<{ raw: string, href: string, text: string, line: number, type: 'internal'|'cross-file'|'external'|'reference' }>}
 */
export function extractLinks(content) {
  const links = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Standard markdown links: [text](href)
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
    let match
    while ((match = linkRegex.exec(line)) !== null) {
      const text = match[1]
      const href = match[2].trim()

      let type = 'external'
      if (href.startsWith('#')) {
        type = 'internal'
      } else if (/^\.?\/?[^#]*\.md(#.*)?$/i.test(href)) {
        type = 'cross-file'
      }

      links.push({ raw: match[0], href, text, line: i + 1, type })
    }

    // Reference-style links: [text][ref]
    const refLinkRegex = /\[([^\]]+)\]\[([^\]]*)\]/g
    while ((match = refLinkRegex.exec(line)) !== null) {
      const text = match[1]
      const ref = match[2] || text
      links.push({ raw: match[0], href: ref, text, line: i + 1, type: 'reference' })
    }
  }

  return links
}

/**
 * Extract fenced code blocks from Markdown content.
 *
 * @param {string} content
 * @returns {Array<{ line: number, language: string|null }>}
 */
function extractCodeBlocks(content) {
  const blocks = []
  const lines = content.split('\n')
  let inBlock = false
  let fenceChar = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const fence = fenceMatch[1]
      const currentFenceChar = fence[0]

      if (!inBlock) {
        // Opening fence
        inBlock = true
        fenceChar = currentFenceChar
        const language = fenceMatch[2].trim() || null
        blocks.push({ line: i + 1, language })
      } else if (currentFenceChar === fenceChar) {
        // Closing fence (same character)
        inBlock = false
        fenceChar = null
      }
    }
  }

  return blocks
}

/**
 * Extract images from Markdown content.
 *
 * @param {string} content
 * @returns {Array<{ raw: string, alt: string, line: number }>}
 */
function extractImages(content) {
  const images = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const imgRegex = /!\[([^\]]*)\]\([^)]+\)/g
    let match
    while ((match = imgRegex.exec(lines[i])) !== null) {
      images.push({ raw: match[0], alt: match[1], line: i + 1 })
    }
  }

  return images
}

// ─── Severity Resolution ─────────────────────────────────────────────────────

/**
 * Resolve the severity for a rule given the config.
 *
 * @param {string} ruleName
 * @param {{ rules?: object, default?: string }} config
 * @returns {'error'|'warn'|'off'}
 */
function resolveSeverity(ruleName, config) {
  const rules = config?.rules ?? DEFAULT_RULE_CONFIG.rules
  const level = rules[ruleName] ?? config?.default ?? DEFAULT_RULE_CONFIG.default
  return level
}

// ─── Lint Rules ──────────────────────────────────────────────────────────────

/**
 * Rule: heading-hierarchy
 * H1→H2→H3 ordering, no skipped levels (e.g. H1→H3).
 */
function ruleHeadingHierarchy(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('heading-hierarchy', config)
  if (severity === 'off') return results

  const headings = extractHeadings(content)
  let lastLevel = 0

  for (const h of headings) {
    if (lastLevel > 0 && h.level > lastLevel + 1) {
      results.push({
        file: filePath,
        rule: 'heading-hierarchy',
        severity,
        message: `Heading level skipped: H${lastLevel} → H${h.level} ("${h.text}")`,
        line: h.line,
        fixable: false,
      })
    }
    lastLevel = h.level
  }

  return results
}

/**
 * Rule: internal-links
 * Validates that #anchor links reference an existing heading in the current file.
 */
function ruleInternalLinks(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('internal-links', config)
  if (severity === 'off') return results

  const headings = extractHeadings(content)
  const anchors = new Set(headings.map((h) => h.anchor))
  const links = extractLinks(content).filter((l) => l.type === 'internal')

  for (const link of links) {
    const anchor = normalizeAnchor(link.href.slice(1)) // strip leading #
    if (!anchors.has(anchor)) {
      results.push({
        file: filePath,
        rule: 'internal-links',
        severity,
        message: `Internal link #${link.href.slice(1)} does not match any heading`,
        line: link.line,
        fixable: false,
      })
    }
  }

  return results
}

/**
 * Rule: cross-file-links
 * Validates that ./path.md and ./path.md#anchor links resolve.
 * Uses synchronous file reads for simplicity in the rule engine.
 */
function ruleCrossFileLinks(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('cross-file-links', config)
  if (severity === 'off') return results

  const links = extractLinks(content).filter((l) => l.type === 'cross-file')
  const fileDir = dirname(filePath)

  for (const link of links) {
    const hashIdx = link.href.indexOf('#')
    const pathPart = hashIdx >= 0 ? link.href.slice(0, hashIdx) : link.href
    const anchorPart = hashIdx >= 0 ? link.href.slice(hashIdx + 1) : null

    // Resolve relative to the directory containing the current file
    const targetPath = resolve(fileDir, pathPart)

    if (!existsSync(targetPath)) {
      results.push({
        file: filePath,
        rule: 'cross-file-links',
        severity,
        message: `Cross-file link target not found: ${link.href}`,
        line: link.line,
        fixable: false,
      })
      continue
    }

    // If anchor specified, validate it exists in the target file
    if (anchorPart) {
      try {
        const targetContent = readFileSync(targetPath, 'utf8')
        const headings = extractHeadings(targetContent)
        const normalizedAnchor = normalizeAnchor(anchorPart)
        if (!headings.some((h) => h.anchor === normalizedAnchor)) {
          results.push({
            file: filePath,
            rule: 'cross-file-links',
            severity,
            message: `Cross-file link anchor not found: ${link.href}`,
            line: link.line,
            fixable: false,
          })
        }
      } catch {
        // If we can't read the target, skip anchor validation
      }
    }
  }

  return results
}

/**
 * Rule: trailing-whitespace
 * Flags lines with trailing spaces or tabs.
 */
function ruleTrailingWhitespace(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('trailing-whitespace', config)
  if (severity === 'off') return results

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/[ \t]+$/.test(lines[i])) {
      results.push({
        file: filePath,
        rule: 'trailing-whitespace',
        severity,
        message: `Trailing whitespace on line ${i + 1}`,
        line: i + 1,
        fixable: true,
      })
    }
  }

  return results
}

/**
 * Rule: multiple-blank-lines
 * Flags 3+ consecutive newlines (2+ blank lines).
 */
function ruleMultipleBlankLines(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('multiple-blank-lines', config)
  if (severity === 'off') return results

  const lines = content.split('\n')
  let blankCount = 0

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      blankCount++
      if (blankCount >= 3) {
        results.push({
          file: filePath,
          rule: 'multiple-blank-lines',
          severity,
          message: `Multiple blank lines (3+) at line ${i + 1}`,
          line: i + 1,
          fixable: true,
        })
      }
    } else {
      blankCount = 0
    }
  }

  return results
}

/**
 * Rule: missing-alt-text
 * Flags ![  ](…) images without meaningful alt text.
 */
function ruleMissingAltText(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('missing-alt-text', config)
  if (severity === 'off') return results

  const images = extractImages(content)
  for (const img of images) {
    if (img.alt.trim() === '') {
      results.push({
        file: filePath,
        rule: 'missing-alt-text',
        severity,
        message: `Image missing alt text: ${img.raw}`,
        line: img.line,
        fixable: false,
      })
    }
  }

  return results
}

/**
 * Rule: code-block-language
 * Flags fenced code blocks without a language hint.
 */
function ruleCodeBlockLanguage(filePath, content, config) {
  const results = []
  const severity = resolveSeverity('code-block-language', config)
  if (severity === 'off') return results

  const blocks = extractCodeBlocks(content)
  for (const block of blocks) {
    if (block.language === null || block.language === '') {
      results.push({
        file: filePath,
        rule: 'code-block-language',
        severity,
        message: `Code block missing language hint at line ${block.line}`,
        line: block.line,
        fixable: false,
      })
    }
  }

  return results
}

// ─── Rule Registry ───────────────────────────────────────────────────────────

/** @type {Array<(filePath: string, content: string, config: object) => Array<object>>} */
const RULES = [
  ruleHeadingHierarchy,
  ruleInternalLinks,
  ruleCrossFileLinks,
  ruleTrailingWhitespace,
  ruleMultipleBlankLines,
  ruleMissingAltText,
  ruleCodeBlockLanguage,
]

/** Map from rule function name to kebab-case rule name */
const RULE_NAME_MAP = {
  ruleHeadingHierarchy: 'heading-hierarchy',
  ruleInternalLinks: 'internal-links',
  ruleCrossFileLinks: 'cross-file-links',
  ruleTrailingWhitespace: 'trailing-whitespace',
  ruleMultipleBlankLines: 'multiple-blank-lines',
  ruleMissingAltText: 'missing-alt-text',
  ruleCodeBlockLanguage: 'code-block-language',
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load lint config from .specfuse/markdownlint.json.
 *
 * @param {string} projectRoot
 * @param {{ configPath?: string }} [options]
 * @returns {Promise<object>}  Merged config with defaults
 */
export async function loadLintConfig(projectRoot, options = {}) {
  const configPath = options.configPath ?? join(projectRoot, '.specfuse', 'markdownlint.json')

  if (!pathExists(configPath)) {
    return { ...DEFAULT_RULE_CONFIG }
  }

  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      rules: { ...DEFAULT_RULE_CONFIG.rules, ...(parsed.rules ?? {}) },
      default: parsed.default ?? DEFAULT_RULE_CONFIG.default,
    }
  } catch {
    return { ...DEFAULT_RULE_CONFIG }
  }
}

/**
 * Lint a single content string.
 *
 * @param {string} filePath  - Path (used in results and for cross-file resolution)
 * @param {string} content   - Markdown content
 * @param {object} config    - Lint config (from loadLintConfig)
 * @param {{ ruleFilter?: string[], artifactFilter?: string }} [options]
 * @returns {Array<object>}  Lint results
 */
export function lintContent(filePath, content, config, options = {}) {
  const ruleFilter = options.ruleFilter
  const artifactFilter = options.artifactFilter

  // Artifact filtering: if --artifact specified, only lint matching files
  if (artifactFilter) {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const normalizedFilter = artifactFilter.replace(/\\/g, '/')
    if (!normalizedPath.includes(normalizedFilter)) {
      return []
    }
  }

  const results = []

  for (const rule of RULES) {
    const ruleName = RULE_NAME_MAP[rule.name] ?? rule.name

    // Apply rule filter
    if (ruleFilter && ruleFilter.length > 0) {
      if (!ruleFilter.includes(ruleName)) continue
    }

    const ruleResults = rule(filePath, content, config)
    results.push(...ruleResults)
  }

  return results
}

/**
 * Lint files on disk.
 *
 * @param {string} projectRoot
 * @param {object} config
 * @param {{ ruleFilter?: string[], artifactFilter?: string, configPath?: string }} [options]
 * @returns {Promise<{ results: Array<object>, fileCount: number }>}
 */
export async function lintFiles(projectRoot, config, options = {}) {
  const specDir = join(projectRoot, '.specfuse')
  const files = await collectMarkdownFiles(specDir, projectRoot)

  const allResults = []

  for (const absPath of files) {
    try {
      const content = await readFile(absPath, 'utf8')
      const relPath = relative(projectRoot, absPath)
      const results = lintContent(relPath, content, config, options)
      allResults.push(...results)
    } catch {
      // Skip unreadable files
    }
  }

  // Also lint root-level .specfuse/*.md files (like constitution.md)
  const rootEntries = await readdir(specDir).catch(() => [])
  const rootMdFiles = rootEntries.filter((f) => /\.md$/i.test(f))

  for (const name of rootMdFiles) {
    const absPath = join(specDir, name)
    try {
      const content = await readFile(absPath, 'utf8')
      const relPath = relative(projectRoot, absPath)
      const results = lintContent(relPath, content, config, options)
      allResults.push(...results)
    } catch {
      // Skip
    }
  }

  return {
    results: allResults,
    fileCount: files.length + rootMdFiles.length,
  }
}

/**
 * Auto-fix fixable issues in content string.
 * Only trailing whitespace and multiple blank lines are fixable.
 *
 * @param {string} content
 * @param {object} [config]
 * @returns {string}  Fixed content
 */
export function fixContent(content, config = DEFAULT_RULE_CONFIG) {
  // Fix trailing whitespace
  content = content.replace(/[ \t]+$/gm, '')

  // Fix multiple blank lines (3+ consecutive newlines → 2 newlines)
  content = content.replace(/\n{3,}/g, '\n\n')

  // Ensure single trailing newline
  if (!content.endsWith('\n')) {
    content += '\n'
  } else {
    content = content.replace(/\n+$/, '\n')
  }

  return content
}
