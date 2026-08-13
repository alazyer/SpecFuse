import { join } from 'path'
import { readFileSafe, pathExists, readLockFile, isPidAlive } from '../utils/fs.js'
import { Registry, SCHEMA_VERSION } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { readdir } from 'fs/promises'
import { detectUiImpact, parseFrontmatterDocument } from '../utils/change-artifacts.js'

const PASS = (id, msg) => ({ id, state: 'PASS', message: msg })
const WARN = (id, msg, fix) => ({ id, state: 'WARN', message: msg, remediation: fix })
const FAIL = (id, msg, fix) => ({ id, state: 'FAIL', message: msg, remediation: fix })

const ROOT_REFERENCE_FILES = [
  'src/core/registry.js',
  'src/core/sync-engine.js',
  'src/commands/status.js',
  'src/core/workflow-advice.js',
]

const LEGACY_ROOT_REFERENCES = [
  'openspec/changes/',
  'constitution.md  (project root, human-visible)',
]

async function checkRegistrySchema(root) {
  const path = join(root, '.specfuse', 'registry.json')
  if (!pathExists(path))
    return FAIL('registry-schema', 'registry.json not found.', 'Run `specfuse init`.')
  try {
    const data = JSON.parse(await readFileSafe(path))
    if (!data.version)
      return FAIL(
        'registry-schema',
        'registry.json has no version field.',
        'Run `specfuse init --force`.',
      )
    if (data.version === '4.0.0') return PASS('registry-schema', `registry.json is valid (v4.0.0).`)
    return WARN(
      'registry-schema',
      `registry.json is v${data.version} — will migrate on next sync.`,
      'Run `specfuse sync`.',
    )
  } catch {
    return FAIL('registry-schema', 'registry.json is corrupt.', 'Run `specfuse init --force`.')
  }
}

/**
 * Report the state of the registry advisory lock: no lock (PASS), a stale lock
 * held by a dead process (WARN), or an active lock held by a running process
 * (WARN — informational, not an error). This is a passive read and never
 * acquires the lock itself.
 */
async function checkRegistryLock(root) {
  const lockPath = join(root, '.specfuse', 'registry.lock')
  if (!pathExists(lockPath)) return PASS('registry-lock', 'No active registry lock.')
  const holder = await readLockFile(lockPath)
  if (!holder)
    return WARN(
      'registry-lock',
      `registry.lock exists but is unreadable.`,
      `Remove ${lockPath} if no specfuse process is running.`,
    )
  const alive = await isPidAlive(holder.pid)
  if (!alive)
    return WARN(
      'registry-lock',
      `Stale registry lock from PID ${holder.pid} (${holder.command}) — process is no longer running.`,
      `It will be reclaimed on the next writer, or remove ${lockPath} manually.`,
    )
  return WARN(
    'registry-lock',
    `Registry lock held by PID ${holder.pid} (${holder.command}).`,
    'Wait for the in-flight operation to finish, or clear the lock if the holder has crashed.',
  )
}

/**
 * Report any quarantined registry files left by corrupt-JSON or version-mismatch
 * recovery. Each quarantine is a WARN with the file path and a recovery hint,
 * since the canonical registry.json was already re-initialized.
 */
async function checkQuarantinedRegistries(root) {
  const dir = join(root, '.specfuse')
  let entries = []
  try {
    const all = await readdir(dir, { withFileTypes: true })
    entries = all.filter(
      (e) =>
        e.isFile() &&
        (e.name.startsWith('registry.json.corrupt-') ||
          e.name.startsWith('registry.json.pre-migrate-') ||
          e.name.startsWith('registry.json.future-version-') ||
          e.name.startsWith('registry.json.unknown-version-')),
    )
  } catch {
    return PASS('registry-quarantine', '.specfuse/ not present — no quarantined files.')
  }
  if (!entries.length) return PASS('registry-quarantine', 'No quarantined registry files.')

  const names = entries.map((e) => e.name).join(', ')
  return WARN(
    'registry-quarantine',
    `${entries.length} quarantined registry file(s): ${names}. Current schema v${SCHEMA_VERSION}.`,
    'The canonical registry.json was re-initialized. Inspect quarantined files to recover data, then delete them.',
  )
}

