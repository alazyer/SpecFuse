import { Registry }        from '../core/registry.js';
import { loadRules }       from '../core/rule-loader.js';
import { runTwoPassSync }  from '../core/sync-engine.js';
import { logger }          from '../utils/logger.js';
import chalk from 'chalk';

/**
 * @param {string} projectRoot
 * @param {{ rules?: string[], allowPlugins?: boolean }} [options]
 */
export async function syncCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Sync  v2');
  logger.br();

  const registry = new Registry(projectRoot);
  await registry.load();

  const allRules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins });

  let rules;
  if (options.rules?.length && !options.rules.includes('all')) {
    rules = allRules.filter(r => options.rules.includes(r.id));
    if (rules.length === 0) {
      logger.error(`No rules matched: ${options.rules.map(r => chalk.bold(r)).join(', ')}`);
      logger.br();
      logger.info('Available rule IDs:');
      for (const r of allRules) {
        logger.row(`  [Pass ${r.pass}]`, r.id, chalk.cyan);
      }
      logger.br();
      process.exit(1);
    }
    const unmatched = options.rules.filter(id => !allRules.some(r => r.id === id));
    if (unmatched.length) {
      logger.warn(`Unknown rule ID(s): ${unmatched.map(u => chalk.bold(u)).join(', ')} — skipping.`);
      logger.br();
    }
  } else {
    rules = allRules;
  }

  registry.setLoadedRules(rules);

  const start = Date.now();
  const { passA, passB } = await runTwoPassSync(projectRoot, registry, rules);

  // ── Pass A results ──────────────────────────────────────────────────────
  logger.br();
  logger.header('Pass A — Inbound (→ constitution)');
  printResults(passA);

  // ── Pass B results ──────────────────────────────────────────────────────
  if (passB.length) {
    logger.header('Pass B — Outbound (constitution →)');
    printResults(passB);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const all     = [...passA, ...passB];
  const changed = all.filter(r => r.changed).length;
  const skipped = all.length - changed;
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  logger.header('Summary');
  logger.success(`${changed} rule(s) synced, ${skipped} skipped — ${elapsed}s`);

  if (changed > 0) {
    logger.br();
    logger.info(`Run ${chalk.cyan('specfuse drift')} to verify all pairs are IN_SYNC.`);
    logger.info(`Run ${chalk.cyan('specfuse diff')}  to preview next-cycle changes.`);
  }
  logger.br();
}

function printResults(results) {
  for (const r of results) {
    if (r.changed) {
      logger.success(r.ruleId);
      console.log(`              ${chalk.dim(r.message)}`);
    } else {
      console.log(`  ${chalk.dim('–')}  ${chalk.dim(r.ruleId)}`);
      console.log(`              ${chalk.dim(r.message)}`);
    }
  }
  logger.br();
}
