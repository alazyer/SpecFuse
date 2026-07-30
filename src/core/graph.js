/**
 * Visual Dependency Graph — rule graph generation, filtering, impact analysis, and serialization.
 *
 * The graph is derived on-the-fly from rule definitions and registry sync state.
 * No persistent graph storage is needed — rules already declare source→target mappings.
 */

import chalk from 'chalk'
import { logger } from '../utils/logger.js'

/**
 * Node type classification based on artifact path patterns.
 * @enum {string}
 */
export const NODE_TYPES = {
  plan: 'plan',
  constitution: 'constitution',
  change: 'change',
  'rule-config': 'rule-config',
  external: 'external',
}

/**
 * Determine the node type from an artifact path or ID.
 *
 * @param {string} id - Artifact ID or file path
 * @returns {string} One of NODE_TYPES
 */
export function classifyNode(id) {
  if (id.startsWith('plan:') || id.includes('.specfuse/plan/')) return NODE_TYPES.plan
  if (id === 'constitution' || id.includes('constitution.md')) return NODE_TYPES.constitution
  if (id.startsWith('changes:') || id.includes('.specfuse/changes/')) return NODE_TYPES.change
  if (id.includes('.specfuse/rules')) return NODE_TYPES['rule-config']
  // Anything under the project root that isn't in .specfuse/ is external
  if (!id.includes('.specfuse/')) return NODE_TYPES.external
  return NODE_TYPES['rule-config']
}

/**
 * Derive a human-readable label from an artifact ID or path.
 *
 * @param {string} id
 * @returns {string}
 */
export function nodeLabel(id) {
  // Handle "changes:slug" style IDs
  if (id.startsWith('changes:')) return id.slice('changes:'.length)
  // Handle "plan:arch" style IDs
  if (id.startsWith('plan:')) return id.slice('plan:'.length)
  // Handle file paths — use the filename without extension
  const base = id.split('/').pop() ?? id
  return base.replace(/\.md$/, '').replace(/\.mjs$/, '')
}

/**
 * Build the rule dependency graph from loaded rules and registry sync state.
 *
 * @param {string} projectRoot
 * @param {import('./registry.js').Registry} registry
 * @param {object[]} [rules] - Loaded rule definitions (if omitted, uses registry.getLoadedRules())
 * @returns {{ nodes: Map<string, {id: string, type: string, label: string, syncStatus: string|null}>, edges: Array<{source: string, target: string, ruleName: string, ruleType: string, lastSyncResult: string|null, enabled: boolean}> }}
 */
export function buildRuleGraph(projectRoot, registry, rules) {
  const loadedRules = rules ?? registry.getLoadedRules() ?? []
  const syncs = registry.data?.syncs ?? {}

  const nodes = new Map()
  const edges = []

  for (const rule of loadedRules) {
    const sourceId = rule.source ?? rule.id?.split('→')[0]
    const targetId = rule.target ?? rule.id?.split('→')[1]
    if (!sourceId || !targetId) continue

    // Add source node
    if (!nodes.has(sourceId)) {
      nodes.set(sourceId, {
        id: sourceId,
        type: classifyNode(sourceId),
        label: nodeLabel(sourceId),
        syncStatus: null,
      })
    }

    // Add target node (for multi-target rules, use the directory-level ID)
    const targetKey = rule.isMultiTarget ? targetId : targetId
    if (!nodes.has(targetKey)) {
      nodes.set(targetKey, {
        id: targetKey,
        type: classifyNode(targetKey),
        label: nodeLabel(targetKey),
        syncStatus: null,
      })
    }

    // Look up last sync result
    const syncKey = `${sourceId}→${targetId}`
    const syncEntry = syncs[syncKey] ?? null
    let lastSyncResult = null
    if (syncEntry) {
      lastSyncResult = syncEntry.sourceHash === syncEntry.targetHash ? 'in_sync' : 'drifted'
    }

    // Enrich node sync status
    const sourceNode = nodes.get(sourceId)
    if (syncEntry && !sourceNode.syncStatus) {
      sourceNode.syncStatus = lastSyncResult
    }

    edges.push({
      source: sourceId,
      target: targetKey,
      ruleName: rule.id,
      ruleType: rule.pass ?? 'A',
      lastSyncResult,
      enabled: true,
    })
  }

  // Also check syncs for any additional nodes not covered by rules
  for (const [syncKey, syncEntry] of Object.entries(syncs)) {
    const [src, tgt] = syncKey.split('→')
    if (src && !nodes.has(src)) {
      nodes.set(src, {
        id: src,
        type: classifyNode(src),
        label: nodeLabel(src),
        syncStatus: null,
      })
    }
    if (tgt && !nodes.has(tgt)) {
      nodes.set(tgt, {
        id: tgt,
        type: classifyNode(tgt),
        label: nodeLabel(tgt),
        syncStatus: null,
      })
    }
  }

  return { nodes, edges }
}

