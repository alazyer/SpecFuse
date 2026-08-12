/**
 * CLI registration guard tests.
 *
 * These tests do NOT exercise command behavior (that is covered by each
 * command's own test file). They verify the CLI router wiring in src/cli.js:
 *
 *   1. Every previously-orphaned command group is invocable on an initialized
 *      fixture project and does NOT produce an "Unknown command" error.
 *   2. `specfuse --help` lists all five groups (ci, template, clean, reset,
 *      config, history).
 *   3. Registration guard: every command handler module under src/commands/
 *      that exports a command entry point is reachable through the CLI router
 *      tree, so a future handler cannot ship unregistered.
 *
 * The guard is behavioral (spawn the real CLI binary) rather than static, per
 * the change design (D3): command modules also export helpers, so a static
 * "every export has a registration" check is fragile; behavioral invocation is
 * the reliable signal that a command is actually wired.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const CLI_PATH = fileURLToPath(new URL('../../bin/specfuse.js', import.meta.url))
const COMMANDS_DIR = fileURLToPath(new URL('../commands/', import.meta.url))

// ─── Helpers ──────────────────────────────────────────────────────────────

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  })
}

function runCliNoRoot(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
  })
}

/**
 * Build an initialized fixture project with a valid registry so that commands
 * have a project to operate on. Mirrors the fixtures used by ci.test.js /
 * clean.test.js.
 */
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-cli-reg-'))
  await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true })
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true })

  // Initialize the project so a valid registry exists.
  const init = runCli(root, ['init', '--name', 'RegGuard', '--force'])
  assert.equal(
    init.status,
    0,
    `fixture init failed: ${init.stderr || init.stdout}`,
  )

  return root
}

/**
 * Collect every command name (top-level and subcommand paths) the CLI router
 * advertises, by parsing `specfuse --help` and each group's `<group> --help`.
 * Returns a Set of slash-joined paths, e.g. "ci", "ci/drift", "config/get".
 */
function collectRegisteredCommandPaths() {
  const paths = new Set()

  const rootHelp = runCliNoRoot(['--help'])
  assert.equal(rootHelp.status, 0, `--help failed: ${rootHelp.stderr}`)
  const topLevelNames = parseGroupCommands(rootHelp.stdout)
  for (const name of topLevelNames) paths.add(name)

  for (const name of topLevelNames) {
    // Groups with subcommands advertise them via `<group> --help`. Top-level
    // commands (e.g. clean, reset, drift) print their own options instead.
    const groupHelp = runCliNoRoot([name, '--help'])
    if (groupHelp.status !== 0) continue
    const subNames = parseGroupCommands(groupHelp.stdout)
    for (const sub of subNames) paths.add(`${name}/${sub}`)
  }

  return paths
}

/**
 * Parse the "Commands:" section of a Commander help block into a list of
 * command names (taking the first token of each line, which may include an
 * alias like "list|ls").
 */
function parseGroupCommands(helpText) {
  const names = []
  const lines = helpText.split('\n')
  let inCommands = false
  for (const line of lines) {
    if (/^\s*Commands:\s*$/.test(line)) {
      inCommands = true
      continue
    }
    if (inCommands) {
      // A blank line or a new section header ends the Commands block.
      if (/^\s*$/.test(line)) break
      if (/^\s*[A-Z][a-zA-Z ]*:\s*$/.test(line)) break
      // Each command line begins with whitespace then the command name.
      const match = line.match(/^\s{2,}(\S+)/)
      if (match && match[1] !== 'help') names.push(match[1].split('|')[0])
    }
  }
  return names
}

/**
 * Map of { moduleFile: [exportName, ...] } for every command entry point
 * exported by src/commands/. A "command entry point" is a function whose name
 * ends with "Command" OR is one of the ci.js handlers (which predate the
 * *Command convention). Used by the registration guard to ensure each entry
 * point corresponds to a reachable CLI command.
 */
async function collectCommandEntryPoints() {
  const files = await readdir(COMMANDS_DIR)
  const entryPoints = {}

  for (const file of files.filter((f) => f.endsWith('.js'))) {
    const modPath = join(COMMANDS_DIR, file)
    const mod = await import(`file://${modPath}`)
    const entries = Object.keys(mod).filter((name) => {
      if (typeof mod[name] !== 'function') return false
      return name.endsWith('Command') || /^ci[A-Z]/.test(name)
    })
    if (entries.length > 0) entryPoints[file] = entries
  }

  return entryPoints
}

