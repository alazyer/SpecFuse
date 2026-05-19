import { join }      from 'path';
import { readFileSafe, pathExists } from '../utils/fs.js';
import { Registry }  from '../core/registry.js';
import { loadRules } from '../core/rule-loader.js';
import { logger }    from '../utils/logger.js';
import chalk from 'chalk';
import { readdir }   from 'fs/promises';
import { detectUiImpact, parseFrontmatterDocument } from '../utils/change-artifacts.js';

const PASS = (id, msg)      => ({ id, state: 'PASS', message: msg });
const WARN = (id, msg, fix) => ({ id, state: 'WARN', message: msg, remediation: fix });
const FAIL = (id, msg, fix) => ({ id, state: 'FAIL', message: msg, remediation: fix });

async function checkRegistrySchema(root) {
  const path = join(root, '.specfuse', 'registry.json');
  if (!pathExists(path)) return FAIL('registry-schema', 'registry.json not found.', 'Run `specfuse init`.');
  try {
    const data = JSON.parse(await readFileSafe(path));
    if (!data.version) return FAIL('registry-schema', 'registry.json has no version field.', 'Run `specfuse init --force`.');
    if (data.version === '4.0.0') return PASS('registry-schema', `registry.json is valid (v4.0.0).`);
    return WARN('registry-schema', `registry.json is v${data.version} — will migrate on next sync.`, 'Run `specfuse sync`.');
  } catch { return FAIL('registry-schema', 'registry.json is corrupt.', 'Run `specfuse init --force`.'); }
}

async function checkConstitution(root) {
  const path = join(root, '.specfuse', 'constitution.md');
  if (!pathExists(path)) return WARN('constitution', 'constitution.md not found.',
    'Run `specfuse specify init` to create it from your plan artifacts.');
  const content = await readFileSafe(path);
  const starts  = (content.match(/<!-- specfuse:[^:]+:start -->/g) ?? []).length;
  const ends    = (content.match(/<!-- specfuse:[^:]+:end -->/g)   ?? []).length;
  if (starts !== ends) return FAIL('constitution',
    `Unclosed managed section markers (${starts} start, ${ends} end).`,
    'Inspect constitution.md for missing <!-- specfuse:*:end --> markers.');
  return PASS('constitution', `constitution.md found with ${starts} managed section(s).`);
}

async function checkPlanArtifacts(root) {
  const planDir = join(root, '.specfuse', 'plan');
  if (!pathExists(planDir)) return WARN('plan-artifacts',
    '.specfuse/plan/ not found.',
    'Run `specfuse plan prd` and `specfuse plan arch` to start planning.');
  const hasPrd  = pathExists(join(planDir, 'prd.md'));
  const hasArch = pathExists(join(planDir, 'architecture.md'));
  if (!hasPrd && !hasArch) return WARN('plan-artifacts',
    '.specfuse/plan/ exists but has no prd.md or architecture.md.',
    'Run `specfuse plan prd` and `specfuse plan arch`.');
  const missing = [!hasPrd && 'prd.md', !hasArch && 'architecture.md'].filter(Boolean);
  if (missing.length) return WARN('plan-artifacts',
    `Plan missing: ${missing.join(', ')}.`,
    `Run: ${missing.map(m => `specfuse plan ${m === 'prd.md' ? 'prd' : 'arch'}`).join(' and ')}`);
  return PASS('plan-artifacts', 'prd.md and architecture.md found in .specfuse/plan/.');
}

async function checkChangesStructure(root) {
  const changesDir = join(root, '.specfuse', 'changes');
  if (!pathExists(changesDir)) return PASS('changes-structure',
    '.specfuse/changes/ not created yet — no changes in flight.');

  let flatFiles = [], changeDirs = [];
  try {
    const entries = await readdir(changesDir, { withFileTypes: true });
    flatFiles   = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
    changeDirs  = entries.filter(e => e.isDirectory() && e.name !== 'archive');
  } catch { /* empty */ }

  if (flatFiles.length > 0 && changeDirs.length === 0) return WARN('changes-structure',
    `Found ${flatFiles.length} flat .md file(s) in .specfuse/changes/ — expected directories.`,
    'Run `specfuse change new <n>` to create properly structured change proposals.');
  if (changeDirs.length > 0) return PASS('changes-structure',
    `${changeDirs.length} active change director(ies) found — correct structure.`);
  return PASS('changes-structure', '.specfuse/changes/ exists and is ready.');
}

async function checkNestedSections(root) {
  const content = await readFileSafe(join(root, '.specfuse', 'constitution.md'));
  if (!content) return PASS('nested-sections', 'constitution.md not present — skipping.');
  let depth = 0, nested = false;
  for (const line of content.split('\n')) {
    if (/<!-- specfuse:[^:]+:start -->/.test(line)) depth++;
    if (/<!-- specfuse:[^:]+:end -->/.test(line))   depth--;
    if (depth > 1) { nested = true; break; }
  }
  return nested
    ? FAIL('nested-sections', 'Nested managed sections detected.',
        'Remove inner <!-- specfuse:*:start/end --> markers.')
    : PASS('nested-sections', 'No nested managed sections found.');
}

