import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readdir } from 'fs/promises'
import {
  readFileSafe,
  writeFileAtomic,
  ensureDir,
  pathExists,
  getModifiedTime,
} from '../../utils/fs.js'
import { readManagedSection } from '../../utils/markdown.js'
import {
  loadArtifactSchema,
  getArtifactSchemaInstructions,
  applyArtifactSchemaInstructions,
} from '../../core/artifact-schema.js'
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
} from '../../utils/change-artifacts.js'
import { Registry } from '../../core/registry.js'
import { parseStoryReferences } from '../../core/traceability.js'
import { logger } from '../../utils/logger.js'
import chalk from 'chalk'

const CHANGES_DIR = (root) => join(root, '.specfuse', 'changes')

/** Fill template placeholders. */
function fillTemplate(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template)
}

const __dir_change = dirname(fileURLToPath(import.meta.url))

async function readTemplate(name) {
  const tplPath = join(__dir_change, '..', '..', '..', 'templates', 'change', name)
  return readFileSafe(tplPath)
}

async function loadSchemaOrExit(projectRoot, schemaPath) {
  try {
    return await loadArtifactSchema(projectRoot, { schemaPath })
  } catch (err) {
    logger.error(`Artifact schema error: ${err.message}`)
    process.exit(1)
  }
}

function applySchema(content, schema, artifactId) {
  const instructions = getArtifactSchemaInstructions(schema, artifactId)
  return applyArtifactSchemaInstructions(content, instructions)
}

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

async function readChangeFiles(changeDir) {
  const proposal = (await readFileSafe(join(changeDir, 'proposal.md'))) ?? ''
  const design = (await readFileSafe(join(changeDir, 'design.md'))) ?? ''
  const tasks = (await readFileSafe(join(changeDir, 'tasks.md'))) ?? ''
  const review = (await readFileSafe(join(changeDir, 'review.md'))) ?? ''
  const verify = (await readFileSafe(join(changeDir, 'verify.md'))) ?? ''

  return { proposal, design, tasks, review, verify }
}

function fillReviewTemplate(template, vars) {
  return Object.entries(vars).reduce(
    (content, [key, value]) => content.replaceAll(`{{${key}}}`, value),
    template,
  )
}

function reviewStatusLabel(content = '') {
  const { data } = parseFrontmatterDocument(content)
  return normalizeReviewStatus(data.status)
}

function verifyStatusLabel(content = '') {
  const { data } = parseFrontmatterDocument(content)
  return normalizeVerifyStatus(data.status)
}

