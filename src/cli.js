import { Command }        from 'commander';
import { resolve }        from 'path';
import { createRequire }  from 'module';
import chalk from 'chalk';

import { initCommand }   from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { syncCommand }   from './commands/sync.js';
import { driftCommand }  from './commands/drift.js';
import { diffCommand }   from './commands/diff.js';
import { watchCommand }  from './commands/watch.js';
import { doctorCommand } from './commands/doctor.js';
import { installHooksCommand, uninstallHooksCommand } from './commands/install-hooks.js';
import { guideCommand } from './commands/guide.js';
import { schemaInitCommand, schemaShowCommand } from './commands/schema.js';

// Plan commands (replaces BMAD)
import { planPrd, planArch, planStory, planList, planDesignSystem, planDesignFlow, planDesignScreen, planDesignList } from './commands/plan/index.js';

// Specify commands (replaces Spec-Kit)
import { specifyInit, specifyAdd, specifyShow } from './commands/specify/index.js';

// Change commands (replaces OpenSpec)
import { changeNew, changeList, changeShow, changeArchive, changeReview, changeVerify } from './commands/change/index.js';

import { logger } from './utils/logger.js';

const require = createRequire(import.meta.url);
const pkg     = require('../package.json');

const program = new Command();

program
  .name('specfuse')
  .description(
    'SpecFuse v4 — self-contained Spec-Driven Development platform.\n' +
    'Plan, specify, change, and sync — no external tools required.'
  )
  .version(pkg.version)
  .option('-d, --debug', 'Enable debug output', false)
  .hook('preAction', cmd => { if (cmd.opts().debug) logger.enableDebug(); });
program.showSuggestionAfterError(true);

const rootOpt    = ['--root <path>', 'Project root directory', '.'];
const pluginsOpt = ['--allow-plugins', 'Allow user plugin rules in CI', false];
const schemaOpt  = ['--schema <path>', 'Artifact schema file (default: .specfuse/artifact-schema.json)'];

function levenshtein(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const dp = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j++) dp[0][j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[left.length][right.length];
}

function suggestCommands(input, candidates) {
  const source = String(input ?? '').trim().toLowerCase();
  if (!source) return [];

  const ranked = candidates
    .filter(Boolean)
    .map(c => String(c).trim())
    .map(cmd => ({ cmd, score: levenshtein(source, cmd.toLowerCase()) }))
    .sort((a, b) => a.score - b.score || a.cmd.localeCompare(b.cmd));

  const threshold = Math.max(2, Math.floor(source.length / 2));
  return ranked.filter(item => item.score <= threshold).slice(0, 3).map(item => item.cmd);
}

function bindUnknownCommandHandler(command, prefix) {
  command.on('command:*', function ([cmd]) {
    logger.error(`Unknown command: ${cmd}`);
    const candidates = this.commands.map(c => c.name());
    const suggestions = suggestCommands(cmd, candidates);
    if (suggestions.length > 0) {
      logger.info(`Did you mean: ${suggestions.map(s => chalk.cyan(`${prefix} ${s}`)).join(chalk.dim(' | '))}`);
    }
    logger.info('Run `specfuse --help` to see available commands.');
    process.exit(1);
  });

  for (const subCommand of command.commands) {
    bindUnknownCommandHandler(subCommand, `${prefix} ${subCommand.name()}`);
  }
}

// ── init ─────────────────────────────────────────────────────────────────────
program.command('init')
  .description('Initialize SpecFuse: scaffold .specfuse/ and detect project phase')
  .option(...rootOpt)
  .option('--force', 'Re-initialize even if already set up', false)
  .option('--name <name>', 'Project name')
  .action(async o => initCommand(resolve(o.root), { force: o.force, name: o.name }));

// ── guide ────────────────────────────────────────────────────────────────────
program.command('guide')
  .alias('start')
  .description('Guided onboarding with role-based next steps for your current phase')
  .option(...rootOpt)
  .option('--persona <role>', 'Tailor guidance by role: new-user | planner | developer | qa.', 'new-user')
  .option('--json', 'Machine-readable JSON output', false)
  .action(async o => guideCommand(resolve(o.root), { persona: o.persona, json: o.json }));

