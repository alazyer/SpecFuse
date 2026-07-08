/**
 * Change API — CRUD operations for change proposal artifacts.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { join } from 'path'
import { readdir, cp, rm } from 'fs/promises'
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
import {
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  ChangeNotVerifiedError,
} from './errors.mjs'
import {
  slugifyName,
  titleCaseChangeName,
  parseFrontmatterDocument,
  normalizeReviewStatus,
  normalizeVerifyStatus,
  extractAcceptanceCriteria,
  getConstitutionChecklistItems,
  buildUncheckedChecklist,
  buildConfirmedChecklist,
  countVerifyChecklist,
  detectUiImpact,
  getChangeProposalState,
  getChangeTitle,
} from '../utils/change-artifacts.js'
import { readManagedSection } from '../utils/markdown.js'

const CHANGES_DIR = (root) => join(root, '.specfuse', 'changes')

/**
 * Read all standard change files from a directory.
 * @param {string} changeDir
 * @returns {Promise<{ proposal: string, design: string, tasks: string, review: string, verify: string }>}
 */
async function readChangeFiles(changeDir) {
  const proposal = (await readFileSafe(join(changeDir, 'proposal.md'))) ?? ''
  const design = (await readFileSafe(join(changeDir, 'design.md'))) ?? ''
  const tasks = (await readFileSafe(join(changeDir, 'tasks.md'))) ?? ''
  const review = (await readFileSafe(join(changeDir, 'review.md'))) ?? ''
  const verify = (await readFileSafe(join(changeDir, 'verify.md'))) ?? ''
  return { proposal, design, tasks, review, verify }
}

/**
 * Resolve a change directory by name, checking both active and archived.
 * @param {string} projectRoot
 * @param {string} name
 * @returns {Promise<{ slug: string, dir: string, archived: boolean, archiveName: string|null }|null>}
 */
async function resolveChangeDir(projectRoot, name) {
  const slug = slugifyName(name)
  const activeDir = join(CHANGES_DIR(projectRoot), slug)
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive')

  if (pathExists(activeDir)) return { slug, dir: activeDir, archived: false, archiveName: null }

  let archiveMatch = null
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true })
    archiveMatch = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(slug))
  } catch {
    /* empty */
  }

  if (!archiveMatch) return null
  return {
    slug,
    dir: join(archiveDir, archiveMatch.name),
    archived: true,
    archiveName: archiveMatch.name,
  }
}

/**
 * Update proposal frontmatter status fields.
 * @param {string} proposalPath
 * @param {string} proposalContent
 * @param {Record<string, string|number>} updates
 */
async function updateProposalStatus(proposalPath, proposalContent, updates = {}) {
  const parsed = parseFrontmatterDocument(proposalContent)
  const data = { ...parsed.data, ...updates }
  const next = `---\n${Object.entries(data)
    .map(([key, value]) => `${key}: ${value === null || value === undefined ? '~' : value}`)
    .join('\n')}\n---\n\n${parsed.content.trimStart()}`
  await writeFileAtomic(proposalPath, next)
}

/**
 * Generate a review.md file for a change.
 * @param {string} projectRoot
 * @param {string} changeDir
 * @param {{ proposal: string, design: string, tasks: string, review: string, verify: string }} files
 * @param {Record<string, string>} vars
 * @param {object} schema
 * @returns {Promise<boolean>} true if created, false if already existed
 */
async function generateReviewFile(projectRoot, changeDir, files, vars, schema) {
  const reviewPath = join(changeDir, 'review.md')
  if (pathExists(reviewPath)) return false

  const constitution =
    (await readFileSafe(join(projectRoot, '.specfuse', 'constitution.md'))) ?? ''
  const constitutionalChecklist = buildUncheckedChecklist(
    getConstitutionChecklistItems(constitution),
    (item) => `[${item}] reviewed`,
  )
  const acceptanceChecklist = buildUncheckedChecklist(extractAcceptanceCriteria(files.proposal))
  const template = (await readTemplate('change', 'review.md')) ?? ''
  const content = applySchema(
    fillTemplate(template, {
      ...vars,
      constitutionalChecklist,
      acceptanceChecklist,
      reviewer: '~',
      reviewedAt: '~',
    }),
    schema,
    'change.review',
  )

  await writeFileAtomic(reviewPath, content)
  return true
}

