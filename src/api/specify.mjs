/**
 * Specify API — CRUD operations for constitution artifacts.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { join } from 'path'
import {
  resolveRoot,
  loadSchemaOrThrow,
  readFileSafe,
  writeFileAtomic,
  pathExists,
} from './utils.mjs'
import { ArtifactNotFoundError } from './errors.mjs'
import {
  extractAllH2Sections,
  stripManagedSections,
} from '../utils/markdown.js'
import {
  getArtifactSchemaInstructions,
  applyArtifactSchemaInstructions,
} from '../core/artifact-schema.js'
import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { runTwoPassSync } from '../core/sync-engine.js'

const CONSTITUTION_TEMPLATE = `# Project Constitution

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

/**
 * Initialize constitution.md.
 *
 * @param {string} root - Project root path
 * @param {{ force?: boolean, sync?: boolean, schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, created: boolean, syncedSections?: number }>}
 */
export async function init(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const constitutionPath = join(projectRoot, '.specfuse', 'constitution.md')

  if (pathExists(constitutionPath) && !options.force) {
    const content = await readFileSafe(constitutionPath)
    return { path: constitutionPath, content: content ?? '', created: false }
  }

  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const schemaInstructions = getArtifactSchemaInstructions(schema, 'specify.constitution')
  const constitution = applyArtifactSchemaInstructions(CONSTITUTION_TEMPLATE, schemaInstructions)
  await writeFileAtomic(constitutionPath, constitution)

  let syncedSections = 0

  // Auto-sync plan artifacts if they exist and sync is not disabled
  const hasPrd = pathExists(join(projectRoot, '.specfuse', 'plan', 'prd.md'))
  const hasArch = pathExists(join(projectRoot, '.specfuse', 'plan', 'architecture.md'))

  if ((hasPrd || hasArch) && options.sync !== false) {
    const registry = new Registry(projectRoot)
    await registry.load()
    const rules = await loadRules(projectRoot)
    const { passA } = await runTwoPassSync(
      projectRoot,
      registry,
      rules.filter((r) => r.pass === 'A'),
    )
    syncedSections = passA.filter((r) => r.changed).length
  }

  return { path: constitutionPath, content: constitution, created: true, syncedSections }
}

/**
 * Add or update a named rule section in constitution.md.
 *
 * @param {string} root - Project root path
 * @param {string} sectionName - Heading for the section (e.g. 'API Standards')
 * @param {string} [content] - Section body (defaults to placeholder)
 * @returns {Promise<{ path: string, section: string, added: boolean }>}
 * added=true means a new section was appended; added=false means an existing section was replaced
 */
export async function add(root, sectionName, content) {
  const projectRoot = resolveRoot(root)
  const constitutionPath = join(projectRoot, '.specfuse', 'constitution.md')

  if (!pathExists(constitutionPath)) {
    throw new ArtifactNotFoundError('constitution.md not found. Run specify.init() first.', {
      artifactType: 'constitution',
      path: constitutionPath,
    })
  }

  const existing = await readFileSafe(constitutionPath)
  const body = content ?? `*(Add ${sectionName} rules here)*`

  // Check if the section already exists as a regular H2
  const hasSection = existing.includes(`## ${sectionName}`)
  let updated

  if (hasSection) {
    // Replace existing section content
    const lines = existing.split('\n')
    const result = []
    let inSection = false
    let contentInserted = false
    for (const line of lines) {
      if (line === `## ${sectionName}`) {
        inSection = true
        result.push(line)
        continue
      }
      if (inSection && line.startsWith('## ')) {
        inSection = false
      }
      if (!inSection) {
        result.push(line)
      } else if (inSection && !contentInserted) {
        result.push('')
        result.push(body)
        result.push('')
        contentInserted = true
      }
    }
    updated = result.join('\n')
  } else {
    // Append a new section before the managed sections marker
    const stripped = stripManagedSections(existing).trimEnd()
    updated = `${stripped}\n\n## ${sectionName}\n\n${body}\n`
  }

  await writeFileAtomic(constitutionPath, updated)
  return { path: constitutionPath, section: sectionName, added: !hasSection }
}

/**
 * Read and parse the constitution.
 *
 * @param {string} root - Project root path
 * @returns {Promise<{ sections: Array<{ heading: string, content: string, managed: boolean }>, raw: string }>}
 * @throws {ArtifactNotFoundError} If constitution.md does not exist
 */
export async function show(root) {
  const projectRoot = resolveRoot(root)
  const constitutionPath = join(projectRoot, '.specfuse', 'constitution.md')

  if (!pathExists(constitutionPath)) {
    throw new ArtifactNotFoundError('constitution.md not found. Run specify.init() first.', {
      artifactType: 'constitution',
      path: constitutionPath,
    })
  }

  const raw = await readFileSafe(constitutionPath)
  const sections = extractAllH2Sections(raw ?? '')

  // Detect managed sections via comment markers
  const managedPrefixes = [
    'plan-decisions',
    'plan-prd',
    'design-constraints',
    'user-stories',
    'implemented-features',
  ]

  return {
    sections: sections.map((s) => ({
      heading: s.heading,
      content: s.content,
      managed: s.heading.startsWith('[SpecFuse') || managedPrefixes.some((p) => raw?.includes(`<!-- specfuse:${p}:start -->`)),
    })),
    raw: raw ?? '',
  }
}
