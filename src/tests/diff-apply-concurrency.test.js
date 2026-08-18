/**
 * Concurrency test for the `diff({ apply: true })` API path.
 *
 * The apply path wraps load+apply+recordSync+save in `withLock`. A concurrent
 * 'watch' writer (loads the registry, mutates a DIFFERENT key, saves) must not
 * interleave its save over the apply's recorded sync: the lock serializes the
 * two, and the apply's recorded pair survives the watch's interleaved write.
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { Registry } from '../core/registry.js'
import { recordEvent, EVENT_TYPES } from '../core/history.js'
import { diff } from '../api/sync-ops.mjs'

// ─── Helpers ──────────────────────────────────────────────────────────────

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-diff-apply-conc-'))
  await mkdir(join(root, '.specfuse'), { recursive: true })
  return root
}

// Fixture content: an architecture doc whose `## Architectural Decisions` H2
// the built-in plan rule extracts and injects into constitution.md, producing a
// real change when diff({apply:true}) runs.
const ARCH_DOC_FOR_APPLY = `# Architecture
## Architectural Decisions
- Microservices with Docker
- PostgreSQL per service
## Tech Stack
- Node.js 20 LTS
- Redis 7
`

// ─── diff({apply:true}) locked transaction vs concurrent watch writer ────────

describe('diff({apply:true}) locked transaction vs concurrent watch writer', () => {
  let root
  beforeEach(async () => {
    root = await makeFixture()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('apply holds the lock; watch’s interleaved save does not lose the applied sync', async () => {
    const lockPath = join(root, '.specfuse', 'registry.lock')

    // Fixture: a plan doc whose built-in rule produces a change in constitution.md.
    await mkdir(join(root, '.specfuse', 'plan'), { recursive: true })
    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC_FOR_APPLY)
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n')

    const order = []

    // The 'watch' writer: a SEPARATE Registry instance with a different PID so
    // it genuinely contends on the same lockfile. It loads the registry, mutates
    // a DIFFERENT key (a history event the apply does not touch), sleeps so the
    // contention window is observable, then saves. Because the apply also holds
    // the lock, these two serialize — whoever acquires first, the second sees
    // the first's writes (no lost update either direction).
    const watchWriter = new Registry(root)
    const watch = watchWriter.withLock(
      async (reg) => {
        order.push('watch-start')
        await reg.load()
        recordEvent(reg, EVENT_TYPES.sync, 'watch interleaved save', { src: 'watch' })
        await new Promise((r) => setTimeout(r, 40))
        await reg.save()
        order.push('watch-end')
      },
      { pid: 1, command: 'watch', timeout: 5000 },
    )

    // Start the watch first so it queues on the lock, then start the apply.
    // Whichever acquires first, the other waits — the lock guarantees mutual
    // exclusion, which is what we assert via the no-lost-update invariant below.
    await new Promise((r) => setTimeout(r, 5)) // let watch reach acquirePidLock
    const applyPromise = diff({ root, apply: true })

    const applyResult = await applyPromise
    await watch

    // The apply must report a written file (a real change was applied).
    assert.ok(applyResult.applied, 'apply must return applied results')
    assert.ok(applyResult.applied.some((a) => a.written), 'apply must write at least one file')

    // Serialization: both ran to completion (watch-start recorded).
    assert.ok(order.includes('watch-start'), 'watch writer must eventually run')

    // After both: NO lost update either direction. The apply's recorded sync
    // pair survives the watch's interleaved save, AND the watch's history event
    // survives the apply's save. Reload and confirm both are present.
    const finalReg = new Registry(root)
    await finalReg.load()
    const archKey = '.specfuse/plan/architecture.md→.specfuse/constitution.md'
    assert.ok(
      finalReg.data.syncs[archKey],
      'the apply’s recorded sync must survive the watch’s interleaved save',
    )
    const watchEvents = finalReg.getHistory({ type: EVENT_TYPES.sync }).filter(
      (e) => e.summary === 'watch interleaved save',
    )
    assert.equal(watchEvents.length, 1, 'watch’s interleaved mutation also survives')

    // The lock file is removed after both transactions complete.
    assert.ok(!existsSync(lockPath), 'lock must be released after the apply transaction')
  })

  test('apply transaction removes the lock file even when no changes apply', async () => {
    const lockPath = join(root, '.specfuse', 'registry.lock')
    // Empty constitution, no plan doc → no changes, apply is a no-op, but the
    // locked transaction must still release the lock.
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n')

    await diff({ root, apply: true })

    assert.ok(!existsSync(lockPath), 'lock must be released after an empty apply')
  })
})