/**
 * Generate a verify.md file for a change.
 * @param {string} changeDir
 * @param {{ proposal: string, design: string, tasks: string, review: string, verify: string }} files
 * @param {Record<string, string>} vars
 * @param {object} schema
 * @returns {Promise<boolean>} true if created, false if already existed
 */
async function generateVerifyFile(changeDir, files, vars, schema) {
  const verifyPath = join(changeDir, 'verify.md')
  if (pathExists(verifyPath)) return false

  const confirmationChecklist = buildConfirmedChecklist(extractAcceptanceCriteria(files.proposal))
  const template = (await readTemplate('change', 'verify.md')) ?? ''
  const content = applySchema(
    fillTemplate(template, {
      ...vars,
      confirmationChecklist,
      verifiedBy: '~',
      verifiedAt: '~',
    }),
    schema,
    'change.verify',
  )

  await writeFileAtomic(verifyPath, content)
  return true
}

/**
 * Create a new change proposal directory with proposal.md, design.md, tasks.md.
 *
 * @param {string} root - Project root path
 * @param {string} name - Change name (will be kebab-cased)
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ slug: string, dir: string, files: Array<{ name: string, path: string, content: string }> }>}
 * @throws {ArtifactAlreadyExistsError} If change with same slug already exists
 */
export async function _newChange(root, name, options = {}) {
  const projectRoot = resolveRoot(root)
  const slug = slugifyName(name)
  const changeDir = join(CHANGES_DIR(projectRoot), slug)

  if (pathExists(changeDir)) {
    throw new ArtifactAlreadyExistsError(
      `Change '${slug}' already exists at .specfuse/changes/${slug}/`,
      { artifactType: 'change', path: changeDir },
    )
  }

  await ensureDir(changeDir)

  const displayTitle = titleCaseChangeName(name)
  const date = new Date().toISOString().slice(0, 10)
  const vars = { title: displayTitle, changeName: slug, date }
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)

  const proposal = applySchema(
    fillTemplate((await readTemplate('change', 'proposal.md')) ?? '', vars),
    schema,
    'change.proposal',
  )
  const design = applySchema(
    fillTemplate((await readTemplate('change', 'design.md')) ?? '', vars),
    schema,
    'change.design',
  )
  const tasks = applySchema(
    fillTemplate((await readTemplate('change', 'tasks.md')) ?? '', vars),
    schema,
    'change.tasks',
  )

  await writeFileAtomic(join(changeDir, 'proposal.md'), proposal)
  await writeFileAtomic(join(changeDir, 'design.md'), design)
  await writeFileAtomic(join(changeDir, 'tasks.md'), tasks)

  return {
    slug,
    dir: changeDir,
    files: [
      { name: 'proposal.md', path: join(changeDir, 'proposal.md'), content: proposal },
      { name: 'design.md', path: join(changeDir, 'design.md'), content: design },
      { name: 'tasks.md', path: join(changeDir, 'tasks.md'), content: tasks },
    ],
  }
}

/**
 * List active and archived changes.
 *
 * @param {string} root - Project root path
 * @returns {Promise<{ active: Array<object>, archived: Array<object> }>}
 */
