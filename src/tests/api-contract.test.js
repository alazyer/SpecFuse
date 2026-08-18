/**
 * Contract tests for the public API surface.
 *
 * Guards two architectural contracts from the `api-surface` spec:
 *   (A) Exports-map contract — every `src/api/*.mjs` module is listed in
 *       `package.json` `exports` and resolvable via the `specfuse/api/<name>.mjs`
 *       package subpath; the umbrella `src/api.mjs` re-exports every documented
 *       namespace, and the default export exposes each as a property.
 *   (B) API-layering contract — no module under `src/api/*.mjs` imports from
 *       `src/commands/*` (core → API → CLI layering is preserved).
 *   (C) Docs-accuracy spot check — the exact import paths documented in
 *       `docs/ci-integration.md` and `docs/template-customization.md` resolve.
 *
 * These tests fail closed: adding a new `src/api/*.mjs` module without an
 * `exports` entry, or importing from `src/commands/*` in an API module,
 * will fail the suite.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Every public API module under src/api/ that MUST be exported. */
function listApiModules() {
  return readdirSync(join(REPO_ROOT, 'src', 'api'))
    .filter((f) => f.endsWith('.mjs'))
    .sort()
}

/** Read a file's contents as a UTF-8 string. */
function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8')
}

/** Extract import source specifiers from a module's source text. */
function extractImportSources(source) {
  const sources = []
  // `import ... from '...'` and `import('...')` — both static and dynamic.
  const importFrom = /import\s+(?:[\s\S]*?\s+from\s+|)['"]([^'"]+)['"]/g
  let match
  while ((match = importFrom.exec(source)) !== null) {
    sources.push(match[1])
  }
  return sources
}

// ─── (A) Exports-map contract ────────────────────────────────────────────────

describe('exports-map contract', () => {
  test('package.json exports every src/api/*.mjs module', async () => {
    const pkg = JSON.parse(readRepoFile('package.json'))
    const exportKeys = Object.keys(pkg.exports)
    const apiModules = listApiModules()

    // Sanity: the test set is non-empty so a misconfigured glob doesn't pass silently.
    assert.ok(apiModules.length >= 15, `expected ~15+ API modules, found ${apiModules.length}`)

    for (const file of apiModules) {
      const subpath = `./api/${file}`
      assert.ok(
        exportKeys.includes(subpath),
        `package.json exports is missing "${subpath}" — every src/api/*.mjs module must be listed (closed exports map).`,
      )
    }
  })

  test('every src/api/*.mjs resolves via the specfuse/api/<name>.mjs package subpath', async () => {
    const apiModules = listApiModules()
    for (const file of apiModules) {
      const subpath = `specfuse/api/${file}`
      // Dynamic import exercises the exports map (would throw
      // ERR_PACKAGE_PATH_NOT_EXPORTED if the subpath is unlisted).
      const mod = await import(subpath)
      assert.ok(mod, `import('${subpath}') resolved but returned a null module`)
      assert.ok(
        typeof mod === 'object',
        `import('${subpath}') should yield a module namespace object`,
      )
    }
  })

  test('documented CI API import resolves and exposes callable functions', async () => {
    const { drift, validate, check, init } = await import('specfuse/api/ci.mjs')
    for (const [name, fn] of Object.entries({ drift, validate, check, init })) {
      assert.equal(typeof fn, 'function', `ci API export "${name}" must be a callable function`)
    }
  })

  test('umbrella api.mjs re-exports the full documented namespace surface', async () => {
    const umbrella = await import('specfuse/api.mjs')
    const documentedNamespaces = [
      'plan',
      'specify',
      'change',
      'schema',
      'batch',
      'graph',
      'bundle',
      'lint',
      'ci',
      'clean',
      'config',
      'history',
      'template',
    ]
    for (const ns of documentedNamespaces) {
      assert.ok(
        ns in umbrella,
        `umbrella api.mjs is missing documented namespace "${ns}"`,
      )
      assert.equal(
        typeof umbrella[ns],
        'object',
        `umbrella api.mjs namespace "${ns}" must be an object, got ${typeof umbrella[ns]}`,
      )
    }

    // `resolve` is documented as a top-level function (not a namespace object).
    assert.equal(typeof umbrella.resolve, 'function', 'umbrella api.mjs must export `resolve` as a function')
  })

  test('documented template API import resolves as a namespaced object', async () => {
    const { template } = await import('specfuse/api.mjs')
    assert.equal(typeof template, 'object', '`template` must be a namespaced API object')
    assert.ok(
      Object.keys(template).length > 0,
      '`template` namespace must expose documented methods',
    )
  })

  test('default export exposes every documented namespace as a property', async () => {
    const { default: def } = await import('specfuse/api.mjs')
    assert.equal(typeof def, 'object', 'default export must be an object')
    const documentedNamespaces = [
      'plan',
      'specify',
      'change',
      'schema',
      'batch',
      'graph',
      'bundle',
      'lint',
      'ci',
      'clean',
      'config',
      'history',
      'template',
      'resolve',
    ]
    for (const ns of documentedNamespaces) {
      assert.ok(
        ns in def,
        `default export is missing documented namespace "${ns}" as a property`,
      )
    }
  })
})

// ─── (B) API-layering contract ───────────────────────────────────────────────

