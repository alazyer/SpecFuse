import { Command } from 'commander'
import { resolve } from 'path'
import { createRequire } from 'module'
import chalk from 'chalk'

import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { syncCommand } from './commands/sync.js'
import { driftCommand } from './commands/drift.js'
import { resolveCommand } from './commands/resolve.js'
import { diffCommand } from './commands/diff.js'
import { watchCommand } from './commands/watch.js'
import { doctorCommand } from './commands/doctor.js'
import { validateCommand } from './commands/validate.js'
import { installHooksCommand, uninstallHooksCommand } from './commands/install-hooks.js'
import { guideCommand } from './commands/guide.js'
import { schemaInitCommand, schemaShowCommand } from './commands/schema.js'
import { traceCommand } from './commands/trace.js'
import { graphCommand } from './commands/graph.js'
import { lintCommand } from './commands/lint.js'

// CI integration commands
import { ciDrift, ciValidate, ciCheck, ciInit } from './commands/ci.js'

// Template commands
import {
  templateListCommand,
  templateShowCommand,
  templateCopyCommand,
  templateValidateCommand,
} from './commands/template.js'

// Clean and reset commands
import { cleanCommand, resetCommand } from './commands/clean.js'

// Config commands
import {
  configListCommand,
  configGetCommand,
  configSetCommand,
  configValidateCommand,
  configPathCommand,
} from './commands/config.js'

// History commands
import { historyCommand, historySyncCommand, historyArchiveCommand } from './commands/history.js'

// Plan commands (replaces BMAD)
import {
  planPrd,
  planArch,
  planStory,
  planList,
  planDesignSystem,
  planDesignFlow,
  planDesignScreen,
  planDesignList,
} from './commands/plan/index.js'

// Specify commands (replaces Spec-Kit)
import { specifyInit, specifyAdd, specifyShow } from './commands/specify/index.js'

// Change commands (replaces OpenSpec)
import {
  changeNew,
  changeList,
  changeShow,
  changeArchive,
  changeReview,
  changeVerify,
} from './commands/change/index.js'

// Batch commands
import {
  batchStatusCommand,
  batchReviewCommand,
  batchVerifyCommand,
  batchArchiveCommand,
} from './commands/batch.js'

// Bundle commands
import { exportCommand } from './commands/export.js'
import { importCommand } from './commands/import.js'

import { logger } from './utils/logger.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const program = new Command()

program
  .name('specfuse')
  .description(
    'SpecFuse v4 — self-contained Spec-Driven Development platform.\n' +
      'Plan, specify, change, and sync — no external tools required.',
  )
  .version(pkg.version)
  .option('-d, --debug', 'Enable debug output', false)
  .hook('preAction', (cmd) => {
    if (cmd.opts().debug) logger.enableDebug()
  })
program.showSuggestionAfterError(true)

const rootOpt = ['--root <path>', 'Project root directory', '.']
const pluginsOpt = ['--allow-plugins', 'Allow user plugin rules in CI', false]
const schemaOpt = [
  '--schema <path>',
  'Artifact schema file (default: .specfuse/artifact-schema.json)',
]
const ciFormatOpt = [
  '--format <fmt>',
  'CI output format: github | junit | sarif | auto',
  'auto',
]

