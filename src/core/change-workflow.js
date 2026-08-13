import { basename, join } from 'path'
import { readdir, cp, rm } from 'fs/promises'
import { fileURLToPath } from 'url'

import {
  readFileSafe,
  writeFileAtomic,
  ensureDir,
  pathExists,
  getModifiedTime,
} from '../utils/fs.js'
import { fillTemplate } from './template-resolver.js'
import {
  loadArtifactSchema,
  getArtifactSchemaInstructions,
  applyArtifactSchemaInstructions,
} from './artifact-schema.js'
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
import { Registry } from './registry.js'
import { parseStoryReferences } from './traceability.js'
import {
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  ChangeNotVerifiedError,
  SchemaNotFoundError,
} from '../api/errors.mjs'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const CHANGES_DIR = (root) => join(root, '.specfuse', 'changes')
const CHANGE_TEMPLATES_DIR = join(__dir, '..', '..', 'templates', 'change')

function resolveRoot(root) {
  return join(root ?? '.')
}

function readTemplate(name) {
  return readFileSafe(join(CHANGE_TEMPLATES_DIR, name))
}

function applySchema(content, schema, artifactId) {
  const instructions = getArtifactSchemaInstructions(schema, artifactId)
  return applyArtifactSchemaInstructions(content, instructions)
}

async function loadSchemaOrThrow(projectRoot, schemaPath) {
  try {
    return await loadArtifactSchema(projectRoot, { schemaPath })
  } catch (err) {
    throw new SchemaNotFoundError(`Artifact schema error: ${err.message}`, {
      path: schemaPath ?? '.specfuse/artifact-schema.json',
      cause: err,
    })
  }
}

function writeFrontmatterStatus(proposalContent, updates = {}) {
  const parsed = parseFrontmatterDocument(proposalContent)
  const data = { ...parsed.data, ...updates }
  return `---\n${Object.entries(data)
    .map(([key, value]) => `${key}: ${value === null || value === undefined ? '~' : value}`)
    .join('\n')}\n---\n\n${parsed.content.trimStart()}`
}

export async function readChangeFiles(changeDir) {
  const proposal = (await readFileSafe(join(changeDir, 'proposal.md'))) ?? ''
  const design = (await readFileSafe(join(changeDir, 'design.md'))) ?? ''
  const tasks = (await readFileSafe(join(changeDir, 'tasks.md'))) ?? ''
  const review = (await readFileSafe(join(changeDir, 'review.md'))) ?? ''
  const verify = (await readFileSafe(join(changeDir, 'verify.md'))) ?? ''
  return { proposal, design, tasks, review, verify }
}