async function checkConstitution(root) {
  const path = join(root, '.specfuse', 'constitution.md')
  if (!pathExists(path))
    return WARN(
      'constitution',
      'constitution.md not found.',
      'Run `specfuse specify init` to create it from your plan artifacts.',
    )
  const content = await readFileSafe(path)
  const starts = (content.match(/<!-- specfuse:[^:]+:start -->/g) ?? []).length
  const ends = (content.match(/<!-- specfuse:[^:]+:end -->/g) ?? []).length
  if (starts !== ends)
    return FAIL(
      'constitution',
      `Unclosed managed section markers (${starts} start, ${ends} end).`,
      'Inspect constitution.md for missing <!-- specfuse:*:end --> markers.',
    )
  return PASS('constitution', `constitution.md found with ${starts} managed section(s).`)
}

function checkPlanArtifacts(root) {
  const planDir = join(root, '.specfuse', 'plan')
  if (!pathExists(planDir))
    return WARN(
      'plan-artifacts',
      '.specfuse/plan/ not found.',
      'Run `specfuse plan prd` and `specfuse plan arch` to start planning.',
    )
  const hasPrd = pathExists(join(planDir, 'prd.md'))
  const hasArch = pathExists(join(planDir, 'architecture.md'))
  if (!hasPrd && !hasArch)
    return WARN(
      'plan-artifacts',
      '.specfuse/plan/ exists but has no prd.md or architecture.md.',
      'Run `specfuse plan prd` and `specfuse plan arch`.',
    )
  const missing = [!hasPrd && 'prd.md', !hasArch && 'architecture.md'].filter(Boolean)
  if (missing.length)
    return WARN(
      'plan-artifacts',
      `Plan missing: ${missing.join(', ')}.`,
      `Run: ${missing.map((m) => `specfuse plan ${m === 'prd.md' ? 'prd' : 'arch'}`).join(' and ')}`,
    )
  return PASS('plan-artifacts', 'prd.md and architecture.md found in .specfuse/plan/.')
}

async function checkChangesStructure(root) {
  const changesDir = join(root, '.specfuse', 'changes')
  if (!pathExists(changesDir))
    return PASS('changes-structure', '.specfuse/changes/ not created yet — no changes in flight.')

  let flatFiles = [],
    changeDirs = []
  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    flatFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'))
    changeDirs = entries.filter((e) => e.isDirectory() && e.name !== 'archive')
  } catch {
    /* empty */
  }

  if (flatFiles.length > 0 && changeDirs.length === 0)
    return WARN(
      'changes-structure',
      `Found ${flatFiles.length} flat .md file(s) in .specfuse/changes/ — expected directories.`,
      'Run `specfuse change new <n>` to create properly structured change proposals.',
    )
  if (changeDirs.length > 0)
    return PASS(
      'changes-structure',
      `${changeDirs.length} active change director(ies) found — correct structure.`,
    )
  return PASS('changes-structure', '.specfuse/changes/ exists and is ready.')
}

async function checkArtifactRootConsistency(root) {
  const hits = []

  for (const relativePath of ROOT_REFERENCE_FILES) {
    const filePath = join(root, relativePath)
    const content = await readFileSafe(filePath)
    if (!content) continue

    for (const reference of LEGACY_ROOT_REFERENCES) {
      if (content.includes(reference)) hits.push(`${relativePath}: ${reference}`)
    }
  }

  if (hits.length) {
    return WARN(
      'artifact-root-consistency',
      `Legacy artifact-root references found in runtime source: ${hits.join('; ')}.`,
      'Update runtime messages to use the canonical .specfuse/ paths.',
    )
  }

  return PASS(
    'artifact-root-consistency',
    'Runtime source references use canonical .specfuse/ paths.',
  )
}

async function checkUnexpectedChangeRoots(root) {
  const roots = []
  const nativeChanges = join(root, '.specfuse', 'changes')
  const nativeArchive = join(nativeChanges, 'archive')
  const legacyChanges = join(root, 'openspec', 'changes')

  if (pathExists(nativeChanges)) {
    const entries = await readdir(nativeChanges, { withFileTypes: true }).catch(() => [])
    const active = entries.filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    if (active.length)
      roots.push(`native:${active.length} active change dir(s) under .specfuse/changes/`)
    const archiveEntries = await readdir(nativeArchive, { withFileTypes: true }).catch(() => [])
    const archive = archiveEntries.filter((entry) => entry.isDirectory())
    if (archive.length) roots.push(`native-archive:${archive.length} archived change dir(s)`)
  }

  if (pathExists(legacyChanges)) {
    const entries = await readdir(legacyChanges, { withFileTypes: true }).catch(() => [])
    const active = entries.filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    if (active.length)
      roots.push(`legacy:${active.length} active change dir(s) under openspec/changes/`)
  }

  if (!roots.length) {
    return PASS('unexpected-change-roots', 'Only canonical .specfuse/ change roots are present.')
  }

  const legacyRoot = roots.find((item) => item.startsWith('legacy:'))
  if (legacyRoot) {
    return WARN(
      'unexpected-change-roots',
      `Unexpected non-native change root detected: ${legacyRoot.replace('legacy:', '')}.`,
      'Move runtime change work into .specfuse/changes/ and keep openspec/ for governance artifacts.',
    )
  }

  return PASS('unexpected-change-roots', roots.join(' • '))
}