function levenshtein(a, b) {
  const left = String(a ?? '')
  const right = String(b ?? '')
  const dp = Array.from({ length: left.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= right.length; j++) dp[0][j] = j

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[left.length][right.length]
}

function suggestCommands(input, candidates) {
  const source = String(input ?? '')
    .trim()
    .toLowerCase()
  if (!source) return []

  const ranked = candidates
    .filter(Boolean)
    .map((c) => String(c).trim())
    .map((cmd) => ({ cmd, score: levenshtein(source, cmd.toLowerCase()) }))
    .sort((a, b) => a.score - b.score || a.cmd.localeCompare(b.cmd))

  const threshold = Math.max(2, Math.floor(source.length / 2))
  return ranked
    .filter((item) => item.score <= threshold)
    .slice(0, 3)
    .map((item) => item.cmd)
}

function bindUnknownCommandHandler(command, prefix) {
  command.on('command:*', function ([cmd]) {
    logger.error(`Unknown command: ${cmd}`)
    const candidates = this.commands.map((c) => c.name())
    const suggestions = suggestCommands(cmd, candidates)
    if (suggestions.length > 0) {
      logger.info(
        `Did you mean: ${suggestions.map((s) => chalk.cyan(`${prefix} ${s}`)).join(chalk.dim(' | '))}`,
      )
    }
    logger.info('Run `specfuse --help` to see available commands.')
    process.exit(1)
  })

  for (const subCommand of command.commands) {
    bindUnknownCommandHandler(subCommand, `${prefix} ${subCommand.name()}`)
  }
}

// ── init ─────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize SpecFuse: scaffold .specfuse/ and detect project phase')
  .option(...rootOpt)
  .option('--force', 'Re-initialize even if already set up', false)
  .option('--name <name>', 'Project name')
  .action(async (o) => initCommand(resolve(o.root), { force: o.force, name: o.name }))

// ── guide ────────────────────────────────────────────────────────────────────
program
  .command('guide')
  .alias('start')
  .description('Guided onboarding with role-based next steps for your current phase')
  .option(...rootOpt)
  .option(
    '--persona <role>',
    'Tailor guidance by role: new-user | planner | developer | qa.',
    'new-user',
  )
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => guideCommand(resolve(o.root), { persona: o.persona, json: o.json }))

// ── schema ───────────────────────────────────────────────────────────────────
const schema = program
  .command('schema')
  .description('Custom artifact instruction schema — initialize and inspect schema config')

schema
  .command('init')
  .description('Create .specfuse/artifact-schema.json with starter keys')
  .option(...rootOpt)
  .option(...schemaOpt)
  .option('--force', 'Recreate schema template even if file exists', false)
  .action(async (o) => schemaInitCommand(resolve(o.root), { schemaPath: o.schema, force: o.force }))

schema
  .command('show')
  .description('Show resolved schema path and configured artifact instruction keys')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (o) => schemaShowCommand(resolve(o.root), { schemaPath: o.schema }))

// ── ci ──────────────────────────────────────────────────────────────────────────
const ci = program
  .command('ci')
  .description('CI integration — drift/validate checks with CI-optimized output formats')

ci
  .command('drift')
  .description('Run drift check with CI-optimized output. Exit 1 on BOTH_CHANGED conflicts.')
  .option(...rootOpt)
  .option(...ciFormatOpt)
  .option(...pluginsOpt)
  .option('--fail', 'Exit 1 on warnings too (strict CI mode)', false)
  .option('--output <path>', 'Write output to a file instead of stdout')
  .action(async (o) =>
    ciDrift(resolve(o.root), {
      format: o.format,
      allowPlugins: o.allowPlugins,
      failOnWarn: o.fail,
      output: o.output,
    }),
  )

ci
  .command('validate')
  .description('Run validation with CI-optimized output. Exit 1 on failures.')
  .option(...rootOpt)
  .option(...ciFormatOpt)
  .option('--artifact <type>', 'Validate one type: prd|arch|design-system|proposal|story|all', 'all')
  .option('--fail', 'Exit 1 on warnings too (strict CI mode)', false)
  .option('--output <path>', 'Write output to a file instead of stdout')
  .action(async (o) =>
    ciValidate(resolve(o.root), {
      format: o.format,
      artifact: o.artifact,
      failOnWarn: o.fail,
      output: o.output,
    }),
  )

ci
  .command('check')
  .description('Combined drift + validation check. Exit 1 on any FAIL-state.')
  .option(...rootOpt)
  .option(...ciFormatOpt)
  .option('--artifact <type>', 'Validate one type: prd|arch|design-system|proposal|story|all', 'all')
  .option(...pluginsOpt)
  .option('--fail', 'Exit 1 on warnings too (strict CI mode)', false)
  .option('--output <path>', 'Write output to a file instead of stdout')
  .action(async (o) =>
    ciCheck(resolve(o.root), {
      format: o.format,
      artifact: o.artifact,
      allowPlugins: o.allowPlugins,
      failOnWarn: o.fail,
      output: o.output,
    }),
  )