describe('API-layering contract', () => {
  test('no src/api/*.mjs module imports from src/commands/*', () => {
    const apiModules = listApiModules()
    const violations = []

    for (const file of apiModules) {
      const source = readRepoFile(join('src', 'api', file))
      const sources = extractImportSources(source)
      for (const spec of sources) {
        // Match any import whose specifier reaches into the command layer:
        // `../commands/...`, `../../commands/...`, `src/commands/...`, or a
        // bare `...commands/...` segment.
        const reachesCommands =
          /(^|[/])commands[/]/.test(spec) || /(^|\.\.[/])+commands[/]/.test(spec)
        if (reachesCommands) {
          violations.push(`${file} imports "${spec}"`)
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `API modules must not import from src/commands/* (core → API → CLI layering). Violations:\n${violations.join('\n')}`,
    )
  })

  test('src/api/ci.mjs specifically does not import from ../commands/ci.js', () => {
    const source = readRepoFile(join('src', 'api', 'ci.mjs'))
    const sources = extractImportSources(source)
    const commandsImports = sources.filter((s) => s.includes('commands/ci.js') || s.includes('commands/'))
    assert.deepEqual(
      commandsImports,
      [],
      `src/api/ci.mjs must not import from the command layer; found: ${commandsImports.join(', ')}`,
    )
  })
})

// ─── (C) Docs-accuracy spot check ────────────────────────────────────────────

describe('docs-accuracy imports', () => {
  test('docs/ci-integration.md CI API import resolves', async () => {
    // docs/ci-integration.md:125
    const mod = await import('specfuse/api/ci.mjs')
    for (const name of ['drift', 'validate', 'check', 'init']) {
      assert.equal(typeof mod[name], 'function', `documented CI export "${name}" must be callable`)
    }
  })

  test('docs/ci-integration.md formatter imports resolve', async () => {
    // docs/ci-integration.md:153-159
    const mod = await import('specfuse/api/ci.mjs')
    for (const name of ['formatGitHub', 'formatJUnit', 'formatSarif', 'formatAuto', 'detectFormat']) {
      assert.equal(typeof mod[name], 'function', `documented formatter export "${name}" must be callable`)
    }
  })

  test('docs/template-customization.md umbrella template import resolves', async () => {
    // docs/template-customization.md:180
    const { template } = await import('specfuse/api.mjs')
    assert.equal(typeof template, 'object', 'documented `template` namespace must resolve from the umbrella')
    assert.ok(Object.keys(template).length > 0, '`template` namespace must expose documented methods')
  })
})

// ─── (D) Error-typing contract ───────────────────────────────────────────────
//
// The API layer's documented contract is that "All API functions throw
// subclasses of SpecFuseApiError." This block closes the gate two ways:
//   1. A static source scan: no `src/api/*.mjs` module may contain the literal
//      `throw new Error(`. Core modules are covered by the per-site instanceof
//      assertions below, not the scan (core may legitimately throw in paths
//      not reached through the API).
//   2. Per-site instanceof assertions exercising each retrofitted throw path.

describe('error-typing contract', () => {
  test('no src/api/*.mjs module throws a plain `new Error(...)`', () => {
    const apiModules = listApiModules()
    const offenders = []

    for (const file of apiModules) {
      const source = readRepoFile(join('src', 'api', file))
      if (source.includes('throw new Error(')) {
        offenders.push(file)
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `API modules must throw SpecFuseApiError subclasses, never plain Error. ` +
        `Found \`throw new Error(\` in:\n${offenders.join('\n')}`,
    )
  })

  test('resolve() with missing ruleId throws InvalidArgumentError (and SpecFuseApiError)', async () => {
    const { resolve } = await import('../api/sync-ops.mjs')
    const { InvalidArgumentError, SpecFuseApiError } = await import('../api/errors.mjs')
    await assert.rejects(
      resolve({ ruleId: '', choice: 'source' }),
      (err) => err instanceof InvalidArgumentError && err instanceof SpecFuseApiError,
    )
  })

  test('malformed artifact schema throws SchemaValidationError (and SpecFuseApiError)', async () => {
    const { loadArtifactSchema } = await import('../core/artifact-schema.js')
    const { SchemaValidationError, SpecFuseApiError } = await import('../api/errors.mjs')
    const dir = mkdtempSync(join(tmpdir(), 'specfuse-err-contract-'))
    try {
      const schemaPath = join(dir, 'artifact-schema.json')
      writeFileSync(schemaPath, JSON.stringify({ artifacts: { 'change.proposal': { instructions: [123] } } }))
      await assert.rejects(
        loadArtifactSchema(dir, { schemaPath }),
        (err) => err instanceof SchemaValidationError && err instanceof SpecFuseApiError,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('registry.save() before load() throws RegistryError (and SpecFuseApiError)', async () => {
    const { Registry } = await import('../core/registry.js')
    const { RegistryError, SpecFuseApiError } = await import('../api/errors.mjs')
    const dir = mkdtempSync(join(tmpdir(), 'specfuse-err-contract-'))
    try {
      const registry = new Registry(dir)
      await assert.rejects(
        registry.save(),
        (err) => err instanceof RegistryError && err instanceof SpecFuseApiError,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('formatAuto with unsupported format throws CiUnsupportedModeError (and SpecFuseApiError)', async () => {
    const { formatAuto } = await import('../core/ci-output.js')
    const { CiUnsupportedModeError, SpecFuseApiError } = await import('../api/errors.mjs')
    assert.throws(
      () => formatAuto({ results: [] }, { format: 'csv' }),
      (err) => err instanceof CiUnsupportedModeError && err instanceof SpecFuseApiError,
    )
  })
})