export async function list(root) {
  const projectRoot = resolveRoot(root)
  const changesDir = CHANGES_DIR(projectRoot)

  // Active changes
  const active = []
  let activeEntries = []
  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    activeEntries = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
  } catch {
    /* none */
  }

  for (const entry of activeEntries) {
    const changeDir = join(changesDir, entry.name)
    const files = await readChangeFiles(changeDir)
    const title = getChangeTitle(files.proposal, entry.name)
    const status = getChangeProposalState(files.proposal, {
      reviewContent: files.review,
      verifyContent: files.verify,
    })
    const ac = extractAcceptanceCriteria(files.proposal)
    const verifyProgress = countVerifyChecklist(files.verify)
    const mtime = await getModifiedTime(join(changeDir, 'proposal.md'))
    const reviewStatus = files.review
      ? normalizeReviewStatus(parseFrontmatterDocument(files.review).data?.status)
      : 'missing'
    const uiImpact = detectUiImpact(files.design)

    active.push({
      slug: entry.name,
      title,
      status,
      reviewStatus,
      verifyProgress: { checked: verifyProgress.checked, total: verifyProgress.total || ac.length },
      uiImpact,
      modifiedTime: mtime?.toISOString().slice(0, 10) ?? null,
    })
  }

  // Archived changes
  const archived = []
  const archiveDir = join(changesDir, 'archive')
  let archivedEntries = []
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true })
    archivedEntries = entries.filter((e) => e.isDirectory())
  } catch {
    /* none */
  }

  for (const entry of archivedEntries) {
    const proposalPath = join(archiveDir, entry.name, 'proposal.md')
    const verifyPath = join(archiveDir, entry.name, 'verify.md')
    const content = (await readFileSafe(proposalPath)) ?? ''
    const verify = (await readFileSafe(verifyPath)) ?? ''
    const title = getChangeTitle(content, entry.name)
    const verifyStatus = normalizeVerifyStatus(parseFrontmatterDocument(verify).data?.status)

    archived.push({
      slug: entry.name,
      title,
      archiveName: entry.name,
      verifyStatus,
    })
  }

  return { active, archived }
}

/**
 * Show full details of a specific change.
 *
 * @param {string} root - Project root path
 * @param {string} name - Change name (kebab-case or display name)
 * @returns {Promise<object>}
 * @throws {ArtifactNotFoundError} If change not found
 */
export async function show(root, name) {
  const projectRoot = resolveRoot(root)
  const resolved = await resolveChangeDir(projectRoot, name)

  if (!resolved) {
    const slug = slugifyName(name)
    throw new ArtifactNotFoundError(`Change '${slug}' not found in active or archived changes.`, {
      artifactType: 'change',
      name: slug,
    })
  }

  const files = await readChangeFiles(resolved.dir)
  const title = getChangeTitle(files.proposal, resolved.slug)
  const status = getChangeProposalState(files.proposal, {
    archived: resolved.archived,
    reviewContent: files.review,
    verifyContent: files.verify,
  })
  const reviewStatus = files.review
    ? normalizeReviewStatus(parseFrontmatterDocument(files.review).data?.status)
    : null
  const verifyCounts = countVerifyChecklist(files.verify)
  const verifyStatus = files.verify
    ? normalizeVerifyStatus(parseFrontmatterDocument(files.verify).data?.status)
    : null
  const header = readManagedSection(files.proposal, 'constitution-header')

  return {
    slug: resolved.slug,
    dir: resolved.dir,
    archived: resolved.archived,
    archiveName: resolved.archiveName,
    title,
    proposal: files.proposal,
    design: files.design,
    tasks: files.tasks,
    review: files.review,
    verify: files.verify,
    status,
    reviewStatus,
    verifyStatus,
    verifyProgress: verifyCounts,
    hasConstitutionalHeader: !!header,
  }
}

/**
 * Generate a review.md for a change.
 *
 * @param {string} root - Project root path
 * @param {string} name - Change name
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, created: boolean, status: string }>}
 * @throws {ArtifactNotFoundError} If change not found
 */
export async function review(root, name, options = {}) {
  const projectRoot = resolveRoot(root)
  const resolved = await resolveChangeDir(projectRoot, name)

  if (!resolved) {
    throw new ArtifactNotFoundError(`Change '${slugifyName(name)}' not found.`, {
      artifactType: 'change',
      name: slugifyName(name),
    })
  }

  const files = await readChangeFiles(resolved.dir)
  const title = getChangeTitle(files.proposal, resolved.slug)
  const vars = {
    title,
    changeName: resolved.slug,
    date: new Date().toISOString().slice(0, 10),
  }
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)

  const created = await generateReviewFile(projectRoot, resolved.dir, files, vars, schema)
  const reviewPath = join(resolved.dir, 'review.md')
  const reviewContent = (await readFileSafe(reviewPath)) ?? ''
  const status = normalizeReviewStatus(parseFrontmatterDocument(reviewContent).data?.status)

  return { path: reviewPath, content: reviewContent, created, status }
}