async function checkNestedSections(root) {
  const content = await readFileSafe(join(root, '.specfuse', 'constitution.md'))
  if (!content) return PASS('nested-sections', 'constitution.md not present — skipping.')
  let depth = 0,
    nested = false
  for (const line of content.split('\n')) {
    if (/<!-- specfuse:[^:]+:start -->/.test(line)) depth++
    if (/<!-- specfuse:[^:]+:end -->/.test(line)) depth--
    if (depth > 1) {
      nested = true
      break
    }
  }
  return nested
    ? FAIL(
        'nested-sections',
        'Nested managed sections detected.',
        'Remove inner <!-- specfuse:*:start/end --> markers.',
      )
    : PASS('nested-sections', 'No nested managed sections found.')
}

async function checkOrphanedSyncs(root) {
  const reg = new Registry(root)
  await reg.load()
  const rules = await loadRules(root).catch(() => [])
  const ids = rules.flatMap((r) => [r.source, r.target, r.id])
  const syncs = reg.data?.syncs ?? {}
  const orphans = Object.keys(syncs).filter((k) => !ids.some((id) => k.includes(id)))
  return orphans.length
    ? WARN(
        'orphaned-syncs',
        `${orphans.length} stale sync record(s) in registry.`,
        'Run `specfuse sync` — registry is rebuilt on each sync.',
      )
    : PASS('orphaned-syncs', 'No orphaned sync records.')
}

/**
 * Report a stale `pendingSync` marker left by an interrupted sync. Read-only —
 * does not acquire the lock or attempt recovery. A stale marker means the last
 * sync was interrupted before it could clear the marker; the next `specfuse
 * sync` reconciles automatically (or `--no-recover` to inspect first).
 */
async function checkStalePendingSync(root) {
  const reg = new Registry(root)
  await reg.load()
  const marker = reg.getPendingSync()
  if (!marker) return PASS('pending-sync', 'No interrupted sync marker.')

  const startedAt = marker.startedAt ?? 'an unknown time'
  const entries = Array.isArray(marker?.manifest) ? marker.manifest.length : 0
  return WARN(
    'pending-sync',
    `Interrupted sync marker present (started ${startedAt}, ${entries} pending write(s)).`,
    'Run `specfuse sync` to reconcile automatically, or `specfuse sync --no-recover` to inspect state first.',
  )
}

/**
 * Report a stale `pendingArchive` marker left by an interrupted change
 * archive. Read-only — does not acquire the lock or attempt recovery. The next
 * `specfuse change archive <name>` for the same change completes the record
 * without duplicating the archived directory.
 */
async function checkStalePendingArchive(root) {
  const reg = new Registry(root)
  await reg.load()
  const marker = reg.getPendingArchive()
  if (!marker) return PASS('pending-archive', 'No interrupted archive marker.')

  const change = marker.change ?? 'unknown'
  const onDisk = pathExists(marker.archiveDir ?? '')
  return WARN(
    'pending-archive',
    `Interrupted archive marker present for change '${change}' (archived copy ${onDisk ? 'present on disk' : 'missing'}).`,
    `Re-run \`specfuse change archive ${change}\` to complete the record${onDisk ? ' without re-copying' : ' (the archive will be re-created from scratch)'}.`,
  )
}

async function checkPluginSyntax(root) {
  const path = join(root, '.specfuse', 'rules.mjs')
  if (!pathExists(path)) return PASS('plugin-syntax', 'No .specfuse/rules.mjs present.')
  try {
    await import(`file://${path}?t=${Date.now()}`)
    return PASS('plugin-syntax', '.specfuse/rules.mjs is valid.')
  } catch (err) {
    return FAIL(
      'plugin-syntax',
      `.specfuse/rules.mjs error: ${err.message}`,
      'Fix the syntax in .specfuse/rules.mjs.',
    )
  }
}

