/**
 * Tests for the History and Audit Log feature.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { Registry } from '../core/registry.js'
import {
  recordEvent,
  getHistory,
  formatEvent,
  formatHistoryTable,
  formatHistoryJson,
  EVENT_TYPES,
} from '../core/history.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '.test-fixtures', 'history')

describe('History — Registry integration', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('starts with empty history in a fresh registry', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    assert.deepStrictEqual(registry.data.history, [])
  })

  it('records a single event', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Initialized project TestApp', { projectName: 'TestApp' })
    assert.strictEqual(registry.data.history.length, 1)
    assert.strictEqual(registry.data.history[0].type, 'init')
    assert.strictEqual(registry.data.history[0].summary, 'Initialized project TestApp')
    assert.strictEqual(registry.data.history[0].details.projectName, 'TestApp')
    assert.ok(registry.data.history[0].id)
    assert.ok(registry.data.history[0].timestamp)
  })

  it('records multiple events in order', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Initialized project')
    recordEvent(registry, 'sync', 'Synced 2 rules')
    recordEvent(registry, 'archive', 'Archived change: add-login')
    assert.strictEqual(registry.data.history.length, 3)
    assert.strictEqual(registry.data.history[0].type, 'init')
    assert.strictEqual(registry.data.history[1].type, 'sync')
    assert.strictEqual(registry.data.history[2].type, 'archive')
  })

  it('generates sequential event IDs', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Event 1')
    recordEvent(registry, 'sync', 'Event 2')
    assert.strictEqual(registry.data.history[0].id, 'evt-001')
    assert.strictEqual(registry.data.history[1].id, 'evt-002')
  })

  it('persists history across save/load', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Initialized project', { projectName: 'TestApp' })
    await registry.save()

    const registry2 = new Registry(projectRoot)
    await registry2.load()
    assert.strictEqual(registry2.data.history.length, 1)
    assert.strictEqual(registry2.data.history[0].type, 'init')
    assert.strictEqual(registry2.data.history[0].summary, 'Initialized project')
  })

  it('preserves history on init --force', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'First init')
    await registry.save()

    // Simulate init --force: re-load, add another event, save
    const registry2 = new Registry(projectRoot)
    await registry2.load()
    // History should survive because _migrate preserves it
    assert.strictEqual(registry2.data.history.length, 1)
    recordEvent(registry2, 'init', 'Force re-init', { force: true })
    await registry2.save()

    const registry3 = new Registry(projectRoot)
    await registry3.load()
    assert.strictEqual(registry3.data.history.length, 2)
  })
})

describe('History — getHistory filtering', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-filter-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('filters by type', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Init 1')
    recordEvent(registry, 'sync', 'Sync 1')
    recordEvent(registry, 'sync', 'Sync 2')
    recordEvent(registry, 'archive', 'Archive 1')

    const syncEvents = getHistory(registry, { type: 'sync' })
    assert.strictEqual(syncEvents.length, 2)
    assert.ok(syncEvents.every((e) => e.type === 'sync'))
  })

  it('filters by since date', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Init')
    // Manually inject an old event to test filtering
    registry.data.history[0].timestamp = '2026-01-01T00:00:00.000Z'
    recordEvent(registry, 'sync', 'Recent sync')

    const recentEvents = getHistory(registry, { since: '2026-07-01' })
    assert.strictEqual(recentEvents.length, 1)
    assert.strictEqual(recentEvents[0].type, 'sync')
  })

  it('filters by until date', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Init')
    registry.data.history[0].timestamp = '2026-01-01T00:00:00.000Z'
    recordEvent(registry, 'sync', 'Recent sync')

    const oldEvents = getHistory(registry, { until: '2026-06-30' })
    assert.strictEqual(oldEvents.length, 1)
    assert.strictEqual(oldEvents[0].type, 'init')
  })

  it('limits results', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    for (let i = 0; i < 5; i++) {
      recordEvent(registry, 'sync', `Sync ${i + 1}`)
    }

    const limited = getHistory(registry, { limit: 2 })
    assert.strictEqual(limited.length, 2)
    // Should return the last 2
    assert.strictEqual(limited[0].summary, 'Sync 4')
    assert.strictEqual(limited[1].summary, 'Sync 5')
  })

  it('returns all events with no filters', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    recordEvent(registry, 'init', 'Init')
    recordEvent(registry, 'sync', 'Sync')

    const all = getHistory(registry)
    assert.strictEqual(all.length, 2)
  })
})

describe('History — pruning', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-prune-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('prunes oldest events when exceeding maxHistory', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setMaxHistory(5)
    for (let i = 0; i < 7; i++) {
      recordEvent(registry, 'sync', `Sync ${i + 1}`)
    }
    assert.strictEqual(registry.data.history.length, 5)
    // Oldest 2 should be removed
    assert.strictEqual(registry.data.history[0].summary, 'Sync 3')
    assert.strictEqual(registry.data.history[4].summary, 'Sync 7')
  })

  it('respects maxHistory after save/load', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    registry.setMaxHistory(3)
    for (let i = 0; i < 5; i++) {
      recordEvent(registry, 'sync', `Sync ${i + 1}`)
    }
    await registry.save()

    const registry2 = new Registry(projectRoot)
    await registry2.load()
    assert.strictEqual(registry2.data.history.length, 3)
    assert.strictEqual(registry2.data.maxHistory, 3)
  })

  it('defaults maxHistory to 100', async () => {
    const registry = new Registry(projectRoot)
    await registry.load()
    assert.strictEqual(registry.getMaxHistory(), 100)
  })
})

describe('History — formatting', () => {
  it('formatEvent produces readable output', () => {
    const event = {
      id: 'evt-001',
      timestamp: '2026-07-28T10:30:00.000Z',
      type: 'sync',
      summary: 'Synced 3 rules',
      details: {},
    }
    const result = formatEvent(event)
    assert.ok(result.includes('2026-07-28 10:30:00'))
    assert.ok(result.includes('Synced 3 rules'))
  })

  it('formatHistoryTable joins events with newlines', () => {
    const events = [
      { id: 'evt-001', timestamp: '2026-07-28T10:30:00.000Z', type: 'init', summary: 'Init', details: {} },
      { id: 'evt-002', timestamp: '2026-07-28T11:00:00.000Z', type: 'sync', summary: 'Sync', details: {} },
    ]
    const result = formatHistoryTable(events)
    assert.ok(result.includes('Init'))
    assert.ok(result.includes('Sync'))
    const lines = result.split('\n')
    assert.strictEqual(lines.length, 2)
  })

  it('formatHistoryJson produces valid JSON', () => {
    const events = [
      { id: 'evt-001', timestamp: '2026-07-28T10:30:00.000Z', type: 'init', summary: 'Init', details: {} },
    ]
    const result = formatHistoryJson(events)
    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.events.length, 1)
    assert.strictEqual(parsed.events[0].type, 'init')
  })

  it('formatHistoryJson handles empty events', () => {
    const result = formatHistoryJson([])
    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.events.length, 0)
  })
})

describe('History — EVENT_TYPES constant', () => {
  it('contains all expected event types', () => {
    assert.strictEqual(EVENT_TYPES.init, 'init')
    assert.strictEqual(EVENT_TYPES.sync, 'sync')
    assert.strictEqual(EVENT_TYPES.archive, 'archive')
    assert.strictEqual(EVENT_TYPES.validate, 'validate')
    assert.strictEqual(EVENT_TYPES.drift, 'drift')
  })
})

describe('History — registry _migrate preserves history', () => {
  let projectRoot

  beforeEach(async () => {
    projectRoot = join(FIXTURES_DIR, `test-migrate-${Date.now()}`)
    await mkdir(projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('adds empty history array to same-version registry without history', async () => {
    // Manually create a registry without history key
    await mkdir(join(projectRoot, '.specfuse'), { recursive: true })
    await writeFile(
      join(projectRoot, '.specfuse', 'registry.json'),
      JSON.stringify({ version: '4.0.0', phase: 'planning', projectName: 'Test', artifacts: {}, syncs: {}, traces: {} }, null, 2) + '\n',
    )

    const registry = new Registry(projectRoot)
    await registry.load()
    assert.deepStrictEqual(registry.data.history, [])
    assert.strictEqual(registry.data.maxHistory, 100)
  })
})