/**
 * Generate a verify.md for a change.
 *
 * @param {string} root - Project root path
 * @param {string} name - Change name
 * @param {{ schemaPath?: string }} [options]
 * @returns {Promise<{ path: string, content: string, created: boolean, status: string, checked: number, total: number }>}
 * @throws {ArtifactNotFoundError} If change not found
 */
export async function verify(root, name, options = {}) {
  const projectRoot = resolveRoot(root)
  const resolved = await resolveChangeDir(projectRoot, name)

  if (!resolved) {
    throw new ArtifactNotFoundError(`Change '${slugifyName(name)}' not found.`, {
      artifactType: 'change',
      name: slugifyName(name),
    })
  }

  const files = await readChangeFiles(resolved.dir)
  const title = getChangeTitle(files.proposal, resolved.slug)
  const vars = {
    title,
    changeName: resolved.slug,
    date: new Date().toISOString().slice(0, 10),
  }
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)

  const created = await generateVerifyFile(resolved.dir, files, vars, schema)
  const verifyPath = join(resolved.dir, 'verify.md')
  const verifyContent = (await readFileSafe(verifyPath)) ?? ''
  const counts = countVerifyChecklist(verifyContent)
  const status = normalizeVerifyStatus(parseFrontmatterDocument(verifyContent).data?.status)

  return { path: verifyPath, content: verifyContent, created, status, checked: counts.checked, total: counts.total }
}

/**
 * Archive a completed change: move to .specfuse/changes/archive/YYYY-MM-DD-<name>/.
 *
 * @param {string} root - Project root path
 * @param {string} name - Change name
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ archiveDir: string, slug: string }>}
 * @throws {ArtifactNotFoundError} If active change not found
 * @throws {ChangeNotVerifiedError} If verification not passed and force not set
 */
export async function archive(root, name, options = {}) {
  const projectRoot = resolveRoot(root)
  const slug = slugifyName(name)
  const changeDir = join(CHANGES_DIR(projectRoot), slug)

  if (!pathExists(changeDir)) {
    throw new ArtifactNotFoundError(`Active change '${slug}' not found.`, {
      artifactType: 'change',
      name: slug,
      path: changeDir,
    })
  }

  const verifyPath = join(changeDir, 'verify.md')
  const verifyContent = (await readFileSafe(verifyPath)) ?? ''
  const verifyStatus = normalizeVerifyStatus(parseFrontmatterDocument(verifyContent).data?.status)
  const verifyProgress = countVerifyChecklist(verifyContent)

  if (verifyStatus !== 'pass' && !options.force) {
    throw new ChangeNotVerifiedError(
      `Change '${slug}' cannot be archived until verification passes.`,
      {
        slug,
        verifyStatus,
        checked: verifyProgress.checked,
        total: verifyProgress.total,
      },
    )
  }

  const date = new Date().toISOString().slice(0, 10)
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive')
  const destDir = join(archiveDir, `${date}-${slug}`)

  await ensureDir(archiveDir)
  await cp(changeDir, destDir, { recursive: true })

  const archivedProposalPath = join(destDir, 'proposal.md')
  const archivedProposal = (await readFileSafe(archivedProposalPath)) ?? ''
  await updateProposalStatus(archivedProposalPath, archivedProposal, {
    status: 'archived',
    archived: date,
  })

  // Remove from active changes
  await rm(changeDir, { recursive: true, force: true })

  return { archiveDir: destDir, slug }
}

// Export `_newChange` as `new` — `new` is a reserved word in function declarations
// but is valid as an export name and object property.
export { _newChange as new }