/**
 * Filter the graph to only include nodes/edges connected to a specific artifact.
 * Matches exactly first, then falls back to substring match with a warning.
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @param {string} artifactName
 * @returns {{ graph: { nodes: Map, edges: Array }, exact: boolean }}
 */
export function filterByArtifact(graph, artifactName) {
  const { nodes, edges } = graph

  // Try exact match first
  let matchedIds = new Set()
  for (const [id] of nodes) {
    if (id === artifactName) {
      matchedIds.add(id)
    }
  }

  let exact = matchedIds.size > 0

  // Fall back to substring match
  if (!exact) {
    for (const [id, node] of nodes) {
      if (id.includes(artifactName) || node.label.includes(artifactName)) {
        matchedIds.add(id)
      }
    }
    if (matchedIds.size > 0) {
      logger.warn(`No exact match for "${artifactName}". Using substring match: ${[...matchedIds].join(', ')}`)
    }
  }

  // Build subgraph
  const filteredNodes = new Map()
  const filteredEdges = []

  for (const id of matchedIds) {
    const node = nodes.get(id)
    if (node) filteredNodes.set(id, node)
  }

  for (const edge of edges) {
    if (matchedIds.has(edge.source) || matchedIds.has(edge.target)) {
      // Add the other end of the edge too
      if (!matchedIds.has(edge.source) && nodes.has(edge.source)) {
        filteredNodes.set(edge.source, nodes.get(edge.source))
      }
      if (!matchedIds.has(edge.target) && nodes.has(edge.target)) {
        filteredNodes.set(edge.target, nodes.get(edge.target))
      }
      filteredEdges.push(edge)
    }
  }

  return { graph: { nodes: filteredNodes, edges: filteredEdges }, exact }
}

/**
 * Compute forward impact from a source file — BFS reachability.
 * Returns a subgraph of all reachable nodes with `affected: true` flag.
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @param {string} filePath - Source file path or artifact ID to trace from
 * @returns {{ graph: { nodes: Map, edges: Array }, found: boolean }}
 */
export function computeImpact(graph, filePath) {
  const { nodes, edges } = graph

  // Find the starting node — try exact match then substring
  let startId = null
  for (const [id] of nodes) {
    if (id === filePath) {
      startId = id
      break
    }
  }
  if (!startId) {
    for (const [id, node] of nodes) {
      if (id.includes(filePath) || node.label.includes(filePath)) {
        startId = id
        break
      }
    }
  }

  if (!startId) {
    return { graph: { nodes: new Map(), edges: [] }, found: false }
  }

  // BFS forward traversal
  const visited = new Set()
  const queue = [startId]
  visited.add(startId)

  while (queue.length > 0) {
    const current = queue.shift()
    for (const edge of edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        visited.add(edge.target)
        queue.push(edge.target)
      }
    }
  }

  // Build impact subgraph
  const impactNodes = new Map()
  const impactEdges = []

  for (const id of visited) {
    const node = nodes.get(id)
    if (node) {
      impactNodes.set(id, { ...node, affected: true })
    }
  }

  for (const edge of edges) {
    if (visited.has(edge.source) && visited.has(edge.target)) {
      impactEdges.push(edge)
    }
  }

  return { graph: { nodes: impactNodes, edges: impactEdges }, found: true }
}

// ── Serializers ─────────────────────────────────────────────────────────────

/** DOT shape for each node type */
const DOT_SHAPES = {
  [NODE_TYPES.plan]: 'box',
  [NODE_TYPES.constitution]: 'diamond',
  [NODE_TYPES.change]: 'ellipse',
  [NODE_TYPES['rule-config']]: 'note',
  [NODE_TYPES.external]: 'box3d',
}

/** DOT fill color for each node type */
const DOT_COLORS = {
  [NODE_TYPES.plan]: '#D5E8D4',
  [NODE_TYPES.constitution]: '#DAE8FC',
  [NODE_TYPES.change]: '#FFF2CC',
  [NODE_TYPES['rule-config']]: '#E1D5E7',
  [NODE_TYPES.external]: '#F5F5F5',
}

const AFFECTED_FILL = '#F8CECC'

/**
 * Serialize graph to DOT (Graphviz) format.
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @returns {string}
 */
