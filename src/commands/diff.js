import { Registry }     from '../core/registry.js';
import { loadRules }    from '../core/rule-loader.js';
import { computeDiff }  from '../core/differ.js';
import { logger }       from '../utils/logger.js';
import chalk from 'chalk';

/**
 * Preview what specfuse sync would change — no files are written.
 *
 * @param {string} projectRoot
 * @param {{ json?: boolean, allowPlugins?: boolean }} [options]
 */
export async function diffCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot);
  await registry.load();

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins });
  const diffs = await computeDiff(projectRoot, rules);

  // ── JSON output ────────────────────────────────────────────────────────
  if (options.json) {
    const out = {
      hasChanges: diffs.some(d => d.hasChanges),
      changes: diffs.filter(d => d.hasChanges).map(d => ({
        file: d.file, section: d.section, ruleId: d.ruleId,
        added: d.added, removed: d.removed, diff: d.patch,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.hasChanges ? 1 : 0);
  }

  // ── Human output ───────────────────────────────────────────────────────
  logger.header('SpecFuse Diff  v2');
  logger.info('Previewing sync changes — no files will be written.');
  logger.br();

  const changed = diffs.filter(d => d.hasChanges);

  if (!changed.length) {
    logger.success('No changes. All managed sections are already current.');
    logger.br();
    process.exit(0);
  }

  for (const d of changed) {
    console.log(`  ${chalk.cyan('~')} ${chalk.bold(d.file)}  ${chalk.dim('[' + d.section + ']')}`);
    console.log(`    ${chalk.green('+' + d.added)} ${chalk.red('-' + d.removed)}`);
    logger.br();

    // Pretty-print the patch with colours
    for (const line of d.patch.split('\n')) {
      if (line.startsWith('+'))      console.log('    ' + chalk.green(line));
      else if (line.startsWith('-')) console.log('    ' + chalk.red(line));
      else if (line.startsWith('@')) console.log('    ' + chalk.cyan(line));
      else                           console.log('    ' + chalk.dim(line));
    }
    logger.br();
  }

  logger.header('Summary');
  logger.row('Files with changes', String(changed.length), chalk.yellow);
  logger.row('Total lines added',  String(changed.reduce((n, d) => n + d.added,   0)), chalk.green);
  logger.row('Total lines removed',String(changed.reduce((n, d) => n + d.removed, 0)), chalk.red);
  logger.br();
  logger.info(`Run ${chalk.cyan('specfuse sync')} to apply these changes.`);
  logger.br();

  process.exit(1); // exit 1 = changes exist (CI-friendly)
}