ci
  .command('init')
  .description('Generate a GitHub Actions workflow file for SpecFuse CI')
  .option(...rootOpt)
  .option('--github', 'Generate GitHub Actions workflow (default, only option supported)', true)
  .option('--output <path>', 'Output file path (default: .github/workflows/specfuse-ci.yml)')
  .option('--force', 'Overwrite an existing workflow file', false)
  .action(async (o) =>
    ciInit(resolve(o.root), { github: o.github, output: o.output, force: o.force }),
  )

// ── plan ──────────────────────────────────────────────────────────────────────
const plan = program
  .command('plan')
  .description(
    'Planning workflow — create PRD, architecture doc, design artifacts, and user stories',
  )

plan
  .command('prd')
  .description('Create or view the Product Requirements Document (.specfuse/plan/prd.md)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .option('--name <name>', 'Project name for the template')
  .action(async (o) => planPrd(resolve(o.root), { name: o.name, schema: o.schema }))

plan
  .command('arch')
  .description('Create or view the architecture document (.specfuse/plan/architecture.md)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (o) => planArch(resolve(o.root), { schema: o.schema }))

plan
  .command('story [title]')
  .description('Add a new user story to .specfuse/plan/stories/')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (title, o) => planStory(resolve(o.root), title, { schema: o.schema }))

plan
  .command('list')
  .alias('ls')
  .description('List all planning artifacts with status')
  .option(...rootOpt)
  .action(async (o) => planList(resolve(o.root)))

const planDesign = plan
  .command('design')
  .description(
    'Design planning workflow — create design system constraints, flows, and screen specs',
  )

planDesign
  .command('system')
  .description('Create or view the design system document (.specfuse/plan/design/system.md)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (o) => planDesignSystem(resolve(o.root), { schema: o.schema }))

planDesign
  .command('flow [title]')
  .description('Add a new design flow to .specfuse/plan/design/flows/')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (title, o) => planDesignFlow(resolve(o.root), title, { schema: o.schema }))

planDesign
  .command('screen [title]')
  .description('Add a new screen/component spec to .specfuse/plan/design/screens/')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (title, o) => planDesignScreen(resolve(o.root), title, { schema: o.schema }))

planDesign
  .command('list')
  .description('List all design artifacts with status')
  .option(...rootOpt)
  .action(async (o) => planDesignList(resolve(o.root)))

plan.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  $ specfuse plan prd --name "Storefront"',
    '  $ specfuse plan arch',
    '  $ specfuse plan story "Checkout flow"',
    '  $ specfuse plan design system',
  ].join('\n'),
)

// ── specify ───────────────────────────────────────────────────────────────────
const specify = program
  .command('specify')
  .description('Constitution management — create, update, and view constitution.md')

specify
  .command('init')
  .description('Create constitution.md from template (auto-syncs from plan if available)')
  .option(...rootOpt)
  .option(...schemaOpt)
  .option('--force', 'Recreate from template even if constitution.md exists', false)
  .option('--no-sync', 'Skip auto-sync of plan artifacts', false)
  .action(async (o) =>
    specifyInit(resolve(o.root), { force: o.force, sync: o.sync, schema: o.schema }),
  )

specify
  .command('add <section>')
  .description('Add or update a rule section in constitution.md')
  .option(...rootOpt)
  .option('--content <text>', 'Section body (defaults to placeholder)')
  .action(async (section, o) => specifyAdd(resolve(o.root), section, o.content))

specify
  .command('show')
  .description('Pretty-print the current constitution')
  .option(...rootOpt)
  .action(async (o) => specifyShow(resolve(o.root)))

// ── change ────────────────────────────────────────────────────────────────────
const change = program
  .command('change')
  .description('Change management — create, track, and archive change proposals')

change
  .command('new <name>')
  .description('Create a new change proposal directory with proposal.md, design.md, tasks.md')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (name, o) => changeNew(resolve(o.root), name, { schema: o.schema }))