// ── schema ───────────────────────────────────────────────────────────────────
const schema = program.command('schema')
  .description('Custom artifact instruction schema — initialize and inspect schema config');

schema.command('init')
  .description('Create .specfuse/artifact-schema.json with starter keys')
  .option(...rootOpt)
  .option(...schemaOpt)
  .option('--force', 'Recreate schema template even if file exists', false)
  .action(async o => schemaInitCommand(resolve(o.root), { schemaPath: o.schema, force: o.force }));

schema.command('show')
  .description('Show resolved schema path and configured artifact instruction keys')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async o => schemaShowCommand(resolve(o.root), { schemaPath: o.schema }));

// ── plan ──────────────────────────────────────────────────────────────────────
const plan = program.command('plan')
  .description('Planning workflow — create PRD, architecture doc, design artifacts, and user stories');

plan.command('prd')
  .description('Create or view the Product Requirements Document (.specfuse/plan/prd.md)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .option('--name <name>', 'Project name for the template')
  .action(async o => planPrd(resolve(o.root), { name: o.name, schema: o.schema }));

plan.command('arch')
  .description('Create or view the architecture document (.specfuse/plan/architecture.md)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async o => planArch(resolve(o.root), { schema: o.schema }));

plan.command('story [title]')
  .description('Add a new user story to .specfuse/plan/stories/')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (title, o) => planStory(resolve(o.root), title, { schema: o.schema }));

plan.command('list')
  .alias('ls')
  .description('List all planning artifacts with status')
  .option(...rootOpt)
  .action(async o => planList(resolve(o.root)));

const planDesign = plan.command('design')
  .description('Design planning workflow — create design system constraints, flows, and screen specs');

planDesign.command('system')
  .description('Create or view the design system document (.specfuse/plan/design/system.md)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async o => planDesignSystem(resolve(o.root), { schema: o.schema }));

planDesign.command('flow [title]')
  .description('Add a new design flow to .specfuse/plan/design/flows/')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (title, o) => planDesignFlow(resolve(o.root), title, { schema: o.schema }));

planDesign.command('screen [title]')
  .description('Add a new screen/component spec to .specfuse/plan/design/screens/')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (title, o) => planDesignScreen(resolve(o.root), title, { schema: o.schema }));

planDesign.command('list')
  .description('List all design artifacts with status')
  .option(...rootOpt)
  .action(async o => planDesignList(resolve(o.root)));

plan.addHelpText('after', [
  '',
  'Examples:',
  '  $ specfuse plan prd --name "Storefront"',
  '  $ specfuse plan arch',
  '  $ specfuse plan story "Checkout flow"',
  '  $ specfuse plan design system',
].join('\n'));

// ── specify ───────────────────────────────────────────────────────────────────
const specify = program.command('specify')
  .description('Constitution management — create, update, and view constitution.md');

specify.command('init')
  .description('Create constitution.md from template (auto-syncs from plan if available)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .option('--force', 'Recreate from template even if constitution.md exists', false)
  .option('--no-sync', 'Skip auto-sync of plan artifacts', false)
  .action(async o => specifyInit(resolve(o.root), { force: o.force, sync: o.sync, schema: o.schema }));

specify.command('add <section>')
  .description('Add or update a rule section in constitution.md')
  .option(...rootOpt)
  .option('--content <text>', 'Section body (defaults to placeholder)')
  .action(async (section, o) => specifyAdd(resolve(o.root), section, o.content));

specify.command('show')
  .description('Pretty-print the current constitution')
  .option(...rootOpt)
  .action(async o => specifyShow(resolve(o.root)));

// ── change ────────────────────────────────────────────────────────────────────
const change = program.command('change')
  .description('Change management — create, track, and archive change proposals');

change.command('new <name>')
  .description('Create a new change proposal directory with proposal.md, design.md, tasks.md')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (name, o) => changeNew(resolve(o.root), name, { schema: o.schema }));

change.command('list')
  .alias('ls')
  .description('List active and recently archived changes')
  .option(...rootOpt)
  .action(async o => changeList(resolve(o.root)));

change.command('show <name>')
  .description('Show details of a specific change proposal')
  .option(...rootOpt)
  .action(async (name, o) => changeShow(resolve(o.root), name));

