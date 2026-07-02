import { createHash } from 'crypto'

/**
 * Managed section markers.
 * All SpecFuse-owned content lives between these HTML comment delimiters.
 *
 * Format in file:
 *   <!-- specfuse:section-name:start -->
 *   ... managed content ...
 *   <!-- specfuse:section-name:end -->
 */
const makeStart = (name) => `<!-- specfuse:${name}:start -->`
const makeEnd = (name) => `<!-- specfuse:${name}:end -->`

/**
 * Upsert a managed section into a Markdown document.
 * If the section exists, replace it. If not, append it.
 *
 * @param {string} content        - Current file content
 * @param {string} sectionName    - e.g. 'bmad-decisions'
 * @param {string} newContent     - Content to place inside the section
 * @returns {string}              - Updated file content
 */
export function upsertManagedSection(content, sectionName, newContent) {
  const start = makeStart(sectionName)
  const end = makeEnd(sectionName)
  const block = `${start}\n${newContent.trim()}\n${end}`

  if (content.includes(start)) {
    // Replace existing block — use a non-greedy match
    const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`${escaped(start)}[\\s\\S]*?${escaped(end)}`)
    return content.replace(regex, block)
  }

  // Append to end of file with a preceding blank line
  const trimmed = content.trimEnd()
  return `${trimmed}\n\n---\n\n## [SpecFuse Managed] ${sectionName}\n\n${block}\n`
}

/**
 * Read the content inside a managed section.
 *
 * @param {string} content
 * @param {string} sectionName
 * @returns {string|null}  Content inside the markers, or null if not found
 */
export function readManagedSection(content, sectionName) {
  const start = makeStart(sectionName)
  const end = makeEnd(sectionName)

  const startIdx = content.indexOf(start)
  const endIdx = content.indexOf(end)

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null

  return content.slice(startIdx + start.length, endIdx).trim()
}

/**
 * Extract a named H2 section (and its content until the next H2 or EOF).
 *
 * @param {string} content
 * @param {string} headingText  - Exact heading text (case-insensitive)
 * @returns {string|null}
 */
export function extractH2Section(content, headingText) {
  const lines = content.split('\n')
  let inSection = false
  const collected = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inSection) break // Hit the next H2 — stop
      // Normalise: strip leading "1. " / "1.1 " numbering and leading emoji before comparing
      const normalized = line
        .slice(3)
        .trim()
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\s]+/u, '') // strip leading emoji
        .replace(/^\d+(\.\d+)*\.?\s+/, '') // strip leading numbers
        .toLowerCase()
      if (normalized === headingText.toLowerCase()) {
        inSection = true
        continue // Skip the heading line itself
      }
    }
    if (inSection) collected.push(line)
  }

  return inSection ? collected.join('\n').trim() : null
}

/**
 * Extract multiple H2 sections by a list of possible heading names.
 * Returns the first match found.
 *
 * @param {string} content
 * @param {string[]} candidates
 * @returns {{ heading: string, content: string }|null}
 */
export function extractH2SectionAny(content, candidates) {
  for (const heading of candidates) {
    const found = extractH2Section(content, heading)
    if (found) return { heading, content: found }
  }
  return null
}

/**
 * Extract all H2 sections from a Markdown document.
 * Skips content inside managed sections.
 *
 * @param {string} content
 * @returns {Array<{ heading: string, content: string }>}
 */
export function extractAllH2Sections(content) {
  // Strip managed sections first so we don't extract them
  const stripped = stripManagedSections(content)
  const lines = stripped.split('\n')
  const sections = []
  let current = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { heading: line.slice(3).trim(), content: '' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current) sections.push(current)

  return sections.map((s) => ({ ...s, content: s.content.trim() }))
}

/**
 * Strip all managed sections from content, leaving user content intact.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripManagedSections(content) {
  return content
    .replace(/<!-- specfuse:[^:]+:start -->[\s\S]*?<!-- specfuse:[^:]+:end -->/g, '')
    .trim()
}

/**
 * Compute a stable SHA-256 hash of a string.
 *
 * @param {string} str
 * @returns {string}
 */
export function hashContent(str) {
  return createHash('sha256').update(str.trim(), 'utf8').digest('hex')
}

/**
 * Convert extracted Markdown content into a flat bullet list of rules.
 * Used to format BMAD sections into constitutional rules.
 *
 * @param {string} sectionHeading
 * @param {string} sectionContent
 * @returns {string}
 */
export function contentToRules(sectionHeading, sectionContent) {
  const lines = sectionContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

  const rules = lines.map((l) => {
    // Strip existing bullet markers for re-formatting
    const cleaned = l.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')
    return `- **[${sectionHeading}]** ${cleaned}`
  })

  return rules.join('\n')
}
