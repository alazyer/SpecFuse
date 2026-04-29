import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdir }    from 'fs/promises';
import { readFileSafe, writeFileAtomic, ensureDir, pathExists, getModifiedTime } from '../../utils/fs.js';
import { readManagedSection } from '../../utils/markdown.js';
import { logger }    from '../../utils/logger.js';
import chalk from 'chalk';

const CHANGES_DIR = (root) => join(root, '.specfuse', 'changes');

/** Fill template placeholders. */
function fillTemplate(template, vars) {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template
  );
}

const __dir_change = dirname(fileURLToPath(import.meta.url));

async function readTemplate(name) {
  const tplPath = join(__dir_change, '..', '..', '..', 'templates', 'change', name);
  return readFileSafe(tplPath);
}

// ── specfuse change new ───────────────────────────────────────────────────────

/**
 * Create a new change proposal directory with proposal.md, design.md, tasks.md.
 * @param {string} projectRoot
 * @param {string} name   Change name (will be kebab-cased)
 */
export async function changeNew(projectRoot, name) {
  const slug       = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const changeDir  = join(CHANGES_DIR(projectRoot), slug);

  if (pathExists(changeDir)) {
    logger.error(`Change '${slug}' already exists at .specfuse/changes/${slug}/`);
    logger.info(`Run ${chalk.cyan(`specfuse change show ${slug}`)} to view it.`);
    process.exit(1);
  }

  await ensureDir(changeDir);

  const displayTitle = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const date         = new Date().toISOString().slice(0, 10);
  const vars         = { title: displayTitle, changeName: slug, date };

  const proposal = fillTemplate(await readTemplate('proposal.md') ?? '', vars);
  const design   = fillTemplate(await readTemplate('design.md')   ?? '', vars);
  const tasks    = fillTemplate(await readTemplate('tasks.md')    ?? '', vars);

  await writeFileAtomic(join(changeDir, 'proposal.md'), proposal);
  await writeFileAtomic(join(changeDir, 'design.md'),   design);
  await writeFileAtomic(join(changeDir, 'tasks.md'),    tasks);

  logger.br();
  logger.success(`Created change: ${chalk.bold(slug)}`);
  logger.br();
  logger.info('Files created:');
  logger.row('  proposal.md', 'What and why — fill in overview, scope, AC', chalk.cyan);
  logger.row('  design.md',   'How — data model, API design, sequences',     chalk.cyan);
  logger.row('  tasks.md',    'Implementation tasks and review checklist',    chalk.cyan);
  logger.br();
  logger.info(`Run ${chalk.cyan('specfuse sync')} to inject constitutional constraints into proposal.md`);
  logger.info(`When done: ${chalk.cyan(`specfuse change archive ${slug}`)}`);
  logger.br();
}

// ── specfuse change list ──────────────────────────────────────────────────────

/**
 * List active and archived changes.
 * @param {string} projectRoot
 */
export async function changeList(projectRoot) {
  const changesDir = CHANGES_DIR(projectRoot);
  logger.header('Changes');
  logger.br();

  // Active changes
  logger.header('Active');
  let activeEntries = [];
  try {
    const entries = await readdir(changesDir, { withFileTypes: true });
    activeEntries = entries.filter(e => e.isDirectory() && e.name !== 'archive');
  } catch { /* none */ }

  if (!activeEntries.length) {
    logger.info(chalk.dim('No active changes. Run `specfuse change new <n>` to start one.'));
  } else {
    for (const entry of activeEntries) {
      const proposalPath = join(changesDir, entry.name, 'proposal.md');
      const content      = await readFileSafe(proposalPath) ?? '';
      const title        = content.match(/^#\s+Change Proposal:\s+(.+)$/m)?.[1]
                        ?? content.match(/^#\s+(.+)$/m)?.[1]
                        ?? entry.name;
      const done   = (content.match(/- \[x\]/gi) ?? []).length;
      const total  = (content.match(/- \[[ x]\]/gi) ?? []).length;
      const mtime  = await getModifiedTime(proposalPath);
      const bar    = total ? chalk.dim(`${done}/${total} AC`) : '';
      console.log(`  ${chalk.green('◦')}  ${chalk.bold(title)}  ${chalk.dim(entry.name)}  ${bar}  ${chalk.dim(mtime?.toISOString().slice(0,10) ?? '')}`);
    }
  }

  // Archived changes
  const archiveDir = join(changesDir, 'archive');
  logger.br();
  logger.header('Archived');
  let archivedEntries = [];
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true });
    archivedEntries = entries.filter(e => e.isDirectory()).slice(-5); // last 5
  } catch { /* none */ }

  if (!archivedEntries.length) {
    logger.info(chalk.dim('No archived changes yet.'));
  } else {
    for (const entry of archivedEntries) {
      const proposalPath = join(archiveDir, entry.name, 'proposal.md');
      const content      = await readFileSafe(proposalPath) ?? '';
      const title        = content.match(/^#\s+Change Proposal:\s+(.+)$/m)?.[1]
                        ?? entry.name;
      console.log(`  ${chalk.dim('✔')}  ${chalk.dim(title)}  ${chalk.dim(entry.name)}`);
    }
    if (archivedEntries.length === 5) {
      logger.info(chalk.dim('  (showing last 5 — view .specfuse/changes/archive/ for all)'));
    }
  }
  logger.br();
}

