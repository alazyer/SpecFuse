/**
 * Plan API — CRUD operations for planning artifacts.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { join, basename } from 'path'
import { readdir } from 'fs/promises'
import {
  resolveRoot,
  loadSchemaOrThrow,
  fillTemplate,
  applySchema,
  readTemplate,
  readFileSafe,
  writeFileAtomic,
  pathExists,
  ensureDir,
  getModifiedTime,
} from './utils.mjs'
import { slugifyName } from '../utils/change-artifacts.js'

const PLAN_DIR = (root) => join(root, '.specfuse', 'plan')
const DESIGN_DIR = (root) => join(PLAN_DIR(root), 'design')

/**
 * Determine the next numbered filename in a directory.
 * @param {string} dir
 * @param {string} prefix - e.g. 'story', 'flow', 'screen'
 * @param {string} [title] - Title to slugify for the filename
 * @param {string} fallbackSlug
 * @returns {Promise<{ nextNum: string, filename: string, id: string }>}
 */
async function nextNumberedFilename(dir, prefix, title, fallbackSlug) {
  let existing = []
  try {
    const entries = await readdir(dir)
    existing = entries.filter((entry) => entry.endsWith('.md'))
  } catch {
    /* empty */
  }

  const nextNum = String(existing.length + 1).padStart(3, '0')
  const slug = title ? slugifyName(title) : fallbackSlug
  const id = `${prefix.toUpperCase()}-${nextNum}`
  const filename = `${prefix}-${nextNum}-${slug || fallbackSlug}.md`
  return { nextNum, id, filename }
}

/**
 * Create a PRD from template.
 *
 * @param {string} root - Project root path
 * @param {{ name?: string, schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, created: boolean }>}
 */
export async function createPrd(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const planDir = PLAN_DIR(projectRoot)
  await ensureDir(planDir)

  const prdPath = join(planDir, 'prd.md')

  if (pathExists(prdPath)) {
    const content = await readFileSafe(prdPath)
    return { path: prdPath, content: content ?? '', created: false }
  }

  const projectName = options.name ?? basename(projectRoot)
  const template = await readTemplate('plan', 'prd.md')
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const content = applySchema(
    fillTemplate(template ?? '', {
      date: new Date().toISOString().slice(0, 10),
      name: projectName,
    }),
    schema,
    'plan.prd',
  )

  await writeFileAtomic(prdPath, content)
  return { path: prdPath, content, created: true }
}

/**
 * Create an architecture document from template.
 *
 * @param {string} root - Project root path
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, created: boolean }>}
 */
export async function createArch(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const planDir = PLAN_DIR(projectRoot)
  await ensureDir(planDir)

  const archPath = join(planDir, 'architecture.md')

  if (pathExists(archPath)) {
    const content = await readFileSafe(archPath)
    return { path: archPath, content: content ?? '', created: false }
  }

  const template = await readTemplate('plan', 'architecture.md')
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const content = applySchema(
    fillTemplate(template ?? '', {
      date: new Date().toISOString().slice(0, 10),
    }),
    schema,
    'plan.arch',
  )

  await writeFileAtomic(archPath, content)
  return { path: archPath, content, created: true }
}

/**
 * Add a new user story.
 *
 * @param {string} root - Project root path
 * @param {string} [title] - Story title
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, filename: string, id: string }>}
 */
export async function createStory(root, title, options = {}) {
  const projectRoot = resolveRoot(root)
  const storiesDir = join(PLAN_DIR(projectRoot), 'stories')
  await ensureDir(storiesDir)

  const { id, filename } = await nextNumberedFilename(storiesDir, 'story', title, 'new-story')
  const storyPath = join(storiesDir, filename)

  const displayTitle = title ?? 'New Story'
  const template = await readTemplate('plan', 'story.md')
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const content = applySchema(
    fillTemplate(template ?? '', {
      title: displayTitle,
      id,
      date: new Date().toISOString().slice(0, 10),
      role: 'user',
      capability: 'do something',
      benefit: 'achieve an outcome',
    }),
    schema,
    'plan.story',
  )

  await writeFileAtomic(storyPath, content)
  return { path: storyPath, content, filename, id }
}

/**
 * Create a design system document from template.
 *
 * @param {string} root - Project root path
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, created: boolean }>}
 */
export async function createDesignSystem(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const designDir = DESIGN_DIR(projectRoot)
  await ensureDir(designDir)

  const systemPath = join(designDir, 'system.md')

  if (pathExists(systemPath)) {
    const content = await readFileSafe(systemPath)
    return { path: systemPath, content: content ?? '', created: false }
  }

  const template = await readTemplate('plan/design', 'system.md')
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const content = applySchema(
    fillTemplate(template ?? '', {
      date: new Date().toISOString().slice(0, 10),
    }),
    schema,
    'plan.design.system',
  )

  await writeFileAtomic(systemPath, content)
  return { path: systemPath, content, created: true }
}

/**
 * Create a design flow document.
 *
 * @param {string} root - Project root path
 * @param {string} [title] - Flow title
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, filename: string, id: string }>}
 */