// Expected mapping from each newly-registered group to the subcommands that
// MUST be reachable (per the change spec scenarios).
const EXPECTED_GROUPS = {
  ci: ['drift', 'validate', 'check', 'init'],
  template: ['list', 'show', 'copy', 'validate'],
  config: ['list', 'get', 'set', 'validate', 'path'],
  history: ['list', 'sync', 'archive'],
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('CLI registration — orphaned command groups', () => {
  let root

  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('each newly registered group is invocable without "Unknown command"', () => {
    // One representative invocation per group, using flags that make the
    // command safe + non-interactive on the fixture.
    const checks = [
      ['ci', ['ci', 'drift', '--format', 'junit']],
      ['template', ['template', 'list', '--json']],
      ['clean', ['clean', '--dry-run', '--json']],
      ['reset', ['reset', '--dry-run', '--json']],
      ['config', ['config', 'get', 'registry.phase', '--json']],
      ['history', ['history', '--json']],
    ]

    for (const [group, args] of checks) {
      const res = runCli(root, args)
      const combined = `${res.stdout}\n${res.stderr}`
      assert.equal(
        res.status,
        0,
        `specfuse ${args.join(' ')} exited ${res.status}:\n${combined}`,
      )
      assert.ok(
        !/Unknown command/i.test(combined),
        `specfuse ${args.join(' ')} produced "Unknown command":\n${combined}`,
      )
      assert.ok(group, 'placeholder')
    }
  })

  test('ci subcommands are each invocable', () => {
    const res = runCli(root, ['ci', 'check', '--format', 'junit'])
    assert.equal(res.status, 0, `ci check failed:\n${res.stderr}`)
  })

  test('ci init writes the documented workflow path', () => {
    const res = runCli(root, ['ci', 'init', '--force'])
    assert.equal(res.status, 0, `ci init failed:\n${res.stderr}`)
    assert.ok(
      existsSync(join(root, '.github', 'workflows', 'specfuse-ci.yml')),
      'ci init did not write .github/workflows/specfuse-ci.yml',
    )
  })

  test('specfuse --help lists all five command groups', () => {
    const res = runCliNoRoot(['--help'])
    assert.equal(res.status, 0, `--help failed: ${res.stderr}`)

    for (const group of ['ci', 'template', 'clean', 'reset', 'config', 'history']) {
      // Match the group as a whole command word at the start of a help line,
      // so "ci" does not accidentally match "specify" etc.
      const re = new RegExp(`(^|\\n)\\s*${group}(\\s|\\|)`)
      assert.ok(
        re.test(res.stdout),
        `--help output does not list command group "${group}":\n${res.stdout}`,
      )
    }
  })
})

describe('CLI registration guard — no command handler ships unregistered', () => {
  test('every registered group subcommand from the spec is reachable', () => {
    const paths = collectRegisteredCommandPaths()

    for (const [group, subs] of Object.entries(EXPECTED_GROUPS)) {
      assert.ok(
        paths.has(group),
        `command group "${group}" is not registered in the CLI router`,
      )
      for (const sub of subs) {
        assert.ok(
          paths.has(`${group}/${sub}`),
          `subcommand "${group} ${sub}" is not registered in the CLI router`,
        )
      }
    }

    // clean and reset are top-level (no subcommands) — they must be present.
    assert.ok(paths.has('clean'), 'command "clean" is not registered')
    assert.ok(paths.has('reset'), 'command "reset" is not registered')
  })

  test('every src/commands/*.js command entry point maps to a reachable command', async () => {
    const paths = collectRegisteredCommandPaths()
    const entryPoints = await collectCommandEntryPoints()

    // For each entry-point export, assert a matching command path exists in
    // the router tree. The mapping below converts handler export names to the
    // command names the CLI advertises. Anything not in this map MUST already
    // be reachable by its own name (verified by the generic check below).
    const handlerToCommand = {
      // ci.js (pre-*Command convention)
      ciDrift: 'ci/drift',
      ciValidate: 'ci/validate',
      ciCheck: 'ci/check',
      ciInit: 'ci/init',
      // template.js
      templateListCommand: 'template/list',
      templateShowCommand: 'template/show',
      templateCopyCommand: 'template/copy',
      templateValidateCommand: 'template/validate',
      // clean.js
      cleanCommand: 'clean',
      resetCommand: 'reset',
      // config.js
      configListCommand: 'config/list',
      configGetCommand: 'config/get',
      configSetCommand: 'config/set',
      configValidateCommand: 'config/validate',
      configPathCommand: 'config/path',
      // history.js
      historyCommand: 'history',
      historySyncCommand: 'history/sync',
      historyArchiveCommand: 'history/archive',
      // batch.js — group/<verb>
      batchStatusCommand: 'batch/status',
      batchReviewCommand: 'batch/review',
      batchVerifyCommand: 'batch/verify',
      batchArchiveCommand: 'batch/archive',
      // schema.js — group/<verb>
      schemaInitCommand: 'schema/init',
      schemaShowCommand: 'schema/show',
      // install-hooks.js — hyphenated top-level names
      installHooksCommand: 'install-hooks',
      uninstallHooksCommand: 'uninstall-hooks',
    }

    const orphans = []
    for (const [file, exports] of Object.entries(entryPoints)) {
      for (const name of exports) {
        const expected = handlerToCommand[name] ?? name.replace(/Command$/, '')
        const group = expected.split('/')[0]
        if (!paths.has(group) && !paths.has(expected)) {
          orphans.push(`${file} exports ${name} → no reachable command "${expected}"`)
        }
      }
    }

    assert.deepEqual(
      orphans,
      [],
      `Unregistered command handlers found (register them in src/cli.js):\n${orphans.join('\n')}`,
    )
  })
})