change
  .command('list')
  .alias('ls')
  .description('List active and recently archived changes')
  .option(...rootOpt)
  .action(async (o) => changeList(resolve(o.root)))

change
  .command('show <name>')
  .description('Show details of a specific change proposal')
  .option(...rootOpt)
  .action(async (name, o) => changeShow(resolve(o.root), name))

change
  .command('review <name>')
  .description('Generate or inspect review.md for a change proposal')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (name, o) => changeReview(resolve(o.root), name, { schema: o.schema }))

change
  .command('verify <name>')
  .description('Generate or inspect verify.md for a change proposal')
  .option(...rootOpt)
  .option(...schemaOpt)
  .action(async (name, o) => changeVerify(resolve(o.root), name, { schema: o.schema }))

change
  .command('archive <name>')
  .description('Archive a completed change: verification is required unless --force is used')
  .option(...rootOpt)
  .option('--force', 'Archive even if verification has not passed', false)
  .action(async (name, o) => changeArchive(resolve(o.root), name, { force: o.force }))

change.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  $ specfuse change new add-login',
    '  $ specfuse change review add-login',
    '  $ specfuse change verify add-login',
    '  $ specfuse change archive add-login',
  ].join('\n'),
)

// ── template ───────────────────────────────────────────────────────────────────
const template = program
  .command('template')
  .description('Template management — list, show, copy, and validate artifact templates')

template
  .command('list')
  .alias('ls')
  .description('List all available templates with override status')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => templateListCommand(resolve(o.root), { json: o.json }))

template
  .command('show <name>')
  .description('Display a template with optional variable documentation')
  .option(...rootOpt)
  .option('--vars', 'Show documented template variables', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (name, o) =>
    templateShowCommand(resolve(o.root), name, { vars: o.vars, json: o.json }),
  )

template
  .command('copy <name>')
  .description('Copy a built-in template to .specfuse/templates/ for customization')
  .option(...rootOpt)
  .option('--force', 'Overwrite an existing custom template', false)
  .action(async (name, o) => templateCopyCommand(resolve(o.root), name, { force: o.force }))

template
  .command('validate')
  .description('Validate all custom templates in .specfuse/templates/')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => templateValidateCommand(resolve(o.root), { json: o.json }))

// ── sync ──────────────────────────────────────────────────────────────────────
const sync = program
  .command('sync')
  .description(
    'Run all sync rules (two-pass):\n' +
      '  Pass A: plan artifacts + stories + archive → .specfuse/constitution.md\n' +
      '  Pass B: .specfuse/constitution.md → change proposal headers',
  )
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--rule <ids...>', 'Run specific rule IDs only')
  .option('--force', 'Overwrite BOTH_CHANGED pairs without prompting (old behavior)', false)
  .option('--resolve', 'Run interactive resolver for BOTH_CHANGED pairs before continuing', false)
  .option(
    '--no-recover',
    'Decline automatic recovery of an interrupted prior sync (abort with a clear error instead)',
  )
  .option('--json', 'Machine-readable JSON output (passes passA, passB, warnings, recovery)', false)
  .action(async (o) =>
    syncCommand(resolve(o.root), {
      rules: o.rule,
      allowPlugins: o.allowPlugins,
      force: o.force,
      resolve: o.resolve,
      noRecover: o.recover === false, // --no-recover → o.recover === false
      json: o.json,
    }),
  )

sync.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  $ specfuse sync',
    '  $ specfuse sync --rule plan:arch→constitution:plan-decisions',
    '  $ specfuse sync --force   # overwrite BOTH_CHANGED pairs',
    '  $ specfuse sync --resolve # resolve conflicts interactively',
    '  $ specfuse sync --no-recover  # abort if an interrupted sync is pending',
  ].join('\n'),
)

// ── drift ─────────────────────────────────────────────────────────────────────
program
  .command('drift')
  .alias('check')
  .description('Detect spec drift across all tracked artifact pairs. Exit 1 with --fail.')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--fail', 'Exit code 1 if any drift detected (CI use)', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    driftCommand(resolve(o.root), {
      failOnDrift: o.fail,
      allowPlugins: o.allowPlugins,
      json: o.json,
    }),
  )

