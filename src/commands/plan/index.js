import { join, basename, dirname } from 'path';
import { fileURLToPath }           from 'url';
import { readdir }                 from 'fs/promises';
import { readFileSafe, writeFileAtomic, ensureDir, pathExists, getModifiedTime } from '../../utils/fs.js';
import { logger }                  from '../../utils/logger.js';
import chalk from 'chalk';
import { slugifyName } from '../../utils/change-artifacts.js';

const __dir   = dirname(fileURLToPath(import.meta.url));
const PLAN_DIR = (root) => join(root, '.specfuse', 'plan');
const DESIGN_DIR = (root) => join(PLAN_DIR(root), 'design');

function fillTemplate(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template);
}

async function readTemplate(name) {
  const tplPath = join(__dir, '..', '..', '..', 'templates', 'plan', name);
  return readFileSafe(tplPath);
}

async function readDesignTemplate(name) {
  const tplPath = join(__dir, '..', '..', '..', 'templates', 'plan', 'design', name);
  return readFileSafe(tplPath);
}

async function createOrShowPlanDoc(filePath, displayPath, templateName, successLabel, nextStep) {
  const exists = pathExists(filePath);

  if (exists) {
    logger.info(`${successLabel} already exists at ${chalk.cyan(displayPath)}`);
    const content = await readFileSafe(filePath);
    const lines = content.split('\n');
    logger.br();
    logger.header(`Current ${successLabel}`);
    lines.slice(0, 20).forEach(l => console.log('  ' + l));
    if (lines.length > 20) logger.info(chalk.dim(`  … (${lines.length - 20} more lines)`));
    logger.br();
    logger.info(`Edit: ${chalk.cyan(displayPath)}`);
    logger.info(nextStep);
    return true;
  }

  return false;
}

