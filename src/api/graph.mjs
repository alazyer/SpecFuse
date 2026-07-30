/**
 * Graph API — programmatic access to rule dependency graphs and impact analysis.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath } from 'path'
import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import {
  buildRuleGraph,
  filterByArtifact,
  computeImpact,
  toDot,
  toMermaid,
  toJson,
} from '../core/graph.js'

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * Generate a rule dependency graph.
 *
 * @param {string} root - Project root path
 * @param {{ format?: 'dot'|'mermaid'|'json', artifact?: string, allowPlugins?: boolean }} [options]
 * @returns {Promise<string|object>} String for dot/mermaid, object for json
 */
export async function generate(root, options = {}) {
  const projectRoot = resolveRoot(root)
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  let graph = buildRuleGraph(projectRoot, registry, rules)

  if (graph.nodes.size === 0) {
    throw new GraphEmptyError('No rules found — nothing to graph.')
  }

  if (options.artifact) {
    const result = filterByArtifact(graph, options.artifact)
    graph = result.graph
    if (graph.nodes.size === 0) {
      throw new GraphEmptyError(`No artifacts found matching "${options.artifact}".`)
    }
  }

  const format = options.format ?? 'dot'
  if (format === 'dot') return toDot(graph)
  if (format === 'mermaid') return toMermaid(graph)
  if (format === 'json') return toJson(graph)

  throw new SpecFuseApiError(`Unknown format: ${format}. Use 'dot', 'mermaid', or 'json'.`)
}

/**
 * Perform forward impact analysis from a source file.
 *
 * @param {string} root - Project root path
 * @param {string} filePath - Source file to trace from
 * @param {{ format?: 'dot'|'mermaid'|'json', allowPlugins?: boolean }} [options]
 * @returns {Promise<string|object>} String for dot/mermaid, object for json
 */
export async function impact(root, filePath, options = {}) {
  const projectRoot = resolveRoot(root)
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  const graph = buildRuleGraph(projectRoot, registry, rules)

  const result = computeImpact(graph, filePath)
  if (!result.found) {
    throw new ArtifactNotFoundError(
      `File not found in rule graph — no impact path exists: ${filePath}`,
      { path: filePath },
    )
  }

  const format = options.format ?? 'dot'
  if (format === 'dot') return toDot(result.graph)
  if (format === 'mermaid') return toMermaid(result.graph)
  if (format === 'json') return toJson(result.graph)

  throw new SpecFuseApiError(`Unknown format: ${format}. Use 'dot', 'mermaid', or 'json'.`)
}

/**
 * Serialize a graph object to DOT format.
 *
 * @param {{ nodes: Map, edges: Array }} graphObj
 * @returns {string}
 */
export function dot(graphObj) {
  return toDot(graphObj)
}

/**
 * Serialize a graph object to Mermaid flowchart syntax.
 *
 * @param {{ nodes: Map, edges: Array }} graphObj
 * @returns {string}
 */
export function mermaid(graphObj) {
  return toMermaid(graphObj)
}

/**
 * Serialize a graph object to JSON.
 *
 * @param {{ nodes: Map, edges: Array }} graphObj
 * @returns {{ nodes: Array, edges: Array }}
 */
export function json(graphObj) {
  return toJson(graphObj)
}

// ── Error classes ──────────────────────────────────────────────────────────────

import { SpecFuseApiError, ArtifactNotFoundError } from './errors.mjs'

/**
 * Thrown when a graph operation finds no rules or artifacts to graph.
 */
export class GraphEmptyError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'GraphEmptyError'
  }
}

export { SpecFuseApiError, ArtifactNotFoundError }