// ── resolve ────────────────────────────────────────────────────────────────────
program
  .command('resolve <rule-id>')
  .description('Resolve a BOTH_CHANGED conflict interactively')
  .option(...rootOpt)
  .option('--json', 'Output conflict data as JSON and exit (no interactive prompt)', false)
  .action(async (ruleId, o) =>
    resolveCommand(resolve(o.root), { ruleId, json: o.json }),
  )

// ── validate ─────────────────────────────────────────────────────────────────
program
  .command('validate')
  .description('Validate spec artifact structure, content, and integrity. Exit 1 on failures.')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .option('--fail', 'Exit code 1 on warnings too (strict CI mode)', false)
  .option('--artifact <type>', 'Validate only one artifact type (prd|arch|design-system|proposal|story|all)', 'all')
  .action(async (o) =>
    validateCommand(resolve(o.root), {
      json: o.json,
      fail: o.fail,
      artifact: o.artifact,
    }),
  )

// ── trace ──────────────────────────────────────────────────────────────────────
program
  .command('trace')
  .description(
    'Show traceability matrix — which stories have active changes, which are implemented, and which are uncovered',
  )
  .option(...rootOpt)
  .option('--coverage', 'Show only the coverage summary', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => traceCommand(resolve(o.root), { coverage: o.coverage, json: o.json }))

// ── graph ────────────────────────────────────────────────────────────────────
const graph = program
  .command('graph')
  .description(
    'Visualize dependency graph of rules and artifacts. Outputs DOT format by default.',
  )
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--mermaid', 'Output Mermaid.js flowchart syntax', false)
  .option('--json', 'Output JSON graph data', false)
  .option('--artifact <name>', 'Show only rules affecting a specific artifact')
  .option('--impact <file>', 'Show what would be affected if this file changes')
  .option('--output <file>', 'Write output to a file instead of stdout')
  .action(async (o) =>
    graphCommand(resolve(o.root), {
      mermaid: o.mermaid,
      json: o.json,
      artifact: o.artifact,
      impact: o.impact,
      output: o.output,
      allowPlugins: o.allowPlugins,
    }),
  )

graph.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  $ specfuse graph                              # full graph in DOT format',
    '  $ specfuse graph --mermaid                    # full graph in Mermaid format',
    '  $ specfuse graph --json                       # full graph as JSON',
    '  $ specfuse graph --artifact architecture.md    # filtered to specific artifact',
    '  $ specfuse graph --impact src/api/auth.ts      # impact analysis for a file',
    '  $ specfuse graph --impact src/api/auth.ts --mermaid  # impact in Mermaid',
    '  $ specfuse graph --output graph.dot            # write DOT to a file',
  ].join('\n'),
)

// ── lint ──────────────────────────────────────────────────────────────────────
program
  .command('lint')
  .description('Lint Markdown artifacts for style and structural issues')
  .option(...rootOpt)
  .option('--fix', 'Auto-fix whitespace and blank-line issues', false)
  .option('--json', 'Machine-readable JSON output', false)
  .option('--fail', 'Exit code 1 on errors (CI mode)', false)
  .option('--config <path>', 'Custom lint config file path')
  .option('--rule <names...>', 'Run only specified rule(s)')
  .option('--artifact <name>', 'Lint only a specific artifact')
  .action(async (o) =>
    lintCommand(resolve(o.root), {
      fix: o.fix,
      json: o.json,
      fail: o.fail,
      config: o.config,
      rule: o.rule,
      artifact: o.artifact,
    }),
  )

// ── diff ──────────────────────────────────────────────────────────────────────
program
  .command('diff')
  .description(
    'Preview what specfuse sync would change — no files written (unless --apply). Exit 1 if changes exist.',
  )
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .option('--apply', 'Apply the proposed changes to disk', false)
  .option('--stat', 'Show compact stat summary instead of full diff', false)
  .option('--color', 'Force colorized output', false)
  .option('--no-color', 'Disable colorized output')
  .action(async (o) =>
    diffCommand(resolve(o.root), {
      json: o.json,
      allowPlugins: o.allowPlugins,
      apply: o.apply,
      stat: o.stat,
      color: o.color,
    }),
  )