async function nextNumberedFilename(dir, prefix, title, fallbackSlug) {
  let existing = [];
  try {
    const entries = await readdir(dir);
    existing = entries.filter(entry => entry.endsWith('.md'));
  } catch { /* empty */ }

  const nextNum = String(existing.length + 1).padStart(3, '0');
  const slug = title ? slugifyName(title) : fallbackSlug;
  return { nextNum, filename: `${prefix}-${nextNum}-${slug || fallbackSlug}.md` };
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

  // Design system
  const systemPath = join(planDir, 'design', 'system.md');
  const systemExists = pathExists(systemPath);
  const systemTime = systemExists ? await getModifiedTime(systemPath) : null;
  console.log(`  ${systemExists ? chalk.green('✔') : chalk.dim('○')}  ${chalk.bold('Design System')}  ${chalk.dim('.specfuse/plan/design/system.md')}  ${chalk.dim(systemTime?.toISOString().slice(0,10) ?? 'not created')}`);
  if (!systemExists) console.log(`     ${chalk.dim('→ specfuse plan design system')}`);

  // Stories
  const storiesDir = join(planDir, 'stories');
  logger.br();
  logger.header('Design References');

  for (const [label, subdir, commandHint] of [
    ['Flows', 'flows', 'specfuse plan design flow <title>'],
    ['Screens', 'screens', 'specfuse plan design screen <title>'],
  ]) {
    const dirPath = join(planDir, 'design', subdir);
    let count = 0;
    try {
      const entries = await readdir(dirPath);
      count = entries.filter(entry => entry.endsWith('.md')).length;
    } catch { /* empty */ }

    console.log(`  ${count > 0 ? chalk.green('✔') : chalk.dim('○')}  ${chalk.bold(label)}  ${chalk.dim(`.specfuse/plan/design/${subdir}/`)}  ${chalk.dim(`${count} file(s)`)}`);
    if (count === 0) console.log(`     ${chalk.dim(`→ ${commandHint}`)}`);
  }

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

// ── specfuse plan design system ──────────────────────────────────────────────

export async function planDesignSystem(projectRoot) {
  const designDir = DESIGN_DIR(projectRoot);
  await ensureDir(designDir);

  const systemPath = join(designDir, 'system.md');
  const alreadyExists = await createOrShowPlanDoc(
    systemPath,
    '.specfuse/plan/design/system.md',
    'system.md',
    'Design system doc',
    `After editing: ${chalk.cyan('specfuse sync')} to propagate to constitution.md [design-constraints]`
  );
  if (alreadyExists) return;

  const template = await readDesignTemplate('system.md');
  const content = fillTemplate(template, {
    date: new Date().toISOString().slice(0, 10),
  });

  await writeFileAtomic(systemPath, content);

  logger.br();
  logger.success('Created .specfuse/plan/design/system.md');
  logger.br();
  logger.info(`Edit ${chalk.cyan('.specfuse/plan/design/system.md')} — capture design tokens, accessibility rules, layout constraints, and component standards.`);
  logger.info(`Run ${chalk.cyan('specfuse sync')} to propagate design constraints into .specfuse/constitution.md`);
  logger.br();
}

// ── specfuse plan design flow ────────────────────────────────────────────────

export async function planDesignFlow(projectRoot, title) {
  const flowsDir = join(DESIGN_DIR(projectRoot), 'flows');
  await ensureDir(flowsDir);

  const { nextNum, filename } = await nextNumberedFilename(flowsDir, 'flow', title, 'new-flow');
  const filePath = join(flowsDir, filename);
  const template = await readDesignTemplate('flow.md');
  const content = fillTemplate(template, {
    date: new Date().toISOString().slice(0, 10),
    title: title ?? 'New Flow',
    id: `FLOW-${nextNum}`,
  });

  await writeFileAtomic(filePath, content);

  logger.br();
  logger.success(`Created ${chalk.cyan(`.specfuse/plan/design/flows/${filename}`)}`);
  logger.info('Design flows are reference-only and are not synced into the constitution.');
  logger.br();
}

// ── specfuse plan design screen ──────────────────────────────────────────────

export async function planDesignScreen(projectRoot, title) {
  const screensDir = join(DESIGN_DIR(projectRoot), 'screens');
  await ensureDir(screensDir);

  const { nextNum, filename } = await nextNumberedFilename(screensDir, 'screen', title, 'new-screen');
  const filePath = join(screensDir, filename);
  const template = await readDesignTemplate('screen.md');
  const content = fillTemplate(template, {
    date: new Date().toISOString().slice(0, 10),
    title: title ?? 'New Screen',
    id: `SCREEN-${nextNum}`,
  });

  await writeFileAtomic(filePath, content);

  logger.br();
  logger.success(`Created ${chalk.cyan(`.specfuse/plan/design/screens/${filename}`)}`);
  logger.info('Screen specs are reference-only and are not synced into the constitution.');
  logger.br();
}

// ── specfuse plan design list ────────────────────────────────────────────────

export async function planDesignList(projectRoot) {
  const designDir = DESIGN_DIR(projectRoot);
  logger.header('Design Artifacts');
  logger.br();

  const systemPath = join(designDir, 'system.md');
  const systemExists = pathExists(systemPath);
  const systemTime = systemExists ? await getModifiedTime(systemPath) : null;
  console.log(`  ${systemExists ? chalk.green('✔') : chalk.dim('○')}  ${chalk.bold('System')}  ${chalk.dim('.specfuse/plan/design/system.md')}  ${chalk.dim(systemTime?.toISOString().slice(0, 10) ?? 'not created')}`);
  if (!systemExists) console.log(`     ${chalk.dim('→ specfuse plan design system')}`);

  for (const [label, subdir] of [['Flows', 'flows'], ['Screens', 'screens']]) {
    logger.br();
    logger.header(label);
    const dirPath = join(designDir, subdir);
    let files = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name).sort();
    } catch { /* empty */ }

    if (!files.length) {
      logger.info(chalk.dim(`No ${label.toLowerCase()} yet.`));
      continue;
    }

    for (const file of files) {
      const content = await readFileSafe(join(dirPath, file)) ?? '';
      const title = content.match(/^#\s+[^:]+:\s+(.+)$/m)?.[1]
        ?? content.match(/^#\s+(.+)$/m)?.[1]
        ?? file;
      console.log(`  ${chalk.green('◦')}  ${chalk.bold(title)}  ${chalk.dim(file)}`);
    }
  }

  logger.br();
}
