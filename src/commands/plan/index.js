import { join, basename, dirname } from 'path';
import { fileURLToPath }           from 'url';
import { readdir }                 from 'fs/promises';
import { readFileSafe, writeFileAtomic, ensureDir, pathExists, getModifiedTime } from '../../utils/fs.js';
import { logger }                  from '../../utils/logger.js';
import chalk from 'chalk';

const __dir   = dirname(fileURLToPath(import.meta.url));
const PLAN_DIR = (root) => join(root, '.specfuse', 'plan');

function fillTemplate(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template);
}

async function readTemplate(name) {
  const tplPath = join(__dir, '..', '..', '..', 'templates', 'plan', name);
  return readFileSafe(tplPath);
}

// ── specfuse plan prd ─────────────────────────────────────────────────────────

/**
 * Create or open the PRD document.
 * @param {string} projectRoot
 * @param {{ name?: string, ai?: boolean }} [options]
 */
export async function planPrd(projectRoot, options = {}) {
  const planDir = PLAN_DIR(projectRoot);
  await ensureDir(planDir);

  const prdPath = join(planDir, 'prd.md');
  const exists  = pathExists(prdPath);

  if (exists) {
    logger.info(`PRD already exists at ${chalk.cyan('.specfuse/plan/prd.md')}`);
    const content = await readFileSafe(prdPath);
    const lines   = content.split('\n');
    logger.br();
    logger.header('Current PRD');
    // Show first 20 lines
    lines.slice(0, 20).forEach(l => console.log('  ' + l));
    if (lines.length > 20) logger.info(chalk.dim(`  … (${lines.length - 20} more lines)`));
    logger.br();
    logger.info(`Edit: ${chalk.cyan('.specfuse/plan/prd.md')}`);
    logger.info(`After editing: ${chalk.cyan('specfuse sync')} to propagate to constitution.md`);
    return;
  }

  const projectName = options.name ?? basename(projectRoot);
  const template    = await readTemplate('prd.md');
  const content     = fillTemplate(template, {
    date: new Date().toISOString().slice(0, 10),
    name: projectName,
  });

  await writeFileAtomic(prdPath, content);

  logger.br();
  logger.success('Created .specfuse/plan/prd.md');
  logger.br();
  logger.header('Next Steps');
  logger.info(`1. Edit ${chalk.cyan('.specfuse/plan/prd.md')} — fill in your project requirements`);
  logger.info(`2. Run ${chalk.cyan('specfuse plan arch')} to create the architecture document`);
  logger.info(`3. Run ${chalk.cyan('specfuse sync')} to propagate decisions to .specfuse/constitution.md`);
  logger.br();
}

// ── specfuse plan arch ────────────────────────────────────────────────────────

/**
 * Create or open the architecture document.
 * @param {string} projectRoot
 * @param {{ ai?: boolean }} [options]
 */
export async function planArch(projectRoot, options = {}) {
  const planDir  = PLAN_DIR(projectRoot);
  await ensureDir(planDir);

  const archPath = join(planDir, 'architecture.md');
  const exists   = pathExists(archPath);

  if (exists) {
    logger.info(`Architecture doc already exists at ${chalk.cyan('.specfuse/plan/architecture.md')}`);
    const content = await readFileSafe(archPath);
    const lines   = content.split('\n');
    logger.br();
    logger.header('Current Architecture');
    lines.slice(0, 20).forEach(l => console.log('  ' + l));
    if (lines.length > 20) logger.info(chalk.dim(`  … (${lines.length - 20} more lines)`));
    logger.br();
    logger.info(`Edit: ${chalk.cyan('.specfuse/plan/architecture.md')}`);
    logger.info(`After editing: ${chalk.cyan('specfuse sync')} to propagate to constitution.md`);
    return;
  }

  const template = await readTemplate('architecture.md');
  const content  = fillTemplate(template, {
    date: new Date().toISOString().slice(0, 10),
  });

  await writeFileAtomic(archPath, content);

  logger.br();
  logger.success('Created .specfuse/plan/architecture.md');
  logger.br();
  logger.header('Next Steps');
  logger.info(`1. Edit ${chalk.cyan('.specfuse/plan/architecture.md')} — document your decisions`);
  logger.info(`2. Run ${chalk.cyan('specfuse sync')} to populate .specfuse/constitution.md [plan-decisions]`);
  logger.br();
}

