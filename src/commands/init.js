import { join }     from 'path';
import { pathExists, writeFileAtomic, ensureDir } from '../utils/fs.js';
import { Registry } from '../core/registry.js';
import { detectPhase, describePhase } from '../core/phase-detector.js';
import { logger }   from '../utils/logger.js';
import chalk from 'chalk';
import { basename } from 'path';

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
];

/**
 * @param {string} projectRoot
 * @param {{ force?: boolean, name?: string }} [options]
 */
export async function initCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Init  v4');
  logger.br();

  const registry = new Registry(projectRoot);
  await registry.load();

  const projectName = options.name ?? basename(projectRoot);
  const { phase, evidence } = await detectPhase(projectRoot);

  logger.phase(`Detected phase: ${chalk.bold(phase)}`);
  logger.info(describePhase(phase));
  logger.br();

  if (registry.data.initializedAt && registry.data.phase !== 'unknown' && !options.force) {
    logger.warn('SpecFuse already initialized. Use --force to re-initialize.');
    logger.br();
    return;
  }

  registry.setPhase(phase);
  registry.setProjectName(projectName);

  // Create .specfuse/ scaffold
  await ensureDir(join(projectRoot, '.specfuse', 'plan', 'stories'));
  await ensureDir(join(projectRoot, '.specfuse', 'plan', 'design', 'flows'));
  await ensureDir(join(projectRoot, '.specfuse', 'plan', 'design', 'screens'));
  await ensureDir(join(projectRoot, '.specfuse', 'changes', 'archive'));

  // Plugin rules template
  const rulesPath = join(projectRoot, '.specfuse', 'rules.mjs');
  if (!pathExists(rulesPath)) {
    await writeFileAtomic(rulesPath, USER_RULES_LINES.join('\n') + '\n');
    logger.success('Created .specfuse/rules.mjs (plugin rules template)');
  }

  // .gitignore hint for registry
  const gitignorePath = join(projectRoot, '.specfuse', '.gitignore');
  if (!pathExists(gitignorePath)) {
    await writeFileAtomic(gitignorePath,
      '# Commit registry.json to share sync state with your team\n');
  }

  await registry.save();

  logger.br();
  logger.header('Initialization Complete');
  logger.success(`Project: ${chalk.bold(projectName)}`);
  logger.success('Directory structure:');
  console.log(chalk.dim([
    '  .specfuse/',
    '  ├── constitution.md   ← single source of truth',
    '  ├── plan/             ← planning artifacts (PRD, architecture, design, stories)',
    '  │   ├── design/       ← design system, flows, and screen specs',
    '  ├── changes/          ← active change proposals',
    '  │   └── archive/      ← completed changes',
    '  ├── registry.json     ← SpecFuse state',
    '  └── rules.mjs         ← custom sync rules',
  ].join('\n')));

  logger.br();
  logger.header('Getting Started');
  if (phase === 'planning' || phase === 'unknown') {
    logger.info(`1. ${chalk.cyan('specfuse plan prd')}         Create your PRD`);
    logger.info(`2. ${chalk.cyan('specfuse plan arch')}        Create your architecture doc`);
    logger.info(`3. ${chalk.cyan('specfuse plan design system')} Create your design system constraints`);
    logger.info(`4. ${chalk.cyan('specfuse specify init')}     Generate constitution.md from plan`);
    logger.info(`5. ${chalk.cyan('specfuse sync')}             Sync all artifacts`);
  } else if (phase === 'feature-dev') {
    logger.info(`1. ${chalk.cyan('specfuse change new <n>')} Start a change proposal`);
    logger.info(`2. ${chalk.cyan('specfuse sync')}              Inject constitutional constraints`);
    logger.info(`3. ${chalk.cyan('specfuse watch')}             Live auto-sync during development`);
  } else {
    logger.info(`1. ${chalk.cyan('specfuse change archive <n>')}   Archive completed changes`);
    logger.info(`2. ${chalk.cyan('specfuse sync')}                  Update implemented-features`);
  }
  logger.br();
}