// ── watch ─────────────────────────────────────────────────────────────────────
program
  .command('watch')
  .description(
    'Live file watcher — auto-syncs within 400ms of any plan or change artifact modification',
  )
  .option(...rootOpt)
  .option(...pluginsOpt)
  .option('--verbose', 'Log all file events', false)
  .action(async (o) =>
    watchCommand(resolve(o.root), { verbose: o.verbose, allowPlugins: o.allowPlugins }),
  )

// ── status ────────────────────────────────────────────────────────────────────
const status = program
  .command('status')
  .description('Full project dashboard: phase, artifacts, rules, drift, hooks')
  .option(...rootOpt)
  .option(...pluginsOpt)
  .action(async (o) => statusCommand(resolve(o.root), { allowPlugins: o.allowPlugins }))

status.addHelpText(
  'after',
  ['', 'Examples:', '  $ specfuse status', '  $ specfuse status --allow-plugins'].join('\n'),
)

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Run diagnostic checks: registry, constitution, plan, changes, plugins')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => doctorCommand(resolve(o.root), { json: o.json }))

// ── config ─────────────────────────────────────────────────────────────────────
const config = program
  .command('config')
  .description('Configuration management — list, get, set, validate, and locate config files')

config
  .command('list')
  .alias('ls')
  .description('Show all configuration values (registry, schema, rules)')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .option(...schemaOpt)
  .action(async (o) =>
    configListCommand(resolve(o.root), { json: o.json, schemaPath: o.schema }),
  )

config
  .command('get <key>')
  .description('Get a single configuration value by dotted key (e.g. registry.phase)')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .option(...schemaOpt)
  .action(async (key, o) =>
    configGetCommand(key, resolve(o.root), { json: o.json, schemaPath: o.schema }),
  )

config
  .command('set <key> <value>')
  .description('Set a mutable configuration value by dotted key')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .option(...schemaOpt)
  .action(async (key, value, o) =>
    configSetCommand(key, value, resolve(o.root), { json: o.json, schemaPath: o.schema }),
  )

config
  .command('validate')
  .description('Validate the current configuration')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .option(...schemaOpt)
  .action(async (o) =>
    configValidateCommand(resolve(o.root), { json: o.json, schemaPath: o.schema }),
  )

config
  .command('path')
  .description('Show resolved config file paths (registry, schema, rules)')
  .option(...rootOpt)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => configPathCommand(resolve(o.root), { json: o.json }))

// ── clean ──────────────────────────────────────────────────────────────────────
program
  .command('clean')
  .description('Remove orphaned files, stale registry entries, and empty directories')
  .option(...rootOpt)
  .option('--dry-run', 'Preview what would be removed without writing', false)
  .option('--force', 'Skip confirmation prompts', false)
  .option('--registry', 'Clean only stale registry entries', false)
  .option('--orphans', 'Clean only orphaned files and empty directories', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    cleanCommand(resolve(o.root), {
      dryRun: o.dryRun,
      force: o.force,
      registry: o.registry,
      orphans: o.orphans,
      json: o.json,
    }),
  )

// ── reset ──────────────────────────────────────────────────────────────────────
program
  .command('reset')
  .description('Reset project state (preserves plan/ and changes/archive/ by default)')
  .option(...rootOpt)
  .option('--dry-run', 'Preview what would be reset (default behavior)', true)
  .option('--hard', 'Remove ALL SpecFuse artifacts including plan and archive', false)
  .option('--force', 'Skip confirmation prompt', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    resetCommand(resolve(o.root), {
      dryRun: o.dryRun,
      hard: o.hard,
      force: o.force,
      json: o.json,
    }),
  )

