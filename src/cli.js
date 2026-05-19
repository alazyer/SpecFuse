import { Command }        from 'commander';
import { resolve }        from 'path';
import { createRequire }  from 'module';

import { initCommand }   from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { syncCommand }   from './commands/sync.js';
import { driftCommand }  from './commands/drift.js';
import { diffCommand }   from './commands/diff.js';
import { watchCommand }  from './commands/watch.js';
import { doctorCommand } from './commands/doctor.js';
import { installHooksCommand, uninstallHooksCommand } from './commands/install-hooks.js';

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

const rootOpt    = ['--root <path>', 'Project root directory', '.'];
const pluginsOpt = ['--allow-plugins', 'Allow user plugin rules in CI', false];

// ── init ─────────────────────────────────────────────────────────────────────
program.command('init')
  .description('Initialize SpecFuse: scaffold .specfuse/ and detect project phase')
  .option(...rootOpt)
  .option('--force', 'Re-initialize even if already set up', false)
  .option('--name <name>', 'Project name')
  .action(async o => initCommand(resolve(o.root), { force: o.force, name: o.name }));

// ── plan ──────────────────────────────────────────────────────────────────────
const plan = program.command('plan')
  .description('Planning workflow — create PRD, architecture doc, design artifacts, and user stories');

plan.command('prd')
  .description('Create or view the Product Requirements Document (.specfuse/plan/prd.md)')
  .option(...rootOpt)
  .option('--name <name>', 'Project name for the template')
  .action(async o => planPrd(resolve(o.root), { name: o.name }));

plan.command('arch')
  .description('Create or view the architecture document (.specfuse/plan/architecture.md)')
  .option(...rootOpt)
  .action(async o => planArch(resolve(o.root)));

plan.command('story [title]')
  .description('Add a new user story to .specfuse/plan/stories/')
  .option(...rootOpt)
  .action(async (title, o) => planStory(resolve(o.root), title));

plan.command('list')
  .description('List all planning artifacts with status')
  .option(...rootOpt)
  .action(async o => planList(resolve(o.root)));

const planDesign = plan.command('design')
  .description('Design planning workflow — create design system constraints, flows, and screen specs');

planDesign.command('system')
  .description('Create or view the design system document (.specfuse/plan/design/system.md)')
  .option(...rootOpt)
  .action(async o => planDesignSystem(resolve(o.root)));

planDesign.command('flow [title]')
  .description('Add a new design flow to .specfuse/plan/design/flows/')
  .option(...rootOpt)
  .action(async (title, o) => planDesignFlow(resolve(o.root), title));

planDesign.command('screen [title]')
  .description('Add a new screen/component spec to .specfuse/plan/design/screens/')
  .option(...rootOpt)
  .action(async (title, o) => planDesignScreen(resolve(o.root), title));

planDesign.command('list')
  .description('List all design artifacts with status')
  .option(...rootOpt)
  .action(async o => planDesignList(resolve(o.root)));

// ── specify ───────────────────────────────────────────────────────────────────
const specify = program.command('specify')
  .description('Constitution management — create, update, and view constitution.md');

specify.command('init')
  .description('Create constitution.md from template (auto-syncs from plan if available)')
  .option(...rootOpt)
  .option('--force', 'Recreate from template even if constitution.md exists', false)
  .option('--no-sync', 'Skip auto-sync of plan artifacts', false)
  .action(async o => specifyInit(resolve(o.root), { force: o.force, sync: o.sync }));

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
  .action(async (name, o) => changeNew(resolve(o.root), name));

change.command('list')
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
  .action(async (name, o) => changeReview(resolve(o.root), name));

change.command('verify <name>')
  .description('Generate or inspect verify.md for a change proposal')
  .option(...rootOpt)
  .action(async (name, o) => changeVerify(resolve(o.root), name));

change.command('archive <name>')
  .description('Archive a completed change: verification is required unless --force is used')
  .option(...rootOpt)
  .option('--force', 'Archive even if verification has not passed', false)
  .action(async (name, o) => changeArchive(resolve(o.root), name, { force: o.force }));

// ── sync ──────────────────────────────────────────────────────────────────────
program.command('sync')
  .description(
    'Run all sync rules (two-pass):\n' +
    '  Pass A: plan artifacts + stories + archive → .specfuse/constitution.md\n' +
    '  Pass B: .specfuse/constitution.md → change proposal headers'
  )
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--rule <ids...>', 'Run specific rule IDs only')
  .action(async o => syncCommand(resolve(o.root), { rules: o.rule, allowPlugins: o.allowPlugins }));

// ── drift ─────────────────────────────────────────────────────────────────────
program.command('drift')
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
program.command('status')
  .description('Full project dashboard: phase, artifacts, rules, drift, hooks')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .action(async o => statusCommand(resolve(o.root), { allowPlugins: o.allowPlugins }));

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

// ── Error handling ─────────────────────────────────────────────────────────────
program.configureOutput({ writeErr: s => logger.error(s.trimEnd()) });
program.on('command:*', ([cmd]) => {
  logger.error(`Unknown command: ${cmd}`);
  logger.info('Run `specfuse --help` to see available commands.');
  process.exit(1);
});

program.parse(process.argv);
if (!process.argv.slice(2).length) program.outputHelp();
