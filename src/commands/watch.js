import { join } from 'path';
import { Registry }       from '../core/registry.js';
import { loadRules }      from '../core/rule-loader.js';
import { runTwoPassSync } from '../core/sync-engine.js';
import { logger }         from '../utils/logger.js';
import chalk from 'chalk';

// chokidar is imported lazily inside watchCommand so it doesn't add ~120ms
// to the startup time of sync, drift, diff, doctor, and status commands.

/**
 * Route a changed file path to the rules it should trigger.
 * Uses rule.sources[] (all declared watch paths) if present, falls back to rule.source.
 * Supports both exact file matches and directory prefix matches.
 *
 * @param {string} filePath     - Absolute path of changed file
 * @param {string} projectRoot
 * @param {import('../core/rule-loader.js').SyncRule[]} rules
 * @returns {import('../core/rule-loader.js').SyncRule[]}
 */
function routeToRules(filePath, projectRoot, rules) {
  const rel = filePath
    .replace(projectRoot, '')
    .replace(/^[/\\]/, '')
    .replace(/\\/g, '/');

  return rules.filter(rule => {
    // Use sources[] if declared; otherwise fall back to [source]
    const watchPaths = rule.sources ?? [rule.source];
    return watchPaths.some(src => rel === src || rel.startsWith(src + '/'));
  });
}

/**
 * Collect every unique absolute path that should be watched, derived from all rules' sources[].
 *
 * @param {string} projectRoot
 * @param {import('../core/rule-loader.js').SyncRule[]} rules
 * @returns {string[]}
 */
function collectWatchPaths(projectRoot, rules) {
  const seen = new Set();
  for (const rule of rules) {
    const paths = rule.sources ?? [rule.source];
    for (const src of paths) {
      seen.add(join(projectRoot, src));
    }
  }
  return [...seen];
}

/**
 * @param {string} projectRoot
 * @param {{ verbose?: boolean, allowPlugins?: boolean }} [options]
 */
export async function watchCommand(projectRoot, options = {}) {
  logger.header('SpecFuse Watch  v2');
  logger.br();
  logger.info('Watching for SDD artifact changes…');
  logger.info(`Press ${chalk.bold('Ctrl+C')} to stop.`);
  logger.br();

  const registry = new Registry(projectRoot);
  await registry.load();
  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins });

  // Lazy-load chokidar only when watch actually starts — not at module import time
  const { default: chokidar } = await import('chokidar');

  // Derive watch paths from rule.sources[] — covers both canonical and fallback paths
  const watchSources = collectWatchPaths(projectRoot, rules);

  // Event queue — serialize concurrent triggers, prevent thrashing
  let processing = false;
  const queue    = [];

  async function drainQueue() {
    if (processing || !queue.length) return;
    processing = true;

    while (queue.length) {
      const { event, filePath } = queue.shift();
      const rel       = filePath.replace(projectRoot, '').replace(/^[/\\]/, '');
      const triggered = routeToRules(filePath, projectRoot, rules);

      if (!triggered.length) {
        if (options.verbose) logger.debug(`Ignored: ${rel}`);
        continue;
      }

      logger.sync(`${chalk.bold(event)} → ${chalk.cyan(rel)}`);
      logger.info(`Triggering: ${triggered.map(r => r.id).join(', ')}`);

      // Reload registry so we see any external updates
      await registry.load();
      const { passA, passB } = await runTwoPassSync(projectRoot, registry, triggered);
      const changed = [...passA, ...passB].filter(r => r.changed).length;

      if (changed > 0) logger.success(`${changed} rule(s) applied.`);
      else             logger.info(chalk.dim('No managed sections changed.'));
      logger.br();
    }

    processing = false;
  }

  const watcher = chokidar.watch(watchSources, {
    persistent:     true,
    ignoreInitial:  true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher
    .on('change', p => { queue.push({ event: 'change', filePath: p }); drainQueue(); })
    .on('add',    p => { queue.push({ event: 'add',    filePath: p }); drainQueue(); })
    .on('addDir', p => { queue.push({ event: 'addDir', filePath: p }); drainQueue(); })
    .on('error',  e => logger.error(`Watcher error: ${e.message}`));

  logger.info(chalk.dim('Watching:'));
  for (const src of watchSources) {
    logger.row('  ·', src.replace(projectRoot, '.'), chalk.dim);
  }
  logger.br();

  process.on('SIGINT', async () => {
    logger.br();
    logger.info('Stopping…');
    await watcher.close();
    logger.success('Watch stopped.');
    process.exit(0);
  });
}