// ── history ────────────────────────────────────────────────────────────────────
const history = program
  .command('history')
  .description('Audit log — show and filter recorded spec events')
  .option(...rootOpt)
  .option('--since <date>', 'Show events since this date/time')
  .option('--until <date>', 'Show events up to this date/time')
  .option('--limit <n>', 'Maximum number of events to show', (v) => parseInt(v, 10), 20)
  .option('--type <type>', 'Filter by event type')
  .option('--json', 'Machine-readable JSON output', false)
  .option('--verbose', 'Show full event details', false)
  // Bare `specfuse history` (no subcommand) shows recent events.
  .action(async (o) =>
    historyCommand(resolve(o.root), {
      since: o.since,
      until: o.until,
      limit: o.limit,
      type: o.type,
      json: o.json,
      verbose: o.verbose,
    }),
  )

history
  .command('list')
  .alias('ls')
  .description('Show recent history events with optional filtering (default subcommand)')
  .option(...rootOpt)
  .option('--since <date>', 'Show events since this date/time')
  .option('--until <date>', 'Show events up to this date/time')
  .option('--limit <n>', 'Maximum number of events to show', (v) => parseInt(v, 10), 20)
  .option('--type <type>', 'Filter by event type')
  .option('--json', 'Machine-readable JSON output', false)
  .option('--verbose', 'Show full event details', false)
  .action(async (o) =>
    historyCommand(resolve(o.root), {
      since: o.since,
      until: o.until,
      limit: o.limit,
      type: o.type,
      json: o.json,
      verbose: o.verbose,
    }),
  )

history
  .command('sync')
  .description('Show only sync history events')
  .option(...rootOpt)
  .option('--since <date>', 'Show events since this date/time')
  .option('--until <date>', 'Show events up to this date/time')
  .option('--limit <n>', 'Maximum number of events to show', (v) => parseInt(v, 10), 20)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    historySyncCommand(resolve(o.root), {
      since: o.since,
      until: o.until,
      limit: o.limit,
      json: o.json,
    }),
  )

history
  .command('archive')
  .description('Show only archive history events')
  .option(...rootOpt)
  .option('--since <date>', 'Show events since this date/time')
  .option('--until <date>', 'Show events up to this date/time')
  .option('--limit <n>', 'Maximum number of events to show', (v) => parseInt(v, 10), 20)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    historyArchiveCommand(resolve(o.root), {
      since: o.since,
      until: o.until,
      limit: o.limit,
      json: o.json,
    }),
  )

// Install-hooks stays below the new top-level commands
// ── install-hooks ──────────────────────────────────────────────────────────────
program
  .command('install-hooks')
  .description('Install pre-commit (drift --fail) and post-commit (sync) git hooks')
  .option(...rootOpt)
  .action(async (o) => installHooksCommand(resolve(o.root)))

program
  .command('uninstall-hooks')
  .description('Remove SpecFuse-managed git hooks')
  .option(...rootOpt)
  .action(async (o) => uninstallHooksCommand(resolve(o.root)))

// ── batch ─────────────────────────────────────────────────────────────────────
const batch = program
  .command('batch')
  .description('Bulk operations — review, verify, archive, and status across multiple changes')
  .option(...rootOpt)
  .option('--filter <pattern>', 'Filter changes by glob or regex (prefix / for regex)')
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    batchStatusCommand(resolve(o.root), {
      filter: o.filter,
      filterType: o.filter?.startsWith('/') ? 'regex' : 'glob',
      json: o.json,
    }),
  )

batch
  .command('status')
  .description('Show status summary across all active changes (counts by state)')
  .option(...rootOpt)
  .option('--filter <pattern>', 'Filter changes by glob or regex (prefix / for regex)')
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    batchStatusCommand(resolve(o.root), {
      filter: o.filter,
      filterType: o.filter?.startsWith('/') ? 'regex' : 'glob',
      json: o.json,
    }),
  )

batch
  .command('review')
  .description('Bulk-approve reviews for eligible changes')
  .requiredOption('--approve', 'Confirm bulk review approval (required for safety)')
  .option(...rootOpt)
  .option('--filter <pattern>', 'Filter changes by glob or regex (prefix / for regex)')
  .option('--dry-run', 'Preview what would be approved without modifying files', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => {
    if (!o.approve) {
      logger.error('The --approve flag is required to confirm bulk review approval.')
      logger.info('Run `specfuse batch review --approve` to proceed.')
      process.exit(1)
    }
    batchReviewCommand(resolve(o.root), {
      filter: o.filter,
      filterType: o.filter?.startsWith('/') ? 'regex' : 'glob',
      dryRun: o.dryRun,
      json: o.json,
    })
  })