export async function resolveChangeDir(projectRoot, name) {
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

export async function createChange(root, name, options = {}) {
  const projectRoot = resolveRoot(root)
  const slug = slugifyName(name)
  const changeDir = join(CHANGES_DIR(projectRoot), slug)

  if (pathExists(changeDir)) {
    throw new ArtifactAlreadyExistsError(
      `Change '${slug}' already exists at .specfuse/changes/${slug}/`,
      {
        artifactType: 'change',
        path: changeDir,
      },
    )
  }

  await ensureDir(changeDir)

  const displayTitle = titleCaseChangeName(name)
  const date = new Date().toISOString().slice(0, 10)
  const vars = { title: displayTitle, changeName: slug, date }
  const schema = await loadSchemaOrThrow(projectRoot, options.schemaPath)

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

export async function listChanges(root) {
  const projectRoot = resolveRoot(root)
  const changesDir = CHANGES_DIR(projectRoot)

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

export async function showChange(root, name) {
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

export async function reviewChange(root, name, options = {}) {
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

  const reviewPath = join(resolved.dir, 'review.md')
  const created = !(await pathExists(reviewPath))
  if (created) {
    const constitution =
      (await readFileSafe(join(projectRoot, '.specfuse', 'constitution.md'))) ?? ''
    const constitutionalChecklist = buildUncheckedChecklist(
      getConstitutionChecklistItems(constitution),
      (item) => `[${item}] reviewed`,
    )
    const acceptanceChecklist = buildUncheckedChecklist(extractAcceptanceCriteria(files.proposal))
    const template = (await readTemplate('review.md')) ?? ''
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
  }

  const reviewContent = (await readFileSafe(reviewPath)) ?? ''
  const status = normalizeReviewStatus(parseFrontmatterDocument(reviewContent).data?.status)

  return { path: reviewPath, content: reviewContent, created, status }
}

export async function verifyChange(root, name, options = {}) {
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

  const verifyPath = join(resolved.dir, 'verify.md')
  const created = !(await pathExists(verifyPath))
  if (created) {
    const confirmationChecklist = buildConfirmedChecklist(extractAcceptanceCriteria(files.proposal))
    const template = (await readTemplate('verify.md')) ?? ''
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
  }

  const verifyContent = (await readFileSafe(verifyPath)) ?? ''
  const counts = countVerifyChecklist(verifyContent)
  const status = normalizeVerifyStatus(parseFrontmatterDocument(verifyContent).data?.status)

  return {
    path: verifyPath,
    content: verifyContent,
    created,
    status,
    checked: counts.checked,
    total: counts.total,
  }
}

export async function archiveChange(root, name, options = {}) {
  const projectRoot = resolveRoot(root)
  const slug = slugifyName(name)
  const changeDir = join(CHANGES_DIR(projectRoot), slug)
  const date = new Date().toISOString().slice(0, 10)
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive')
  const destDir = join(archiveDir, `${date}-${slug}`)

  // ── Crash-safe, idempotent archive (Improvement 2) ──────────────────────────
  // On entry, detect a stale `pendingArchive` marker from a prior interrupted
  // archive for this same change. If the archived copy survived on disk, the
  // prior run was interrupted after the copy but before the registry record
  // was completed — finish the record without re-copying. If the archived copy
  // is gone, clear the stale marker and re-run the full archive from scratch.
  const registry = new Registry(projectRoot)
  const resumedArchive = await registry.withLock(async (reg) => {
    await reg.load()
    const pending = reg.getPendingArchive()
    if (!pending || pending.change !== slug) return null

    // A stale marker for THIS change exists. Is the archived copy present?
    if (pathExists(pending.archiveDir)) {
      // The copy already landed; complete the registry record and exit without
      // re-copying (idempotent archive — the acceptance criterion).
      const proposalContent = await readFileSafe(join(pending.archiveDir, 'proposal.md'))
      const storyIds = parseStoryReferences(proposalContent ?? '')
      for (const storyId of storyIds) {
        reg.markStoryImplemented(storyId, basename(pending.archiveDir))
      }
      reg.clearPendingArchive()
      await reg.save()
      return { archiveDir: pending.archiveDir, storyIds, resumed: true }
    }

    // The archived copy is gone — the prior copy must not have completed. Clear
    // the stale marker and fall through to a fresh archive.
    reg.clearPendingArchive()
    await reg.save()
    return null
  })

  if (resumedArchive) {
    return {
      archiveDir: resumedArchive.archiveDir,
      archiveName: basename(resumedArchive.archiveDir),
      slug,
      verifyStatus: 'pass',
      verifyProgress: { checked: 0, total: 0 },
      storyIds: resumedArchive.storyIds,
      resumed: true,
    }
  }

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

  await ensureDir(archiveDir)
  await cp(changeDir, destDir, { recursive: true })

  const archivedProposalPath = join(destDir, 'proposal.md')
  const archivedProposal = (await readFileSafe(archivedProposalPath)) ?? ''
  await writeFileAtomic(
    archivedProposalPath,
    writeFrontmatterStatus(archivedProposal, {
      status: 'archived',
      archived: date,
    }),
  )

  // The copy + frontmatter rewrite landed. Persist a `pendingArchive` marker
  // (intent-before-delete) so a crash before/during the `rm` leaves a
  // resolvable marker instead of losing the change. The marker, the rm, and
  // the traceability record all sit inside one locked transaction so a
  // concurrent writer cannot interleave and lose the update.
  await registry.withLock(async (reg) => {
    await reg.load()
    reg.setPendingArchive({
      change: slug,
      sourceDir: changeDir,
      archiveDir: destDir,
    })
    await reg.save()

    // Remove the source directory now that the archive is durable on disk and
    // the marker is recorded. A crash here is recoverable on the next archive
    // attempt (or the next sync's doctor check): the archived copy survives and
    // the marker tells the re-run to complete the record.
    await rm(changeDir, { recursive: true, force: true })

    const proposalContent = await readFileSafe(join(destDir, 'proposal.md'))
    const storyIds = parseStoryReferences(proposalContent ?? '')
    for (const storyId of storyIds) {
      reg.markStoryImplemented(storyId, `${date}-${slug}`)
    }
    reg.clearPendingArchive()
    await reg.save()
  })

  const proposalContent = await readFileSafe(join(destDir, 'proposal.md'))
  const storyIds = parseStoryReferences(proposalContent ?? '')

  return {
    archiveDir: destDir,
    archiveName: basename(destDir),
    slug,
    verifyStatus,
    verifyProgress,
    storyIds,
  }
}