export function toDot(graph) {
  const { nodes, edges } = graph
  const lines = ['digraph specfuse {', '  rankdir=LR;', '  node [style=filled,fontname="Arial"];', '']

  for (const [id, node] of nodes) {
    const shape = DOT_SHAPES[node.type] ?? 'box'
    const fill = node.affected ? AFFECTED_FILL : (DOT_COLORS[node.type] ?? '#FFFFFF')
    const attrs = [`shape=${shape}`, `fillcolor="${fill}"`, `label="${node.label}"`]
    lines.push(`  "${id}" [${attrs.join(',')}];`)
  }

  lines.push('')

  for (const edge of edges) {
    const attrs = [`label="${edge.ruleName}"`]
    if (edge.ruleType) attrs.push(`fontsize=9,fontcolor=gray`)
    if (!edge.enabled) attrs.push('style=dashed')
    lines.push(`  "${edge.source}" -> "${edge.target}" [${attrs.join(',')}];`)
  }

  lines.push('}')
  return lines.join('\n')
}

/**
 * Serialize graph to Mermaid flowchart syntax.
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @returns {string}
 */
export function toMermaid(graph) {
  const { nodes, edges } = graph
  const lines = ['flowchart LR']
  const hasAffected = [...nodes.values()].some((n) => n.affected)

  // Group nodes by type using subgraphs
  const byType = new Map()
  for (const [id, node] of nodes) {
    if (!byType.has(node.type)) byType.set(node.type, [])
    byType.get(node.type).push({ id, node })
  }

  for (const [type, entries] of byType) {
    lines.push(`  subgraph ${type}`)
    for (const { id, node } of entries) {
      const label = node.label.replace(/"/g, "'")
      const suffix = node.affected ? ':::affected' : ''
      lines.push(`    "${id}"${suffix}["${label}"]`)
    }
    lines.push('  end')
  }

  lines.push('')

  for (const edge of edges) {
    const style = !edge.enabled ? '-.->' : '-->'
    lines.push(`  "${edge.source}" ${style}|"${edge.ruleName}"| "${edge.target}"`)
  }

  if (hasAffected) {
    lines.push('')
    lines.push('  classDef affected fill:#F8CECC,stroke:#CC0000,stroke-width:2px;')
  }

  return lines.join('\n')
}

/**
 * Serialize graph to a JSON-friendly object.
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @returns {{ nodes: Array, edges: Array }}
 */
export function toJson(graph) {
  const { nodes, edges } = graph
  return {
    nodes: [...nodes.values()].map(({ id, type, label, syncStatus, affected }) => ({
      id,
      type,
      label,
      ...(syncStatus ? { syncStatus } : {}),
      ...(affected ? { affected: true } : {}),
    })),
    edges: edges.map(({ source, target, ruleName, ruleType, lastSyncResult, enabled }) => ({
      source,
      target,
      ruleName,
      ruleType,
      ...(lastSyncResult ? { lastSyncResult } : {}),
      ...(enabled === false ? { enabled: false } : {}),
    })),
  }
}

/**
 * Format graph as a human-readable summary table.
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @returns {string}
 */
export function formatGraphTable(graph) {
  const { nodes, edges } = graph
  const lines = []

  if (nodes.size === 0) {
    return 'No rules found — nothing to graph.'
  }

  lines.push(chalk.bold('Nodes:') + ` ${nodes.size}`)
  const typeCounts = new Map()
  for (const [, node] of nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1)
  }
  for (const [type, count] of typeCounts) {
    lines.push(`  ${chalk.dim(type.padEnd(14))}${count}`)
  }

  lines.push('')
  lines.push(chalk.bold('Edges:') + ` ${edges.length}`)
  for (const edge of edges) {
    const arrow = edge.enabled ? '→' : '⇢'
    const syncBadge = edge.lastSyncResult === 'in_sync'
      ? chalk.green('✓')
      : edge.lastSyncResult === 'drifted'
        ? chalk.red('✗')
        : chalk.dim('·')
    lines.push(
      `  ${chalk.cyan(edge.source)} ${arrow} ${chalk.yellow(edge.target)}  ${syncBadge}  ${chalk.dim(edge.ruleName)} [Pass ${edge.ruleType}]`,
    )
  }

  return lines.join('\n')
}

/**
 * Format graph as JSON string (machine-readable default view).
 *
 * @param {{ nodes: Map, edges: Array }} graph
 * @returns {string}
 */
export function formatGraphJson(graph) {
  return JSON.stringify(toJson(graph), null, 2)
}