async function generateReviewFile(projectRoot, changeDir, files, vars, schema) {
  const reviewPath = join(changeDir, 'review.md')
  if (pathExists(reviewPath)) return false

  const constitution = (await readFileSafe(join(projectRoot, '.specfuse', 'constitution.md'))) ?? ''
  const constitutionalChecklist = buildUncheckedChecklist(
    getConstitutionChecklistItems(constitution),
    (item) => `[${item}] reviewed`,
  )
  const acceptanceChecklist = buildUncheckedChecklist(extractAcceptanceCriteria(files.proposal))
  const template = (await readTemplate('review.md')) ?? ''
  const content = applySchema(
    fillReviewTemplate(template, {
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

async function generateVerifyFile(changeDir, files, vars, schema) {
  const verifyPath = join(changeDir, 'verify.md')
  if (pathExists(verifyPath)) return false

  const confirmationChecklist = buildConfirmedChecklist(extractAcceptanceCriteria(files.proposal))
  const template = (await readTemplate('verify.md')) ?? ''
  const content = applySchema(
    fillReviewTemplate(template, {
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

async function updateProposalStatus(proposalPath, proposalContent, updates = {}) {
  const parsed = parseFrontmatterDocument(proposalContent)
  const data = { ...parsed.data, ...updates }
  const next = `---\n${Object.entries(data)
    .map(([key, value]) => `${key}: ${value === null || value === undefined ? '~' : value}`)
    .join('\n')}\n---\n\n${parsed.content.trimStart()}`
  await writeFileAtomic(proposalPath, next)
}

function summarizeVerifyProgress(verifyContent = '') {
  const status = verifyStatusLabel(verifyContent)
  const counts = countVerifyChecklist(verifyContent)
  return { status, ...counts }
}

// ── specfuse change new ───────────────────────────────────────────────────────

/**
 * Create a new change proposal directory with proposal.md, design.md, tasks.md.
 * @param {string} projectRoot
 * @param {string} name   Change name (will be kebab-cased)
 */
export async function changeNew(projectRoot, name, options = {}) {
  const slug = slugifyName(name)
  const changeDir = join(CHANGES_DIR(projectRoot), slug)

  if (pathExists(changeDir)) {
    logger.error(`Change '${slug}' already exists at .specfuse/changes/${slug}/`)
    logger.info(`Run ${chalk.cyan(`specfuse change show ${slug}`)} to view it.`)
    process.exit(1)
  }

  await ensureDir(changeDir)

  const displayTitle = titleCaseChangeName(name)
  const date = new Date().toISOString().slice(0, 10)
  const vars = { title: displayTitle, changeName: slug, date }
  const schema = await loadSchemaOrExit(projectRoot, options.schema)

  const proposal = applySchema(
    fillTemplate((await readTemplate('proposal.md')) ?? '', vars),
    schema,
    'change.proposal',
  )
  const design = applySchema(
    fillTemplate((await readTemplate('design.md')) ?? '', vars),
    schema,
    'change.design',
  )
  const tasks = applySchema(
    fillTemplate((await readTemplate('tasks.md')) ?? '', vars),
    schema,
    'change.tasks',
  )

  await writeFileAtomic(join(changeDir, 'proposal.md'), proposal)
  await writeFileAtomic(join(changeDir, 'design.md'), design)
  await writeFileAtomic(join(changeDir, 'tasks.md'), tasks)

  logger.br()
  logger.success(`Created change: ${chalk.bold(slug)}`)
  logger.br()
  logger.info('Files created:')
  logger.row('  proposal.md', 'What and why — fill in overview, scope, AC', chalk.cyan)
  logger.row('  design.md', 'How — technical design plus UI impact', chalk.cyan)
  logger.row('  tasks.md', 'Implementation tasks and review checklist', chalk.cyan)
  logger.row('  review.md', 'Generated later from proposal AC + constitution', chalk.dim)
  logger.row('  verify.md', 'Generated later as the archive verification gate', chalk.dim)
  logger.br()
  logger.info(
    `Run ${chalk.cyan('specfuse sync')} to inject constitutional constraints into proposal.md`,
  )
  logger.info(
    `Run ${chalk.cyan(`specfuse change review ${slug}`)} and ${chalk.cyan(`specfuse change verify ${slug}`)} once the change is ready for review and verification`,
  )
  logger.info(`When done: ${chalk.cyan(`specfuse change archive ${slug}`)}`)
  logger.br()
}

// ── specfuse change list ──────────────────────────────────────────────────────

/**
 * List active and archived changes.
 * @param {string} projectRoot
 */
export async function changeList(projectRoot) {
  const changesDir = CHANGES_DIR(projectRoot)
  logger.header('Changes')
  logger.br()

  // Active changes
  logger.header('Active')
  let activeEntries = []
  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    activeEntries = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
  } catch {
    /* none */
  }

  if (!activeEntries.length) {
    logger.info(chalk.dim('No active changes. Run `specfuse change new <n>` to start one.'))
  } else {
    for (const entry of activeEntries) {
      const proposalPath = join(changesDir, entry.name, 'proposal.md')
      const { proposal, design, review, verify } = await readChangeFiles(
        join(changesDir, entry.name),
      )
      const title = getChangeTitle(proposal, entry.name)
      const status = getChangeProposalState(proposal, {
        reviewContent: review,
        verifyContent: verify,
      })
      const ac = extractAcceptanceCriteria(proposal)
      const verifyProgress = summarizeVerifyProgress(verify)
      const mtime = await getModifiedTime(proposalPath)
      const bar = ac.length
        ? chalk.dim(`${verifyProgress.checked}/${verifyProgress.total || ac.length} verified`)
        : chalk.dim('0 AC')
      const uiImpact = detectUiImpact(design)
      const reviewStatus = review ? reviewStatusLabel(review) : 'missing'
      console.log(
        `  ${chalk.green('◦')}  ${chalk.bold(title)}  ${chalk.dim(entry.name)}  ${chalk.dim(`[${status}]`)}  ${bar}  ${chalk.dim(`review:${reviewStatus}`)}  ${chalk.dim(`ui:${uiImpact}`)}  ${chalk.dim(mtime?.toISOString().slice(0, 10) ?? '')}`,
      )
    }
  }

  // Archived changes
  const archiveDir = join(changesDir, 'archive')
  logger.br()
  logger.header('Archived')
  let archivedEntries = []
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true })
    archivedEntries = entries.filter((e) => e.isDirectory()).slice(-5) // last 5
  } catch {
    /* none */
  }

  if (!archivedEntries.length) {
    logger.info(chalk.dim('No archived changes yet.'))
  } else {
    for (const entry of archivedEntries) {
      const proposalPath = join(archiveDir, entry.name, 'proposal.md')
      const verifyPath = join(archiveDir, entry.name, 'verify.md')
      const content = (await readFileSafe(proposalPath)) ?? ''
      const verify = (await readFileSafe(verifyPath)) ?? ''
      const title = getChangeTitle(content, entry.name)
      const verified = verifyStatusLabel(verify)
      console.log(
        `  ${chalk.dim('✔')}  ${chalk.dim(title)}  ${chalk.dim(entry.name)}  ${chalk.dim(`[${verified === 'pass' ? 'verified' : 'unverified'}]`)}`,
      )
    }
    if (archivedEntries.length === 5) {
      logger.info(chalk.dim('  (showing last 5 — view .specfuse/changes/archive/ for all)'))
    }
  }
  logger.br()
}

// ── specfuse change show ──────────────────────────────────────────────────────

/**
 * Show details of a specific change.
 * @param {string} projectRoot
 * @param {string} name  Change name
 */
export async function changeShow(projectRoot, name) {
  const resolved = await resolveChangeDir(projectRoot, name)
  if (!resolved) {
    const slug = slugifyName(name)
    logger.error(`Change '${slug}' not found in active or archived changes.`)
    logger.info(`Run ${chalk.cyan('specfuse change list')} to see all changes.`)
    process.exit(1)
  }
  const resolvedDir = resolved.dir
  if (resolved.archived) logger.info(chalk.dim(`(archived: ${resolved.archiveName})`))

  const proposalPath = join(resolvedDir, 'proposal.md')
  const content = await readFileSafe(proposalPath)
  if (!content) {
    logger.error('proposal.md not found in this change directory.')
    process.exit(1)
  }

  // Strip managed section for display
  const userContent = content
    .replace(
      /<!-- specfuse:constitution-header:start -->[\s\S]*?<!-- specfuse:constitution-header:end -->/g,
      '',
    )
    .replace(/---\n\n## \[SpecFuse Managed\].*\n\n/, '')
    .trim()

  logger.header(`Change: ${resolved.slug}`)
  logger.br()
  const reviewContent = (await readFileSafe(join(resolvedDir, 'review.md'))) ?? ''
  const verifyContent = (await readFileSafe(join(resolvedDir, 'verify.md'))) ?? ''
  logger.row(
    'Status',
    getChangeProposalState(content, { archived: resolved.archived, reviewContent, verifyContent }),
    chalk.yellowBright,
  )
  logger.row(
    'Review',
    reviewContent ? reviewStatusLabel(reviewContent) : 'not generated',
    reviewContent ? chalk.cyan : chalk.dim,
  )
  const verifySummary = summarizeVerifyProgress(verifyContent)
  logger.row(
    'Verify',
    verifyContent
      ? `${verifySummary.status} (${verifySummary.checked}/${verifySummary.total} confirmed)`
      : 'not generated',
    verifyContent ? chalk.cyan : chalk.dim,
  )
  logger.br()
  console.log(userContent)
  logger.br()

  // Check constitutional header
  const header = readManagedSection(content, 'constitution-header')
  if (header) {
    logger.info(chalk.dim('Constitutional constraints are injected. ✓'))
  } else {
    logger.warn('No constitutional header. Run `specfuse sync` to inject constraints.')
  }

  // Show files
  const files = ['proposal.md', 'design.md', 'tasks.md', 'review.md', 'verify.md']
  logger.br()
  for (const file of files) {
    const filePath = join(resolvedDir, file)
    const exists = pathExists(filePath)
    logger.row(
      `  ${exists ? chalk.green('✔') : chalk.dim('○')}  ${file}`,
      '',
      exists ? chalk.white : chalk.dim,
    )
  }
  logger.br()
}

// ── specfuse change review ───────────────────────────────────────────────────

export async function changeReview(projectRoot, name, options = {}) {
  const resolved = await resolveChangeDir(projectRoot, name)
  if (!resolved) {
    logger.error(`Change '${slugifyName(name)}' not found.`)
    process.exit(1)
  }

  const files = await readChangeFiles(resolved.dir)
  const title = getChangeTitle(files.proposal, resolved.slug)
  const vars = {
    title,
    changeName: resolved.slug,
    date: new Date().toISOString().slice(0, 10),
  }
  const schema = await loadSchemaOrExit(projectRoot, options.schema)

  const created = await generateReviewFile(projectRoot, resolved.dir, files, vars, schema)
  const reviewPath = join(resolved.dir, 'review.md')
  const reviewContent = (await readFileSafe(reviewPath)) ?? ''
  const status = reviewStatusLabel(reviewContent)

  logger.br()
  if (created)
    logger.success(
      `Generated ${chalk.cyan(`${resolved.archived ? `.specfuse/changes/archive/${resolved.archiveName}` : `.specfuse/changes/${resolved.slug}`}/review.md`)}`,
    )
  else logger.info(`review.md already exists for ${chalk.bold(resolved.slug)}`)

  logger.row('Review status', status, chalk.yellowBright)
  logger.info(`Edit ${chalk.cyan('review.md')} to complete the review checklist and sign-off.`)
  logger.br()
}

// ── specfuse change verify ───────────────────────────────────────────────────

export async function changeVerify(projectRoot, name, options = {}) {
  const resolved = await resolveChangeDir(projectRoot, name)
  if (!resolved) {
    logger.error(`Change '${slugifyName(name)}' not found.`)
    process.exit(1)
  }

  const files = await readChangeFiles(resolved.dir)
  const title = getChangeTitle(files.proposal, resolved.slug)
  const vars = {
    title,
    changeName: resolved.slug,
    date: new Date().toISOString().slice(0, 10),
  }
  const schema = await loadSchemaOrExit(projectRoot, options.schema)

  const created = await generateVerifyFile(resolved.dir, files, vars, schema)
  const verifyPath = join(resolved.dir, 'verify.md')
  const verifyContent = (await readFileSafe(verifyPath)) ?? ''
  const progress = summarizeVerifyProgress(verifyContent)

  logger.br()
  if (created)
    logger.success(
      `Generated ${chalk.cyan(`${resolved.archived ? `.specfuse/changes/archive/${resolved.archiveName}` : `.specfuse/changes/${resolved.slug}`}/verify.md`)}`,
    )
  else logger.info(`verify.md already exists for ${chalk.bold(resolved.slug)}`)

  logger.row('Verification status', progress.status, chalk.yellowBright)
  logger.row('Confirmed AC', `${progress.checked}/${progress.total}`, chalk.cyan)
  if (progress.remaining > 0)
    logger.warn(
      `${progress.remaining} acceptance criteria still need confirmation before archival.`,
    )
  logger.br()
}

// ── specfuse change archive ───────────────────────────────────────────────────

/**
 * Archive a completed change: move to .specfuse/changes/archive/YYYY-MM-DD-<name>/.
 * @param {string} projectRoot
 * @param {string} name  Change name
 * @param {{ force?: boolean }} [options]
 */
export async function changeArchive(projectRoot, name, options = {}) {
  const slug = slugifyName(name)
  const changeDir = join(CHANGES_DIR(projectRoot), slug)

  if (!pathExists(changeDir)) {
    logger.error(`Active change '${slug}' not found.`)
    logger.info(`Run ${chalk.cyan('specfuse change list')} to see active changes.`)
    process.exit(1)
  }

  const date = new Date().toISOString().slice(0, 10)
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive')
  const destDir = join(archiveDir, `${date}-${slug}`)

  const verifyPath = join(changeDir, 'verify.md')
  const verifyContent = (await readFileSafe(verifyPath)) ?? ''
  const verifyStatus = verifyStatusLabel(verifyContent)
  const verifyProgress = summarizeVerifyProgress(verifyContent)

  if (verifyStatus !== 'pass' && !options.force) {
    logger.error(`Change '${slug}' cannot be archived until verification passes.`)
    if (!verifyContent) {
      logger.info(`Run ${chalk.cyan(`specfuse change verify ${slug}`)} to generate verify.md.`)
    } else {
      logger.row('Verification status', verifyStatus, chalk.yellowBright)
      logger.row(
        'Confirmed AC',
        `${verifyProgress.checked}/${verifyProgress.total}`,
        chalk.yellowBright,
      )
    }
    logger.warn(
      `Use ${chalk.cyan(`specfuse change archive ${slug} --force`)} to override and archive as unverified.`,
    )
    process.exit(1)
  }

  await ensureDir(archiveDir)

  // Copy all files to archive (preserve originals until verified)
  const { cp, rm } = await import('fs/promises')
  await cp(changeDir, destDir, { recursive: true })

  const archivedProposalPath = join(destDir, 'proposal.md')
  const archivedProposal = (await readFileSafe(archivedProposalPath)) ?? ''
  await updateProposalStatus(archivedProposalPath, archivedProposal, {
    status: 'archived',
    archived: date,
  })

  logger.br()
  logger.success(`Archived: ${chalk.bold(slug)} → ${chalk.dim(`${date}-${slug}`)}`)
  if (verifyStatus !== 'pass')
    logger.warn('Archived with unverified acceptance criteria (--force used).')

  // Remove from active changes
  await rm(changeDir, { recursive: true, force: true })
  logger.success('Removed from active changes')

  // ── Trace integration: mark linked stories as implemented ──────────────────
  const archiveName = `${date}-${slug}`
  const proposalContent = await readFileSafe(join(destDir, 'proposal.md'))
  const storyIds = parseStoryReferences(proposalContent ?? '')

  if (storyIds.length) {
    const registry = new Registry(projectRoot)
    await registry.load()
    for (const storyId of storyIds) {
      registry.markStoryImplemented(storyId, archiveName)
    }
    await registry.save()
    logger.success(`Marked ${storyIds.length} linked story(ies) as implemented`)
  }

  logger.br()
  logger.info(
    `Run ${chalk.cyan('specfuse sync')} to update .specfuse/constitution.md [implemented-features]`,
  )
  logger.info(`Run ${chalk.cyan('specfuse trace')} to view the traceability matrix`)
  logger.br()
}