// ── specfuse plan story ───────────────────────────────────────────────────────

/**
 * Add a new user story.
 * @param {string} projectRoot
 * @param {string} [title]   Story title (kebab-case for filename)
 */
export async function planStory(projectRoot, title) {
  const storiesDir = join(PLAN_DIR(projectRoot), 'stories');
  await ensureDir(storiesDir);

  // Generate next story ID from existing files
  let existing = [];
  try {
    const entries = await readdir(storiesDir);
    existing = entries.filter(e => e.endsWith('.md'));
  } catch { /* empty */ }

  const nextNum  = String(existing.length + 1).padStart(3, '0');
  const slug     = title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : 'new-story';
  const filename = `story-${nextNum}-${slug}.md`;
  const storyPath = join(storiesDir, filename);

  const displayTitle = title ?? 'New Story';
  const template = await readTemplate('story.md');
  const content  = fillTemplate(template, {
    title: displayTitle,
    id:    `STORY-${nextNum}`,
    date:  new Date().toISOString().slice(0, 10),
    role:  'user',
    capability: 'do something',
    benefit:    'achieve an outcome',
  });

  await writeFileAtomic(storyPath, content);

  logger.br();
  logger.success(`Created ${chalk.cyan(`.specfuse/plan/stories/${filename}`)}`);
  logger.br();
  logger.info(`Edit the story: fill in role, capability, benefit, and acceptance criteria.`);
  logger.info(`Run ${chalk.cyan('specfuse sync')} to propagate stories to .specfuse/constitution.md [user-stories]`);
  logger.br();
}

// ── specfuse plan list ────────────────────────────────────────────────────────

/**
 * List all planning artifacts with status.
 * @param {string} projectRoot
 */
export async function planList(projectRoot) {
  const planDir = PLAN_DIR(projectRoot);
  logger.header('Planning Artifacts');
  logger.br();

  // PRD
  const prdPath = join(planDir, 'prd.md');
  const prdExists = pathExists(prdPath);
  const prdTime   = prdExists ? await getModifiedTime(prdPath) : null;
  console.log(`  ${prdExists ? chalk.green('✔') : chalk.dim('○')}  ${chalk.bold('PRD')}  ${chalk.dim('.specfuse/plan/prd.md')}  ${chalk.dim(prdTime?.toISOString().slice(0,10) ?? 'not created')}`);
  if (!prdExists) console.log(`     ${chalk.dim('→ specfuse plan prd')}`);

  // Architecture
  const archPath   = join(planDir, 'architecture.md');
  const archExists = pathExists(archPath);
  const archTime   = archExists ? await getModifiedTime(archPath) : null;
  console.log(`  ${archExists ? chalk.green('✔') : chalk.dim('○')}  ${chalk.bold('Architecture')}  ${chalk.dim('.specfuse/plan/architecture.md')}  ${chalk.dim(archTime?.toISOString().slice(0,10) ?? 'not created')}`);
  if (!archExists) console.log(`     ${chalk.dim('→ specfuse plan arch')}`);

  // Stories
  const storiesDir = join(planDir, 'stories');
  logger.br();
  logger.header('User Stories');
  if (!pathExists(storiesDir)) {
    logger.info(chalk.dim('No stories yet. Run `specfuse plan story <title>` to add one.'));
  } else {
    const files = [];
    try {
      const entries = await readdir(storiesDir, { withFileTypes: true });
      files.push(...entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name));
    } catch { /* empty */ }
    if (!files.length) {
      logger.info(chalk.dim('No stories yet. Run `specfuse plan story <title>` to add one.'));
    } else {
      for (const file of files.sort()) {
        const content = await readFileSafe(join(storiesDir, file)) ?? '';
        const title   = content.match(/^#\s+Story:\s+(.+)$/m)?.[1]
                     ?? content.match(/^#\s+(.+)$/m)?.[1]
                     ?? file;
        const done    = (content.match(/- \[x\]/gi) ?? []).length;
        const total   = (content.match(/- \[[ x]\]/gi) ?? []).length;
        const bar     = total ? `${done}/${total} AC` : '';
        console.log(`  ${chalk.green('◦')}  ${chalk.bold(title)}  ${chalk.dim(file)}  ${chalk.dim(bar)}`);
      }
    }
  }
  logger.br();
}