async function checkDesignSystem(root) {
  const changesDir = join(root, '.specfuse', 'changes')
  const designSystemPath = join(root, '.specfuse', 'plan', 'design', 'system.md')
  let uiAffecting = false

  try {
    const entries = await readdir(changesDir, { withFileTypes: true })
    const changeDirs = entries.filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    for (const entry of changeDirs) {
      const designContent = (await readFileSafe(join(changesDir, entry.name, 'design.md'))) ?? ''
      const impact = detectUiImpact(designContent)
      if (impact === 'yes' || impact === 'partial') {
        uiAffecting = true
        break
      }
    }
  } catch {
    /* empty */
  }

  if (!uiAffecting) return PASS('design-system', 'No UI-affecting active changes detected.')
  if (pathExists(designSystemPath))
    return PASS('design-system', 'Design system constraints document found.')
  return WARN(
    'design-system',
    'UI-affecting changes exist, but .specfuse/plan/design/system.md has not been created.',
    'Run `specfuse plan design system` to define design constraints before building more UI.',
  )
}

async function checkUnverifiedChanges(root) {
  const archiveDir = join(root, '.specfuse', 'changes', 'archive')
  let archivedDirs = []
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true })
    archivedDirs = entries.filter((entry) => entry.isDirectory())
  } catch {
    /* empty */
  }

  if (!archivedDirs.length) return PASS('unverified-changes', 'No archived changes found.')

  const unverified = []
  for (const entry of archivedDirs) {
    const verifyContent = (await readFileSafe(join(archiveDir, entry.name, 'verify.md'))) ?? ''
    const verifyData = parseFrontmatterDocument(verifyContent).data ?? {}
    const status = String(verifyData.status ?? 'unverified')
      .trim()
      .toLowerCase()
    if (status !== 'pass') unverified.push(entry.name)
  }

  return unverified.length
    ? WARN(
        'unverified-changes',
        `${unverified.length} archived change(s) were force-archived without verification: ${unverified.join(', ')}.`,
        'Review the archived verify.md files and confirm whether those changes were actually delivered.',
      )
    : PASS('unverified-changes', 'All archived changes are verified.')
}

/**
 * @param {string} projectRoot
 * @param {{ json?: boolean }} [options]
 */
export async function doctorCommand(projectRoot, options = {}) {
  const results = await Promise.all([
    checkRegistrySchema(projectRoot),
    checkRegistryLock(projectRoot),
    checkQuarantinedRegistries(projectRoot),
    checkConstitution(projectRoot),
    checkPlanArtifacts(projectRoot),
    checkChangesStructure(projectRoot),
    checkArtifactRootConsistency(projectRoot),
    checkUnexpectedChangeRoots(projectRoot),
    checkNestedSections(projectRoot),
    checkOrphanedSyncs(projectRoot),
    checkStalePendingSync(projectRoot),
    checkStalePendingArchive(projectRoot),
    checkPluginSyntax(projectRoot),
    checkDesignSystem(projectRoot),
    checkUnverifiedChanges(projectRoot),
  ])

  if (options.json) {
    const hasFail = results.some((r) => r.state === 'FAIL')
    console.log(JSON.stringify({ healthy: !hasFail, checks: results }, null, 2))
    if (hasFail) process.exit(1)
    return
  }

  logger.header('SpecFuse Doctor  v4')
  logger.br()

  for (const r of results) {
    const icon =
      r.state === 'PASS'
        ? chalk.green('✔')
        : r.state === 'WARN'
          ? chalk.yellow('⚠')
          : chalk.red('✗')
    const color = r.state === 'PASS' ? chalk.white : r.state === 'WARN' ? chalk.yellow : chalk.red
    console.log(`  ${icon}  ${chalk.dim(r.id.padEnd(22))} ${color(r.message)}`)
    if (r.remediation) console.log(`              ${chalk.dim('→')} ${chalk.italic(r.remediation)}`)
  }

  logger.br()
  const passes = results.filter((r) => r.state === 'PASS').length
  const warns = results.filter((r) => r.state === 'WARN').length
  const fails = results.filter((r) => r.state === 'FAIL').length
  logger.header('Summary')
  logger.row('Passed', String(passes), chalk.green)
  if (warns) logger.row('Warnings', String(warns), chalk.yellow)
  if (fails) logger.row('Failed', String(fails), chalk.red)
  logger.br()
  if (fails) {
    logger.error(`${fails} check(s) failed.`)
    process.exit(1)
  } else if (warns)
    logger.warn(`${warns} warning(s). SpecFuse will work but some setup is incomplete.`)
  else logger.success('All checks passed. SpecFuse is healthy. ✓')
  logger.br()
}