change.command('review <name>')
  .description('Generate or inspect review.md for a change proposal')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (name, o) => changeReview(resolve(o.root), name, { schema: o.schema }));

change.command('verify <name>')
  .description('Generate or inspect verify.md for a change proposal')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (name, o) => changeVerify(resolve(o.root), name, { schema: o.schema }));

change.command('archive <name>')
  .description('Archive a completed change: verification is required unless --force is used')
  .option(...rootOpt)
  .option('--force', 'Archive even if verification has not passed', false)
  .action(async (name, o) => changeArchive(resolve(o.root), name, { force: o.force }));

change.addHelpText('after', [
  '',
  'Examples:',
  '  $ specfuse change new add-login',
  '  $ specfuse change review add-login',
  '  $ specfuse change verify add-login',
  '  $ specfuse change archive add-login',
].join('\n'));

// ── sync ──────────────────────────────────────────────────────────────────────
const sync = program.command('sync')
  .description(
    'Run all sync rules (two-pass):\n' +
    '  Pass A: plan artifacts + stories + archive → .specfuse/constitution.md\n' +
    '  Pass B: .specfuse/constitution.md → change proposal headers'
  )
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--rule <ids...>', 'Run specific rule IDs only')
  .action(async o => syncCommand(resolve(o.root), { rules: o.rule, allowPlugins: o.allowPlugins }));

sync.addHelpText('after', [
  '',
  'Examples:',
  '  $ specfuse sync',
  '  $ specfuse sync --rule plan:arch→constitution:plan-decisions',
].join('\n'));

// ── drift ─────────────────────────────────────────────────────────────────────
program.command('drift')
  .alias('check')
  .description('Detect spec drift across all tracked artifact pairs. Exit 1 with --fail.')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--fail', 'Exit code 1 if any drift detected (CI use)', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async o => driftCommand(resolve(o.root), { failOnDrift: o.fail, allowPlugins: o.allowPlugins, json: o.json }));

// ── diff ──────────────────────────────────────────────────────────────────────
program.command('diff')
  .description('Preview what specfuse sync would change — no files written. Exit 1 if changes exist.')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async o => diffCommand(resolve(o.root), { json: o.json, allowPlugins: o.allowPlugins }));

// ── watch ─────────────────────────────────────────────────────────────────────
program.command('watch')
  .description('Live file watcher — auto-syncs within 400ms of any plan or change artifact modification')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--verbose', 'Log all file events', false)
  .action(async o => watchCommand(resolve(o.root), { verbose: o.verbose, allowPlugins: o.allowPlugins }));

// ── status ────────────────────────────────────────────────────────────────────
const status = program.command('status')
  .description('Full project dashboard: phase, artifacts, rules, drift, hooks')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .action(async o => statusCommand(resolve(o.root), { allowPlugins: o.allowPlugins }));

status.addHelpText('after', [
  '',
  'Examples:',
  '  $ specfuse status',
  '  $ specfuse status --allow-plugins',
].join('\n'));

// ── doctor ────────────────────────────────────────────────────────────────────
program.command('doctor')
  .description('Run diagnostic checks: registry, constitution, plan, changes, plugins')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async o => doctorCommand(resolve(o.root), { json: o.json }));

// ── install-hooks ──────────────────────────────────────────────────────────────
program.command('install-hooks')
  .description('Install pre-commit (drift --fail) and post-commit (sync) git hooks')
  .option(...rootOpt)
  .action(async o => installHooksCommand(resolve(o.root)));

program.command('uninstall-hooks')
  .description('Remove SpecFuse-managed git hooks')
  .option(...rootOpt)
  .action(async o => uninstallHooksCommand(resolve(o.root)));

program.addHelpText('after', [
  '',
  'Quick start:',
  '  $ specfuse init --name "My Project"',
  '  $ specfuse plan prd && specfuse plan arch',
  '  $ specfuse specify init && specfuse sync',
  '',
  'Optional helper:',
  '  $ specfuse guide --persona new-user',
].join('\n'));

// ── Error handling ─────────────────────────────────────────────────────────────
program.configureOutput({ writeErr: s => logger.error(s.trimEnd()) });
bindUnknownCommandHandler(program, 'specfuse');

program.parse(process.argv);
if (!process.argv.slice(2).length) program.outputHelp();
