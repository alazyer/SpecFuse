import { join }     from 'path';
import { pathExists, getModifiedTime } from '../utils/fs.js';
import { Registry } from '../core/registry.js';
import { loadRules } from '../core/rule-loader.js';
import { checkAllDrift } from '../core/drift-detector.js';
import { detectPhase, describePhase, recommendedAction } from '../core/phase-detector.js';
import { logger }   from '../utils/logger.js';
import chalk from 'chalk';
import { readdir }  from 'fs/promises';

const STATE_COLOR = {
  IN_SYNC: chalk.green, SOURCE_CHANGED: chalk.yellow, TARGET_CHANGED: chalk.yellow,
  BOTH_CHANGED: chalk.red, NEVER_SYNCED: chalk.magenta, SOURCE_MISSING: chalk.dim,
};
const STATE_ICON = {
  IN_SYNC: '✔', SOURCE_CHANGED: '⚠', TARGET_CHANGED: '⚠',
  BOTH_CHANGED: '✖', NEVER_SYNCED: '○', SOURCE_MISSING: '–',
};

/**
 * @param {string} projectRoot
 * @param {{ allowPlugins?: boolean }} [options]
 */
export async function statusCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Status  v3');

  const registry = new Registry(projectRoot);
  await registry.load();

  const { phase, evidence } = await detectPhase(projectRoot);
  const projectName = registry.getProjectName() || 'unnamed project';

  // ── Project ────────────────────────────────────────────────────────────
  logger.br();
  logger.header('Project');
  logger.row('Name',  projectName, chalk.bold);
  logger.row('Phase', phase, chalk.yellowBright);
  logger.info(chalk.dim(describePhase(phase)));

  // ── Artifact Health ────────────────────────────────────────────────────
  logger.br();
  logger.header('Plan Artifacts (.specfuse/plan/)');

  const planArtifacts = [
    { label: 'PRD',          path: '.specfuse/plan/prd.md' },
    { label: 'Architecture', path: '.specfuse/plan/architecture.md' },
  ];
  for (const { label, path } of planArtifacts) {
    const full   = join(projectRoot, path);
    const exists = pathExists(full);
    const mtime  = exists ? await getModifiedTime(full) : null;
    const time   = mtime ? mtime.toISOString().slice(0, 10) : '—';
    console.log(`  ${exists ? chalk.green('✔') : chalk.dim('○')}  ${(label).padEnd(16)}  ${chalk.dim(path)}  ${chalk.dim(time)}`);
  }

  // Stories count
  const storiesDir = join(projectRoot, '.specfuse', 'plan', 'stories');
  let storyCount = 0;
  try {
    const entries = await readdir(storiesDir);
    storyCount = entries.filter(e => e.endsWith('.md')).length;
  } catch { /* empty */ }
  console.log(`  ${storyCount > 0 ? chalk.green('✔') : chalk.dim('○')}  ${'Stories'.padEnd(16)}  ${chalk.dim('.specfuse/plan/stories/')}  ${chalk.dim(storyCount + ' file(s)')}`);

  // Constitution
  logger.br();
  logger.header('Constitution');
  const constPath   = join(projectRoot, '.specfuse', 'constitution.md');
  const constExists = pathExists(constPath);
  const constMtime  = constExists ? await getModifiedTime(constPath) : null;
  const constTime   = constMtime ? constMtime.toISOString().slice(0, 10) : '—';
  console.log(`  ${constExists ? chalk.green('✔') : chalk.dim('○')}  ${'.specfuse/constitution.md'.padEnd(16)}  ${chalk.dim(constTime)}`);
  if (!constExists) logger.info(chalk.dim(`  → specfuse specify init`));

  // Changes
  logger.br();
  logger.header('Changes (.specfuse/changes/)');
  let activeCount = 0, archiveCount = 0;
  try {
    const changesDir = join(projectRoot, '.specfuse', 'changes');
    const entries    = await readdir(changesDir, { withFileTypes: true });
    activeCount  = entries.filter(e => e.isDirectory() && e.name !== 'archive').length;
    const archiveDir = join(changesDir, 'archive');
    try {
      const ae = await readdir(archiveDir, { withFileTypes: true });
      archiveCount = ae.filter(e => e.isDirectory()).length;
    } catch { /* none */ }
  } catch { /* none */ }
  logger.row('Active',   String(activeCount),  activeCount  > 0 ? chalk.cyan  : chalk.dim);
  logger.row('Archived', String(archiveCount), archiveCount > 0 ? chalk.green : chalk.dim);

  // ── Sync Rules ────────────────────────────────────────────────────────
  logger.br();
  logger.header('Loaded Sync Rules');
  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins });
  for (const r of rules) {
    const altNote = (r.sources?.length ?? 1) > 1 ? chalk.dim(` +${r.sources.length-1}`) : '';
    console.log(`  ${chalk.cyan('◦')}  ${chalk.dim(`[Pass ${r.pass}]`)} ${r.id}${altNote}`);
  }

  // ── Git Hooks ──────────────────────────────────────────────────────────
  logger.br();
  logger.header('Git Hooks');
  if (registry.getHooksInstalled()) {
    logger.success('pre-commit + post-commit hooks installed');
  } else {
    logger.row('–', 'Not installed', chalk.dim);
    logger.info(chalk.dim('specfuse install-hooks'));
  }

  // ── Drift ──────────────────────────────────────────────────────────────
  logger.br();
  logger.header('Sync & Drift');
  const drifts = await checkAllDrift(projectRoot, registry, rules);
  let driftCount = 0;

  for (const r of drifts) {
    const sc = STATE_COLOR[r.state] ?? chalk.white;
    const si = STATE_ICON[r.state]  ?? '?';
    console.log(`  ${sc(si)}  ${chalk.dim(r.ruleId)}`);
    console.log(`     ${sc(`[${r.state}]`)} ${r.message}`);
    if (r.remediation) { console.log(`     ${chalk.dim('→')} ${chalk.italic(r.remediation)}`); driftCount++; }
    logger.br();
  }

  logger.header('Summary');
  if (driftCount === 0) logger.success('All synced pairs are current.');
  else {
    logger.warn(`${driftCount} pair(s) need attention.`);
    logger.info(`Run ${chalk.cyan('specfuse sync')} to resolve.`);
  }
  logger.br();
  logger.info(chalk.cyan(recommendedAction(phase)));
  logger.br();
}