export async function createDesignFlow(root, title, options = {}) {
  const projectRoot = resolveRoot(root)
  const flowsDir = join(DESIGN_DIR(projectRoot), 'flows')
  await ensureDir(flowsDir)

  const { id, filename } = await nextNumberedFilename(flowsDir, 'flow', title, 'new-flow')
  const filePath = join(flowsDir, filename)

  const template = await readTemplate('plan/design', 'flow.md')
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const content = applySchema(
    fillTemplate(template ?? '', {
      date: new Date().toISOString().slice(0, 10),
      title: title ?? 'New Flow',
      id,
    }),
    schema,
    'plan.design.flow',
  )

  await writeFileAtomic(filePath, content)
  return { path: filePath, content, filename, id }
}

/**
 * Create a design screen spec document.
 *
 * @param {string} root - Project root path
 * @param {string} [title] - Screen title
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, filename: string, id: string }>}
 */
export async function createDesignScreen(root, title, options = {}) {
  const projectRoot = resolveRoot(root)
  const screensDir = join(DESIGN_DIR(projectRoot), 'screens')
  await ensureDir(screensDir)

  const { id, filename } = await nextNumberedFilename(screensDir, 'screen', title, 'new-screen')
  const filePath = join(screensDir, filename)

  const template = await readTemplate('plan/design', 'screen.md')
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)
  const content = applySchema(
    fillTemplate(template ?? '', {
      date: new Date().toISOString().slice(0, 10),
      title: title ?? 'New Screen',
      id,
    }),
    schema,
    'plan.design.screen',
  )

  await writeFileAtomic(filePath, content)
  return { path: filePath, content, filename, id }
}

/**
 * List all planning artifacts with status.
 *
 * @param {string} root - Project root path
 * @returns {Promise<{ artifacts: Array<{ type: string, label: string, path: string, exists: boolean, modifiedTime?: string }> }>}
 */
export async function list(root) {
  const projectRoot = resolveRoot(root)
  const planDir = PLAN_DIR(projectRoot)
  const artifacts = []

  // PRD
  const prdPath = join(planDir, 'prd.md')
  const prdExists = pathExists(prdPath)
  const prdTime = prdExists ? await getModifiedTime(prdPath) : null
  artifacts.push({
    type: 'prd',
    label: 'PRD',
    path: prdPath,
    exists: prdExists,
    modifiedTime: prdTime?.toISOString().slice(0, 10) ?? undefined,
  })

  // Architecture
  const archPath = join(planDir, 'architecture.md')
  const archExists = pathExists(archPath)
  const archTime = archExists ? await getModifiedTime(archPath) : null
  artifacts.push({
    type: 'arch',
    label: 'Architecture',
    path: archPath,
    exists: archExists,
    modifiedTime: archTime?.toISOString().slice(0, 10) ?? undefined,
  })

  // Design system
  const systemPath = join(planDir, 'design', 'system.md')
  const systemExists = pathExists(systemPath)
  const systemTime = systemExists ? await getModifiedTime(systemPath) : null
  artifacts.push({
    type: 'design-system',
    label: 'Design System',
    path: systemPath,
    exists: systemExists,
    modifiedTime: systemTime?.toISOString().slice(0, 10) ?? undefined,
  })

  // Stories
  const storiesDir = join(planDir, 'stories')
  let storyFiles = []
  try {
    const entries = await readdir(storiesDir, { withFileTypes: true })
    storyFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
  } catch {
    /* empty */
  }
  for (const file of storyFiles.sort()) {
    const filePath = join(storiesDir, file)
    const content = (await readFileSafe(filePath)) ?? ''
    const storyTitle =
      content.match(/^#\s+Story:\s+(.+)$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1] ?? file
    const done = (content.match(/- \[x\]/gi) ?? []).length
    const total = (content.match(/- \[[ x]\]/gi) ?? []).length
    artifacts.push({
      type: 'story',
      label: storyTitle,
      path: filePath,
      exists: true,
      filename: file,
      acceptanceCriteria: total ? { done, total } : undefined,
    })
  }

  // Design flows
  const flowsDir = join(planDir, 'design', 'flows')
  let flowFiles = []
  try {
    const entries = await readdir(flowsDir, { withFileTypes: true })
    flowFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
  } catch {
    /* empty */
  }
  for (const file of flowFiles.sort()) {
    const filePath = join(flowsDir, file)
    const content = (await readFileSafe(filePath)) ?? ''
    const flowTitle =
      content.match(/^#\s+[^:]+:\s+(.+)$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1] ?? file
    artifacts.push({
      type: 'design-flow',
      label: flowTitle,
      path: filePath,
      exists: true,
      filename: file,
    })
  }

  // Design screens
  const screensDir = join(planDir, 'design', 'screens')
  let screenFiles = []
  try {
    const entries = await readdir(screensDir, { withFileTypes: true })
    screenFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
  } catch {
    /* empty */
  }
  for (const file of screenFiles.sort()) {
    const filePath = join(screensDir, file)
    const content = (await readFileSafe(filePath)) ?? ''
    const screenTitle =
      content.match(/^#\s+[^:]+:\s+(.+)$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1] ?? file
    artifacts.push({
      type: 'design-screen',
      label: screenTitle,
      path: filePath,
      exists: true,
      filename: file,
    })
  }

  return { artifacts }
}
