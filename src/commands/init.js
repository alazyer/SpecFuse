import { join } from 'path'
import { pathExists, writeFileAtomic, ensureDir } from '../utils/fs.js'
import { Registry } from '../core/registry.js'
import { detectPhase, describePhase } from '../core/phase-detector.js'
import { getPhaseAdvice } from '../core/workflow-advice.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { basename } from 'path'

const USER_RULES_LINES = [
  '/**',
  ' * SpecFuse User Plugin Rules.',
  ' * Each rule must conform to the SyncRule interface.',
  ' */',
  'export default [',
  '  // Example: add a custom sync rule here.',
  '  // {',
  '  //   id:      "custom→constitution:custom",',
  '  //   pass:    "A",',
  '  //   source:  ".specfuse/plan/custom.md",',
  '  //   sources: [".specfuse/plan/custom.md"],',
  '  //   target:  ".specfuse/constitution.md",',
  '  //   section: "custom",',
  '  //   async extract(ctx) {',
  '  //     const c = await ctx.read(".specfuse/plan/custom.md");',
  '  //     return c ? ctx.extractH2Section(c, "My Section") : null;',
  '  //   },',
  '  //   transform(d, ctx) { return "Updated " + ctx.today() + "\\n\\n" + d; },',
  '  // },',
  '];',
]

/**
 * @param {string} projectRoot
 * @param {{ force?: boolean, name?: string }} [options]
 */
export async function initCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Init  v4')
  logger.br()

  const registry = new Registry(projectRoot)
  await registry.load()

  const projectName = options.name ?? basename(projectRoot)
  const { phase, evidence } = await detectPhase(projectRoot)

  logger.phase(`Detected phase: ${chalk.bold(phase)}`)
  logger.info(describePhase(phase))
  logger.br()

  if (registry.data.initializedAt && registry.data.phase !== 'unknown' && !options.force) {
    logger.warn('SpecFuse already initialized. Use --force to re-initialize.')
    logger.br()
    return
  }

  registry.setPhase(phase)
  registry.setProjectName(projectName)

  // Create .specfuse/ scaffold
  await ensureDir(join(projectRoot, '.specfuse', 'plan', 'stories'))
  await ensureDir(join(projectRoot, '.specfuse', 'plan', 'design', 'flows'))
  await ensureDir(join(projectRoot, '.specfuse', 'plan', 'design', 'screens'))
  await ensureDir(join(projectRoot, '.specfuse', 'changes', 'archive'))

  // Plugin rules template
  const rulesPath = join(projectRoot, '.specfuse', 'rules.mjs')
  if (!pathExists(rulesPath)) {
    await writeFileAtomic(rulesPath, USER_RULES_LINES.join('\n') + '\n')
    logger.success('Created .specfuse/rules.mjs (plugin rules template)')
  }

  // .gitignore hint for registry
  const gitignorePath = join(projectRoot, '.specfuse', '.gitignore')
  if (!pathExists(gitignorePath)) {
    await writeFileAtomic(
      gitignorePath,
      '# Commit registry.json to share sync state with your team\n',
    )
  }

  await registry.save()

  logger.br()
  logger.header('Initialization Complete')
  logger.success(`Project: ${chalk.bold(projectName)}`)
  logger.success('Directory structure:')
  console.log(
    chalk.dim(
      [
        '  .specfuse/',
        '  ├── constitution.md   ← created by `specfuse specify init`',
        '  ├── plan/             ← planning artifacts (PRD, architecture, design, stories)',
        '  │   ├── design/       ← design system, flows, and screen specs',
        '  ├── changes/          ← active change proposals',
        '  │   └── archive/      ← completed changes',
        '  ├── registry.json     ← SpecFuse state',
        '  └── rules.mjs         ← custom sync rules',
      ].join('\n'),
    ),
  )

  logger.br()
  logger.header('Getting Started')
  const advicePhase = phase === 'unknown' ? 'planning' : phase
  const advice = getPhaseAdvice(advicePhase)
  advice.steps.forEach((step, index) => {
    logger.info(`${index + 1}. ${chalk.cyan(step.command)}  ${chalk.dim(step.reason)}`)
  })
  logger.br()
  logger.info(
    `Need a phase-aware walkthrough? Run ${chalk.cyan('specfuse guide --persona new-user')}`,
  )
  logger.br()
}