// ── specfuse change show ──────────────────────────────────────────────────────

/**
 * Show details of a specific change.
 * @param {string} projectRoot
 * @param {string} name  Change name
 */
export async function changeShow(projectRoot, name) {
  const slug       = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const changeDir  = join(CHANGES_DIR(projectRoot), slug);
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive');

  // Find in active or archive
  let resolvedDir = changeDir;
  if (!pathExists(changeDir)) {
    // Search archive by name fragment
    let archiveMatch = null;
    try {
      const entries = await readdir(archiveDir, { withFileTypes: true });
      archiveMatch  = entries.find(e => e.isDirectory() && e.name.endsWith(slug));
    } catch { /* none */ }
    if (!archiveMatch) {
      logger.error(`Change '${slug}' not found in active or archived changes.`);
      logger.info(`Run ${chalk.cyan('specfuse change list')} to see all changes.`);
      process.exit(1);
    }
    resolvedDir = join(archiveDir, archiveMatch.name);
    logger.info(chalk.dim(`(archived: ${archiveMatch.name})`));
  }

  const proposalPath = join(resolvedDir, 'proposal.md');
  const content      = await readFileSafe(proposalPath);
  if (!content) {
    logger.error('proposal.md not found in this change directory.');
    process.exit(1);
  }

  // Strip managed section for display
  const userContent  = content
    .replace(/<!-- specfuse:constitution-header:start -->[\s\S]*?<!-- specfuse:constitution-header:end -->/g, '')
    .replace(/---\n\n## \[SpecFuse Managed\].*\n\n/, '')
    .trim();

  logger.header(`Change: ${slug}`);
  logger.br();
  console.log(userContent);
  logger.br();

  // Check constitutional header
  const header = readManagedSection(content, 'constitution-header');
  if (header) {
    logger.info(chalk.dim('Constitutional constraints are injected. ✓'));
  } else {
    logger.warn('No constitutional header. Run `specfuse sync` to inject constraints.');
  }

  // Show files
  const files = ['proposal.md', 'design.md', 'tasks.md'];
  logger.br();
  for (const file of files) {
    const filePath = join(resolvedDir, file);
    const exists   = pathExists(filePath);
    logger.row(`  ${exists ? chalk.green('✔') : chalk.dim('○')}  ${file}`, '', exists ? chalk.white : chalk.dim);
  }
  logger.br();
}

// ── specfuse change archive ───────────────────────────────────────────────────

/**
 * Archive a completed change: move to .specfuse/changes/archive/YYYY-MM-DD-<name>/.
 * @param {string} projectRoot
 * @param {string} name  Change name
 */
export async function changeArchive(projectRoot, name) {
  const slug      = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const changeDir = join(CHANGES_DIR(projectRoot), slug);

  if (!pathExists(changeDir)) {
    logger.error(`Active change '${slug}' not found.`);
    logger.info(`Run ${chalk.cyan('specfuse change list')} to see active changes.`);
    process.exit(1);
  }

  const date       = new Date().toISOString().slice(0, 10);
  const archiveDir = join(CHANGES_DIR(projectRoot), 'archive');
  const destDir    = join(archiveDir, `${date}-${slug}`);

  await ensureDir(archiveDir);

  // Copy all files to archive (preserve originals until verified)
  const { cp, rm } = await import('fs/promises');
  await cp(changeDir, destDir, { recursive: true });

  logger.br();
  logger.success(`Archived: ${chalk.bold(slug)} → ${chalk.dim(`${date}-${slug}`)}`);

  // Remove from active changes
  await rm(changeDir, { recursive: true, force: true });
  logger.success('Removed from active changes');

  logger.br();
  logger.info(`Run ${chalk.cyan('specfuse sync')} to update .specfuse/constitution.md [implemented-features]`);
  logger.br();
}
