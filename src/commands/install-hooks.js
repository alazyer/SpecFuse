import { join } from 'path'
import { readFileSafe, writeFileAtomic, ensureDir, pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import { chmod } from 'fs/promises'
import chalk from 'chalk'

const HEADER_TAG = '# specfuse-managed'

const HOOKS = {
  'pre-commit': [
    '#!/bin/sh',
    `${HEADER_TAG}: pre-commit`,
    '# Blocks commit if spec drift is detected.',
    'specfuse drift --fail',
  ].join('\n'),

  'post-commit': [
    '#!/bin/sh',
    `${HEADER_TAG}: post-commit`,
    '# Keeps constitution in sync after every commit.',
    'specfuse sync',
  ].join('\n'),
}

/**
 * Install SpecFuse-managed git hooks.
 * Idempotent — safe to run multiple times.
 *
 * @param {string} projectRoot
 */
export async function installHooksCommand(projectRoot) {
  logger.header('SpecFuse Install Hooks')
  logger.br()

  const gitDir = join(projectRoot, '.git')
  const hooksDir = join(gitDir, 'hooks')

  if (!pathExists(gitDir)) {
    logger.error('No .git directory found. SpecFuse hooks require a git repository.')
    logger.info('Run `git init` first.')
    process.exit(1)
  }

  await ensureDir(hooksDir)

  for (const [hookName, content] of Object.entries(HOOKS)) {
    const hookPath = join(hooksDir, hookName)
    const existing = await readFileSafe(hookPath)
    const isManaged = existing?.includes(HEADER_TAG)
    const hasExisting = existing && !isManaged

    let finalContent
    if (!existing) {
      // Clean install
      finalContent = content
      logger.info(`Installing ${hookName} hook…`)
    } else if (isManaged) {
      // Already managed — overwrite just the managed block
      finalContent = content
      logger.info(`Updating ${hookName} hook (already managed)…`)
    } else {
      // Pre-existing non-managed hook — append our block
      finalContent = `${existing.trimEnd()}\n\n${content}`
      logger.warn(
        `${hookName} already exists. Appending SpecFuse block (existing content preserved).`,
      )
    }

    await writeFileAtomic(hookPath, finalContent + '\n')
    await chmod(hookPath, 0o755)
    logger.success(`${hookName} hook installed → ${hookPath}`)
  }

  // Update registry
  const { Registry } = await import('../core/registry.js')
  const registry = new Registry(projectRoot)
  await registry.load()
  registry.setHooksInstalled(true)
  await registry.save()

  logger.br()
  logger.success('Git hooks installed successfully.')
  logger.info(`${chalk.bold('pre-commit')}:  blocks commits when spec drift is detected`)
  logger.info(`${chalk.bold('post-commit')}: runs specfuse sync after every commit`)
  logger.br()
  logger.info(`To remove: ${chalk.cyan('specfuse uninstall-hooks')}`)
  logger.br()
}

/**
 * Remove SpecFuse-managed blocks from git hooks.
 * Restores any pre-existing hook content.
 *
 * @param {string} projectRoot
 */
export async function uninstallHooksCommand(projectRoot) {
  logger.header('SpecFuse Uninstall Hooks')
  logger.br()

  const hooksDir = join(projectRoot, '.git', 'hooks')

  for (const hookName of Object.keys(HOOKS)) {
    const hookPath = join(hooksDir, hookName)
    const existing = await readFileSafe(hookPath)

    if (!existing) {
      logger.row(hookName, 'not found — skipping', chalk.dim)
      continue
    }

    if (!existing.includes(HEADER_TAG)) {
      logger.row(hookName, 'not managed by SpecFuse — skipping', chalk.dim)
      continue
    }

    // Strip the specfuse-managed block.
    // Block starts at the line containing HEADER_TAG and runs to end of file
    // if SpecFuse wrote the whole file, or to the blank line before if appended.
    const lines = existing.split('\n')
    const managedStart = lines.findIndex((l) => l.includes(HEADER_TAG))
    const preserved = lines.slice(0, managedStart).join('\n').trimEnd()

    if (!preserved || preserved === '#!/bin/sh') {
      // Only specfuse content — remove the file entirely
      const { unlink } = await import('fs/promises')
      await unlink(hookPath).catch(() => {})
      logger.success(`${hookName} hook removed.`)
    } else {
      // Restore the original content
      await writeFileAtomic(hookPath, preserved + '\n')
      await chmod(hookPath, 0o755)
      logger.success(`${hookName}: SpecFuse block removed, original content restored.`)
    }
  }

  // Update registry
  const { Registry } = await import('../core/registry.js')
  const registry = new Registry(projectRoot)
  await registry.load()
  registry.setHooksInstalled(false)
  await registry.save()

  logger.br()
  logger.success('Git hooks uninstalled.')
  logger.br()
}
