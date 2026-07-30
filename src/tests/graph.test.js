/**
 * Tests for the Visual Dependency Graph feature.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { Registry } from '../core/registry.js'
import {
  buildRuleGraph,
  filterByArtifact,
  computeImpact,
  toDot,
  toMermaid,
  toJson,
  formatGraphTable,
  formatGraphJson,
  classifyNode,
  nodeLabel,
  NODE_TYPES,
} from '../core/graph.js'
import {
  recordEvent,
  getHistory,
  EVENT_TYPES,
} from '../core/history.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '.test-fixtures', 'graph')

// Sample rule definitions for testing
const SAMPLE_RULES = [
  {
    id: 'plan:arch→constitution:plan-decisions',
    pass: 'A',
    source: '.specfuse/plan/architecture.md',
    sources: ['.specfuse/plan/architecture.md'],
    target: '.specfuse/constitution.md',
    section: 'plan-decisions',
  },
  {
    id: 'plan:prd→constitution:plan-prd',
    pass: 'A',
    source: '.specfuse/plan/prd.md',
    sources: ['.specfuse/plan/prd.md'],
    target: '.specfuse/constitution.md',
    section: 'plan-prd',
  },
  {
    id: 'plan:stories→constitution:user-stories',
    pass: 'A',
    source: '.specfuse/plan/stories',
    sources: ['.specfuse/plan/stories'],
    target: '.specfuse/constitution.md',
    section: 'user-stories',
  },
  {
    id: 'constitution→changes:proposal-headers',
    pass: 'B',
    source: '.specfuse/constitution.md',
    sources: ['.specfuse/constitution.md'],
    target: '.specfuse/changes',
    section: 'constitution-header',
    isMultiTarget: true,
  },
]

// ── classifyNode and nodeLabel ──────────────────────────────────────────────────

describe('Graph — classifyNode', () => {
  it('classifies plan artifacts', () => {
    assert.strictEqual(classifyNode('plan:arch'), NODE_TYPES.plan)
    assert.strictEqual(classifyNode('.specfuse/plan/prd.md'), NODE_TYPES.plan)
  })

  it('classifies constitution', () => {
    assert.strictEqual(classifyNode('constitution'), NODE_TYPES.constitution)
    assert.strictEqual(classifyNode('.specfuse/constitution.md'), NODE_TYPES.constitution)
  })

  it('classifies change artifacts', () => {
    assert.strictEqual(classifyNode('changes:add-login'), NODE_TYPES.change)
    assert.strictEqual(classifyNode('.specfuse/changes/add-login/proposal.md'), NODE_TYPES.change)
  })

  it('classifies rule config', () => {
    assert.strictEqual(classifyNode('.specfuse/rules.mjs'), NODE_TYPES['rule-config'])
  })

  it('classifies external paths', () => {
    assert.strictEqual(classifyNode('src/api/auth.ts'), NODE_TYPES.external)
  })
})

describe('Graph — nodeLabel', () => {
  it('extracts label from changes: prefix', () => {
    assert.strictEqual(nodeLabel('changes:add-login'), 'add-login')
  })

  it('extracts label from plan: prefix', () => {
    assert.strictEqual(nodeLabel('plan:arch'), 'arch')
  })

  it('extracts label from file path', () => {
    assert.strictEqual(nodeLabel('.specfuse/plan/prd.md'), 'prd')
    assert.strictEqual(nodeLabel('.specfuse/constitution.md'), 'constitution')
  })

  it('handles bare strings', () => {
    assert.strictEqual(nodeLabel('constitution'), 'constitution')
  })
})

// ── buildRuleGraph ──────────────────────────────────────────────────────────

describe('Graph — buildRuleGraph', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-build-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('builds graph from sample rules', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)

    assert.ok(graph.nodes.size >= 3, `Expected at least 3 nodes, got ${graph.nodes.size}`)
    assert.strictEqual(graph.edges.length, 4, `Expected 4 edges, got ${graph.edges.length}`)

    // Check that key nodes exist
    assert.ok(graph.nodes.has('.specfuse/plan/architecture.md'))
    assert.ok(graph.nodes.has('.specfuse/constitution.md'))
    assert.ok(graph.nodes.has('.specfuse/changes'))
  })

  it('returns empty graph with no rules', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()

    const graph = buildRuleGraph(projectRoot, registry, [])

    assert.strictEqual(graph.nodes.size, 0)
    assert.strictEqual(graph.edges.length, 0)
  })

  it('sets correct node metadata — type and label', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)

    const archNode = graph.nodes.get('.specfuse/plan/architecture.md')
    assert.ok(archNode)
    assert.strictEqual(archNode.type, NODE_TYPES.plan)
    assert.strictEqual(archNode.label, 'architecture')

    const constNode = graph.nodes.get('.specfuse/constitution.md')
    assert.ok(constNode)
    assert.strictEqual(constNode.type, NODE_TYPES.constitution)
    assert.strictEqual(constNode.label, 'constitution')
  })

  it('records edge ruleType and ruleName', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)

    const archEdge = graph.edges.find((e) => e.ruleName === 'plan:arch→constitution:plan-decisions')
    assert.ok(archEdge)
    assert.strictEqual(archEdge.ruleType, 'A')
    assert.strictEqual(archEdge.source, '.specfuse/plan/architecture.md')
    assert.strictEqual(archEdge.target, '.specfuse/constitution.md')
  })

  it('detects sync status from registry syncs', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    // Record a sync
    registry.recordSync(
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'abc123',
      'abc123', // same hash = in_sync
    )

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)

    const archEdge = graph.edges.find((e) => e.ruleName === 'plan:arch→constitution:plan-decisions')
    assert.ok(archEdge)
    assert.strictEqual(archEdge.lastSyncResult, 'in_sync')
  })

  it('detects drifted sync status', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    registry.recordSync(
      '.specfuse/plan/architecture.md',
      '.specfuse/constitution.md',
      'abc123',
      'def456', // different hash = drifted
    )

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)

    const archEdge = graph.edges.find((e) => e.ruleName === 'plan:arch→constitution:plan-decisions')
    assert.ok(archEdge)
    assert.strictEqual(archEdge.lastSyncResult, 'drifted')
  })
})

// ── filterByArtifact ──────────────────────────────────────────────────────────

describe('Graph — filterByArtifact', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-filter-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('returns only connected subgraph for exact match', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const fullGraph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    const { graph, exact } = filterByArtifact(fullGraph, '.specfuse/plan/architecture.md')

    assert.strictEqual(exact, true)
    // Should include architecture.md, constitution.md, and the edge between them
    assert.ok(graph.nodes.has('.specfuse/plan/architecture.md'))
    assert.ok(graph.nodes.has('.specfuse/constitution.md'))
    // Should also include the constitution→changes edge since constitution is connected
    assert.ok(graph.edges.length >= 1)
  })

  it('falls back to substring match when no exact match', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const fullGraph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    const { graph, exact } = filterByArtifact(fullGraph, 'architecture')

    assert.strictEqual(exact, false)
    assert.ok(graph.nodes.size > 0)
  })

  it('returns empty graph for non-existent artifact', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const fullGraph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    const { graph } = filterByArtifact(fullGraph, 'nonexistent-artifact-xyz')

    assert.strictEqual(graph.nodes.size, 0)
    assert.strictEqual(graph.edges.length, 0)
  })
})

// ── computeImpact ──────────────────────────────────────────────────────────

describe('Graph — computeImpact', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-impact-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('traces forward from source file to all reachable targets', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    const result = computeImpact(graph, '.specfuse/plan/architecture.md')

    assert.strictEqual(result.found, true)
    // architecture → constitution → changes (full forward chain)
    assert.ok(result.graph.nodes.has('.specfuse/plan/architecture.md'))
    assert.ok(result.graph.nodes.has('.specfuse/constitution.md'))
    assert.ok(result.graph.nodes.has('.specfuse/changes'))
    // All nodes in impact should be affected
    for (const [, node] of result.graph.nodes) {
      assert.strictEqual(node.affected, true)
    }
  })

  it('returns single-node graph for leaf node with no downstream effects', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    // .specfuse/changes is a target with no outgoing edges
    const result = computeImpact(graph, '.specfuse/changes')

    assert.strictEqual(result.found, true)
    assert.strictEqual(result.graph.nodes.size, 1)
    assert.ok(result.graph.nodes.has('.specfuse/changes'))
    assert.strictEqual(result.graph.edges.length, 0)
  })

  it('returns found=false for non-existent file', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    const result = computeImpact(graph, 'nonexistent-file.ts')

    assert.strictEqual(result.found, false)
    assert.strictEqual(result.graph.nodes.size, 0)
    assert.strictEqual(result.graph.edges.length, 0)
  })

  it('handles circular dependencies without infinite loops', async () => {
    const circularRules = [
      {
        id: 'A→B',
        pass: 'A',
        source: 'nodeA',
        target: 'nodeB',
        section: 'sec1',
      },
      {
        id: 'B→A',
        pass: 'B',
        source: 'nodeB',
        target: 'nodeA',
        section: 'sec2',
      },
    ]

    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(circularRules)

    const graph = buildRuleGraph(projectRoot, registry, circularRules)
    const result = computeImpact(graph, 'nodeA')

    assert.strictEqual(result.found, true)
    assert.ok(result.graph.nodes.has('nodeA'))
    assert.ok(result.graph.nodes.has('nodeB'))
  })
})

// ── toDot ──────────────────────────────────────────────────────────

describe('Graph — toDot', () => {
  it('produces valid DOT syntax with correct shapes by type', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const dot = toDot(graph)

    assert.ok(dot.startsWith('digraph specfuse {'))
    assert.ok(dot.includes('rankdir=LR'))
    assert.ok(dot.includes('shape=box'), 'plan nodes should use box shape')
    assert.ok(dot.includes('shape=diamond'), 'constitution should use diamond shape')
    assert.ok(dot.includes('->'), 'should contain edge arrows')
    assert.ok(dot.endsWith('}'))
  })

  it('styles affected nodes with red fill', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const result = computeImpact(graph, '.specfuse/plan/architecture.md')
    const dot = toDot(result.graph)

    assert.ok(dot.includes('fillcolor="#F8CECC"'), 'affected nodes should have red fill')
  })

  it('uses dashed style for disabled edges', () => {
    const graph = {
      nodes: new Map([['a', { id: 'a', type: 'plan', label: 'A' }]]),
      edges: [{ source: 'a', target: 'a', ruleName: 'self', ruleType: 'A', enabled: false }],
    }
    const dot = toDot(graph)
    assert.ok(dot.includes('style=dashed'), 'disabled edges should be dashed')
  })
})

// ── toMermaid ──────────────────────────────────────────────────────────

describe('Graph — toMermaid', () => {
  it('produces valid Mermaid flowchart syntax', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const mermaid = toMermaid(graph)

    assert.ok(mermaid.startsWith('flowchart LR'))
    assert.ok(mermaid.includes('subgraph'))
    assert.ok(mermaid.includes('-->'))
  })

  it('includes affected class definition when nodes are affected', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const result = computeImpact(graph, '.specfuse/plan/architecture.md')
    const mermaid = toMermaid(result.graph)

    assert.ok(mermaid.includes('classDef affected'), 'should define affected class')
    assert.ok(mermaid.includes(':::affected'), 'nodes should use affected class')
  })

  it('uses dotted arrow for disabled edges', () => {
    const graph = {
      nodes: new Map([['a', { id: 'a', type: 'plan', label: 'A' }]]),
      edges: [{ source: 'a', target: 'a', ruleName: 'self', ruleType: 'A', enabled: false }],
    }
    const mermaid = toMermaid(graph)
    assert.ok(mermaid.includes('-.->'), 'disabled edges should use dotted arrow')
  })
})

// ── toJson ──────────────────────────────────────────────────────────

describe('Graph — toJson', () => {
  it('produces valid JSON with nodes and edges arrays', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const json = toJson(graph)

    assert.ok(json.nodes)
    assert.ok(json.edges)
    assert.ok(Array.isArray(json.nodes))
    assert.ok(Array.isArray(json.edges))
    assert.ok(json.nodes.length > 0)
    assert.ok(json.edges.length > 0)
  })

  it('includes affected flag for impacted nodes', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const result = computeImpact(graph, '.specfuse/plan/architecture.md')
    const json = toJson(result.graph)

    const affectedNodes = json.nodes.filter((n) => n.affected === true)
    assert.ok(affectedNodes.length > 0, 'should have affected nodes')
  })

  it('omits syncStatus when null', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const json = toJson(graph)

    for (const node of json.nodes) {
      assert.ok(!('syncStatus' in node) || node.syncStatus !== null, 'null syncStatus should be omitted')
    }
  })

  it('is serializable to JSON string', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const json = toJson(graph)

    const str = JSON.stringify(json)
    const parsed = JSON.parse(str)
    assert.deepStrictEqual(parsed, json)
  })
})

// ── formatGraphTable ──────────────────────────────────────────────────

describe('Graph — formatGraphTable', () => {
  it('shows node count and edge list', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const table = formatGraphTable(graph)

    assert.ok(table.includes('Nodes:'))
    assert.ok(table.includes('Edges:'))
    assert.ok(table.includes('plan:arch→constitution:plan-decisions'))
  })

  it('returns friendly message for empty graph', () => {
    const graph = { nodes: new Map(), edges: [] }
    const table = formatGraphTable(graph)
    assert.strictEqual(table, 'No rules found — nothing to graph.')
  })
})

// ── formatGraphJson ──────────────────────────────────────────────────

describe('Graph — formatGraphJson', () => {
  it('produces valid JSON string', async () => {
    const registry = new Registry('/tmp/nonexistent')
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph('/tmp/nonexistent', registry, SAMPLE_RULES)
    const jsonStr = formatGraphJson(graph)

    const parsed = JSON.parse(jsonStr)
    assert.ok(parsed.nodes)
    assert.ok(parsed.edges)
  })
})

// ── Full pipeline ──────────────────────────────────────────────────

describe('Graph — full pipeline', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-pipeline-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('registry load → build graph → serialize DOT → output matches expected', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setLoadedRules(SAMPLE_RULES)

    const graph = buildRuleGraph(projectRoot, registry, SAMPLE_RULES)
    const dot = toDot(graph)

    assert.ok(dot.includes('.specfuse/plan/architecture.md'))
    assert.ok(dot.includes('.specfuse/constitution.md'))
    assert.ok(dot.includes('plan:arch→constitution:plan-decisions'))
  })
})

// ── History integration ──────────────────────────────────────────────

describe('Graph — history events', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-history-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('records graph_generate event', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()

    recordEvent(registry, EVENT_TYPES.graph_generate, 'Generated dependency graph', {
      nodes: 3,
      edges: 2,
      format: 'dot',
    })

    const events = getHistory(registry, { type: EVENT_TYPES.graph_generate })
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].type, 'graph_generate')
    assert.strictEqual(events[0].details.nodes, 3)
  })

  it('records graph_impact event', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()

    recordEvent(registry, EVENT_TYPES.graph_impact, 'Impact analysis for: auth.ts', {
      file: 'auth.ts',
      affectedNodes: 5,
    })

    const events = getHistory(registry, { type: EVENT_TYPES.graph_impact })
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].type, 'graph_impact')
    assert.strictEqual(events[0].details.file, 'auth.ts')
  })

  it('EVENT_TYPES includes graph_generate and graph_impact', () => {
    assert.strictEqual(EVENT_TYPES.graph_generate, 'graph_generate')
    assert.strictEqual(EVENT_TYPES.graph_impact, 'graph_impact')
  })
})

// ── API error: GraphEmptyError ──────────────────────────────────────────

describe('Graph — GraphEmptyError', () => {
  it('can be imported and constructed', async () => {
    const { GraphEmptyError } = await import('../api/graph.mjs')
    const err = new GraphEmptyError('No rules found')
    assert.strictEqual(err.name, 'GraphEmptyError')
    assert.strictEqual(err.message, 'No rules found')
    assert.ok(err instanceof Error)
  })

  it('is a subclass of SpecFuseApiError', async () => {
    const { GraphEmptyError, SpecFuseApiError } = await import('../api/graph.mjs')
    const err = new GraphEmptyError('empty')
    assert.ok(err instanceof SpecFuseApiError)
  })
})