async function checkOrphanedSyncs(root) {
  const reg   = new Registry(root); await reg.load();
  const rules = await loadRules(root).catch(() => []);
  const ids   = rules.flatMap(r => [r.source, r.target, r.id]);
  const syncs = reg.data?.syncs ?? {};
  const orphans = Object.keys(syncs).filter(k => !ids.some(id => k.includes(id)));
  return orphans.length
    ? WARN('orphaned-syncs', `${orphans.length} stale sync record(s) in registry.`,
        'Run `specfuse sync` — registry is rebuilt on each sync.')
    : PASS('orphaned-syncs', 'No orphaned sync records.');
}

async function checkPluginSyntax(root) {
  const path = join(root, '.specfuse', 'rules.mjs');
  if (!pathExists(path)) return PASS('plugin-syntax', 'No .specfuse/rules.mjs present.');
  try {
    await import(`file://${path}?t=${Date.now()}`);
    return PASS('plugin-syntax', '.specfuse/rules.mjs is valid.');
  } catch (err) {
    return FAIL('plugin-syntax', `.specfuse/rules.mjs error: ${err.message}`,
      'Fix the syntax in .specfuse/rules.mjs.');
  }
}

async function checkDesignSystem(root) {
  const changesDir = join(root, '.specfuse', 'changes');
  const designSystemPath = join(root, '.specfuse', 'plan', 'design', 'system.md');
  let uiAffecting = false;

  try {
    const entries = await readdir(changesDir, { withFileTypes: true });
    const changeDirs = entries.filter(entry => entry.isDirectory() && entry.name !== 'archive');
    for (const entry of changeDirs) {
      const designContent = await readFileSafe(join(changesDir, entry.name, 'design.md')) ?? '';
      const impact = detectUiImpact(designContent);
      if (impact === 'yes' || impact === 'partial') {
        uiAffecting = true;
        break;
      }
    }
  } catch { /* empty */ }

  if (!uiAffecting) return PASS('design-system', 'No UI-affecting active changes detected.');
  if (pathExists(designSystemPath)) return PASS('design-system', 'Design system constraints document found.');
  return WARN('design-system',
    'UI-affecting changes exist, but .specfuse/plan/design/system.md has not been created.',
    'Run `specfuse plan design system` to define design constraints before building more UI.');
}

async function checkUnverifiedChanges(root) {
  const archiveDir = join(root, '.specfuse', 'changes', 'archive');
  let archivedDirs = [];
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true });
    archivedDirs = entries.filter(entry => entry.isDirectory());
  } catch { /* empty */ }

  if (!archivedDirs.length) return PASS('unverified-changes', 'No archived changes found.');

  const unverified = [];
  for (const entry of archivedDirs) {
    const verifyContent = await readFileSafe(join(archiveDir, entry.name, 'verify.md')) ?? '';
    const verifyData = parseFrontmatterDocument(verifyContent).data ?? {};
    const status = String(verifyData.status ?? 'unverified').trim().toLowerCase();
    if (status !== 'pass') unverified.push(entry.name);
  }

  return unverified.length
    ? WARN('unverified-changes',
        `${unverified.length} archived change(s) were force-archived without verification: ${unverified.join(', ')}.`,
        'Review the archived verify.md files and confirm whether those changes were actually delivered.')
    : PASS('unverified-changes', 'All archived changes are verified.');
}

/**
 * @param {string} projectRoot
 * @param {{ json?: boolean }} [options]
 */
export async function doctorCommand(projectRoot, options = {}) {
  const results = await Promise.all([
    checkRegistrySchema(projectRoot),
    checkConstitution(projectRoot),
    checkPlanArtifacts(projectRoot),
    checkChangesStructure(projectRoot),
    checkNestedSections(projectRoot),
    checkOrphanedSyncs(projectRoot),
    checkPluginSyntax(projectRoot),
    checkDesignSystem(projectRoot),
    checkUnverifiedChanges(projectRoot),
  ]);

  if (options.json) {
    const hasFail = results.some(r => r.state === 'FAIL');
    console.log(JSON.stringify({ healthy: !hasFail, checks: results }, null, 2));
    if (hasFail) process.exit(1);
    return;
  }

  logger.header('SpecFuse Doctor  v4');
  logger.br();

  for (const r of results) {
    const icon  = r.state === 'PASS' ? chalk.green('✔') : r.state === 'WARN' ? chalk.yellow('⚠') : chalk.red('✗');
    const color = r.state === 'PASS' ? chalk.white : r.state === 'WARN' ? chalk.yellow : chalk.red;
    console.log(`  ${icon}  ${chalk.dim(r.id.padEnd(22))} ${color(r.message)}`);
    if (r.remediation) console.log(`              ${chalk.dim('→')} ${chalk.italic(r.remediation)}`);
  }

  logger.br();
  const passes = results.filter(r => r.state === 'PASS').length;
  const warns  = results.filter(r => r.state === 'WARN').length;
  const fails  = results.filter(r => r.state === 'FAIL').length;
  logger.header('Summary');
  logger.row('Passed',   String(passes), chalk.green);
  if (warns) logger.row('Warnings', String(warns),  chalk.yellow);
  if (fails) logger.row('Failed',   String(fails),  chalk.red);
  logger.br();
  if (fails)      { logger.error(`${fails} check(s) failed.`); process.exit(1); }
  else if (warns)   logger.warn(`${warns} warning(s). SpecFuse will work but some setup is incomplete.`);
  else              logger.success('All checks passed. SpecFuse is healthy. ✓');
  logger.br();
}
