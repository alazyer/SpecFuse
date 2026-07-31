/**
 * SpecFuse CI Programmatic API
 *
 * Embed SpecFuse CI operations in other Node.js tools without spawning a subprocess.
 *
 * @example
 * import { drift, validate, check, init } from 'specfuse/api/ci.mjs';
 *
 * const { exitCode, output } = await drift({ root: './my-project', format: 'junit' });
 * const { results } = await validate({ root: './my-project', format: 'sarif' });
 * const { path, created } = await init({ github: true });
 */

import { resolve } from 'path'
import { ciDrift, ciValidate, ciCheck, ciInit } from '../commands/ci.js'
import { formatAuto, formatGitHub, formatJUnit, formatSarif, detectFormat } from '../core/ci-output.js'

/**
 * Run drift check with CI-optimized output.
 *
 * @param {{ root?: string, format?: 'github'|'junit'|'sarif'|'auto', allowPlugins?: boolean }} [options]
 * @returns {Promise<{ results: object[], exitCode: number, output: string }>}
 */
export async function drift(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  return ciDrift(projectRoot, {
    format: options.format ?? 'auto',
    allowPlugins: options.allowPlugins,
  })
}

/**
 * Run validation with CI-optimized output.
 *
 * @param {{ root?: string, format?: 'github'|'junit'|'sarif'|'auto', artifact?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<{ results: object[], exitCode: number, output: string }>}
 */
export async function validate(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  return ciValidate(projectRoot, {
    format: options.format ?? 'auto',
    artifact: options.artifact,
  })
}

/**
 * Combined drift + validation check.
 *
 * @param {{ root?: string, format?: 'github'|'junit'|'sarif'|'auto', artifact?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<{ driftResults: object[], validateResults: object[], exitCode: number, output: string }>}
 */
export async function check(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  return ciCheck(projectRoot, {
    format: options.format ?? 'auto',
    artifact: options.artifact,
    allowPlugins: options.allowPlugins,
  })
}

/**
 * Generate a GitHub Actions workflow file.
 *
 * @param {{ root?: string, output?: string, force?: boolean }} [options]
 * @returns {Promise<{ path: string, created: boolean }>}
 */
export async function init(options = {}) {
  const projectRoot = resolve(options.root ?? '.')
  return ciInit(projectRoot, {
    github: options.github ?? true,
    output: options.output,
    force: options.force,
  })
}

// Re-export formatters for advanced usage
export { formatAuto, formatGitHub, formatJUnit, formatSarif, detectFormat }

export default { drift, validate, check, init, formatAuto, formatGitHub, formatJUnit, formatSarif, detectFormat }