batch
  .command('verify')
  .description('Bulk-pass verification for eligible changes')
  .requiredOption('--pass', 'Confirm bulk verification pass (required for safety)')
  .option(...rootOpt)
  .option('--filter <pattern>', 'Filter changes by glob or regex (prefix / for regex)')
  .option('--dry-run', 'Preview what would be verified without modifying files', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) => {
    if (!o.pass) {
      logger.error('The --pass flag is required to confirm bulk verification pass.')
      logger.info('Run `specfuse batch verify --pass` to proceed.')
      process.exit(1)
    }
    batchVerifyCommand(resolve(o.root), {
      filter: o.filter,
      filterType: o.filter?.startsWith('/') ? 'regex' : 'glob',
      dryRun: o.dryRun,
      json: o.json,
    })
  })

batch
  .command('archive')
  .description('Bulk-archive verified changes')
  .option(...rootOpt)
  .option('--filter <pattern>', 'Filter changes by glob or regex (prefix / for regex)')
  .option('--dry-run', 'Preview what would be archived without modifying files', false)
  .option('--force', 'Archive even if verification has not passed', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (o) =>
    batchArchiveCommand(resolve(o.root), {
      filter: o.filter,
      filterType: o.filter?.startsWith('/') ? 'regex' : 'glob',
      dryRun: o.dryRun,
      force: o.force,
      json: o.json,
    }),
  )

batch.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  $ specfuse batch status',
    '  $ specfuse batch status --filter "auth-*"',
    '  $ specfuse batch review --approve --dry-run',
    '  $ specfuse batch review --approve',
    '  $ specfuse batch verify --pass --filter "/^api-/"',
    '  $ specfuse batch verify --pass',
    '  $ specfuse batch archive --dry-run',
    '  $ specfuse batch archive --force',
  ].join('\n'),
)

// ── export ───────────────────────────────────────────────────────────────────
program
  .command('export [output]')
  .description('Create a portable spec bundle (constitution + changes + plan artifacts)')
  .option(...rootOpt)
  .option('--changes <names...>', 'Export selected changes only')
  .option('--full', 'Export entire .specfuse/ directory', false)
  .option('--preview', 'Show what would be exported without creating a file', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (output, o) =>
    exportCommand(output, {
      root: o.root,
      changes: o.changes,
      full: o.full,
      preview: o.preview,
      json: o.json,
    }),
  )

// ── import ───────────────────────────────────────────────────────────────────
program
  .command('import <bundle>')
  .description('Import a portable spec bundle into the current project')
  .option(...rootOpt)
  .option('--merge', 'Merge imported rules into local constitution', false)
  .option('--replace', 'Replace local constitution entirely', false)
  .option('--conflict <strategy>', 'Handle change conflicts: skip | overwrite | rename', 'skip')
  .option('--preview', 'Show what would be imported without writing', false)
  .option('--json', 'Machine-readable JSON output', false)
  .action(async (bundle, o) =>
    importCommand(bundle, {
      root: o.root,
      merge: o.merge,
      replace: o.replace,
      conflict: o.conflict,
      preview: o.preview,
      json: o.json,
    }),
  )

program.addHelpText(
  'after',
  [
    '',
    'Quick start:',
    '  $ specfuse init --name "My Project"',
    '  $ specfuse plan prd && specfuse plan arch',
    '  $ specfuse specify init && specfuse sync',
    '',
    'Optional helper:',
    '  $ specfuse guide --persona new-user',
  ].join('\n'),
)

// ── Error handling ─────────────────────────────────────────────────────────────
program.configureOutput({ writeErr: (s) => logger.error(s.trimEnd()) })
bindUnknownCommandHandler(program, 'specfuse')

program.parse(process.argv)
if (!process.argv.slice(2).length) program.outputHelp()
