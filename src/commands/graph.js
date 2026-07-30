/**
 * Graph CLI command — visualize rule dependency graphs and perform impact analysis.
 */

import chalk from 'chalk'
import { Registry } from '../core/registry.js'
import { loadRules } from '../core/rule-loader.js'
import {
  buildRuleGraph,
  filterByArtifact,
  computeImpact,
  toDot,
  toMermaid,
  toJson,
  formatGraphTable,
  formatGraphJson,
} from '../core/graph.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import { writeFileAtomic } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

/**
 * Main graph command handler.
 *
 * @param {string} projectRoot
 * @param {{ mermaid?: boolean, json?: boolean, artifact?: string, impact?: string, output?: string, allowPlugins?: boolean }} [options]
 */
export async function graphCommand(projectRoot, options = {}) {
  const registry = new Registry(projectRoot)
  await registry.load()

  const rules = await loadRules(projectRoot, { allowPlugins: options.allowPlugins })
  let graph = buildRuleGraph(projectRoot, registry, rules)
  let isImpact = false

  // Apply --artifact filter
  if (options.artifact) {
    const result = filterByArtifact(graph, options.artifact)
    graph = result.graph
    if (graph.nodes.size === 0) {
      logger.warn(`No artifacts found matching "${options.artifact}".`)
      logger.br()
      return
    }
  }

  // Apply --impact analysis
  if (options.impact) {
    const result = computeImpact(graph, options.impact)
    if (!result.found) {
      logger.warn(`File not found in rule graph — no impact path exists: ${options.impact}`)
      logger.br()
      return
    }
    graph = result.graph
    isImpact = true
    recordEvent(registry, EVENT_TYPES.graph_impact, `Impact analysis for: ${options.impact}`, {
      file: options.impact,
      affectedNodes: graph.nodes.size,
    })
  }

  // Record graph_generate event (unless impact already recorded one)
  if (!isImpact) {
    recordEvent(registry, EVENT_TYPES.graph_generate, 'Generated dependency graph', {
      nodes: graph.nodes.size,
      edges: graph.edges.length,
      format: options.mermaid ? 'mermaid' : options.json ? 'json' : 'dot',
    })
  }

  // Select serializer
  let output
  if (options.mermaid) {
    output = toMermaid(graph)
  } else if (options.json) {
    output = formatGraphJson(graph)
  } else if (graph.nodes.size === 0) {
    // No format flag and empty graph — human-friendly message
    output = null
  } else {
    output = toDot(graph)
  }

  // Handle empty graph with no format flag
  if (output === null) {
    logger.info(chalk.dim('No rules found — nothing to graph.'))
    logger.br()
    await registry.save()
    return
  }

  // Output
  if (options.output) {
    await writeFileAtomic(options.output, output + '\n')
    logger.success(`Graph written to ${options.output}`)
    logger.br()
  } else {
    console.log(output)
  }

  await registry.save()
}
