import { join } from 'path'
import { rename } from 'fs/promises'
import {
  readFileSafe,
  writeFileAtomic,
  ensureDir,
  acquirePidLock,
  releasePidLock,
} from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import { RegistryError } from '../api/errors.mjs'

const REGISTRY_DIR = '.specfuse'
const REGISTRY_FILE = 'registry.json'
const LOCK_FILE = 'registry.lock'
export const SCHEMA_VERSION = '4.0.0'

/**
 * Per-version migration functions. Each takes the old data object and returns
 * the migrated data. Functions MUST preserve fields they do not explicitly
 * transform — non-destructive migration is a SHALL requirement.
 *
 * The map key is the *source* version; the function migrates FROM that version
 * toward the next. Registries at the current version need no migration.
 */
const MIGRATIONS = {
  // v2 → v4 and v3 → v4: artifact paths were re-rooted under .specfuse/, so
  // old sync hash keys no longer match current rule IDs. Rather than wipe
  // state destructively, we preserve every field with a valid shape and stamp
  // the canonical v4 structure. Orphaned sync records are harmless (doctor's
  // orphaned-syncs check flags them) and a re-sync rebuilds correct keys —
  // non-destructive preservation beats silent data loss.
  '2.0.0': migrateToV4Preserving,
  '3.0.0': migrateToV4Preserving,
}

/**
 * Migrate a pre-v4 registry to v4 non-destructively: back up the old file
 * (caller's responsibility), stamp canonical v4 shape + defaults on top of the
 * existing data so fields with valid shapes survive, and record the transition.
 */
function migrateToV4Preserving(data) {
  const fresh = freshRegistry()
  // Start from the old data so unmigrated fields are preserved, then overlay
  // canonical v4 defaults so the shape is always complete.
  const migrated = {
    ...data,
    ...fresh,
    // Re-assert these from `data` (with safe fallbacks) so the fresh-overlay
    // above does not clobber legitimately-present values.
    phase: data.phase ?? fresh.phase,
    projectName: data.projectName ?? fresh.projectName,
    history: Array.isArray(data.history) ? data.history : fresh.history,
    imports: Array.isArray(data.imports) ? data.imports : fresh.imports,
    traces: isPlainObject(data.traces) ? data.traces : fresh.traces,
    syncs: isPlainObject(data.syncs) ? data.syncs : fresh.syncs,
    artifacts: isPlainObject(data.artifacts) ? data.artifacts : fresh.artifacts,
    loadedRules: Array.isArray(data.loadedRules) ? data.loadedRules : fresh.loadedRules,
    migratedFrom: data.version,
    migratedAt: new Date().toISOString(),
  }
  return migrated
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function freshRegistry() {
  return {
    version: SCHEMA_VERSION,
    phase: 'unknown',
    projectName: '',
    artifacts: {},
    syncs: {},
    traces: {},
    history: [],
    maxHistory: 100,
    imports: [],
    loadedRules: [],
    hooksInstalled: false,
    initializedAt: new Date().toISOString(),
    // Crash-recovery journal (Improvement 2 — sync-atomicity-and-recovery).
    // `pendingSync` records a pre-sync snapshot + target-file manifest so an
    // interrupted sync can be detected and reconciled on the next run. `null`
    // when no sync is in flight. `pendingArchive` records an in-progress
    // archive (copy done, source not yet removed) so a re-run can complete the
    // registry record without duplicating the archived directory. Both live as
    // top-level keys (design D1) so the source of truth stays in one file.
    pendingSync: null,
    pendingArchive: null,
  }
}

/**
 * v4 canonical artifact paths — entirely under .specfuse/.
 * No external tool paths required.
 *
 * Plan artifacts:   .specfuse/plan/
 * Change artifacts: .specfuse/changes/
 * Constitution:     .specfuse/constitution.md
 */
export const ARTIFACT_PATHS = {
  'plan:prd': '.specfuse/plan/prd.md',
  'plan:arch': '.specfuse/plan/architecture.md',
  'plan:design-system': '.specfuse/plan/design/system.md',
  'plan:design-flows': '.specfuse/plan/design/flows',
  'plan:design-screens': '.specfuse/plan/design/screens',
  'plan:stories': '.specfuse/plan/stories', // directory
  'changes:active': '.specfuse/changes', // directory
  'changes:archive': '.specfuse/changes/archive', // directory
  constitution: '.specfuse/constitution.md',
}

const DEFAULT_ARTIFACTS = {
  'plan:prd': { label: 'PRD', path: ARTIFACT_PATHS['plan:prd'] },
  'plan:arch': { label: 'Architecture', path: ARTIFACT_PATHS['plan:arch'] },
  'plan:design-system': { label: 'Design System', path: ARTIFACT_PATHS['plan:design-system'] },
  'plan:design-flows': {
    label: 'Design Flows',
    path: ARTIFACT_PATHS['plan:design-flows'],
    isDirectory: true,
  },
  'plan:design-screens': {
    label: 'Design Screens',
    path: ARTIFACT_PATHS['plan:design-screens'],
    isDirectory: true,
  },
  'plan:stories': { label: 'Stories', path: ARTIFACT_PATHS['plan:stories'], isDirectory: true },
  constitution: { label: 'Constitution', path: ARTIFACT_PATHS.constitution },
  'changes:active': {
    label: 'Active Changes',
    path: ARTIFACT_PATHS['changes:active'],
    isDirectory: true,
  },
  'changes:archive': {
    label: 'Change Archive',
    path: ARTIFACT_PATHS['changes:archive'],
    isDirectory: true,
  },
}

export class Registry {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.registryPath = join(projectRoot, REGISTRY_DIR, REGISTRY_FILE)
    this.lockPath = join(projectRoot, REGISTRY_DIR, LOCK_FILE)
    this.data = null
    // Set when load() quarantines a corrupt or version-mismatched registry
    // instead of silently resetting. Stored (not thrown) so existing callers
    // that rely on load() returning a fresh registry keep working; CLI/API
    // surfaces read this property to report the structured error.
    this._corruptionError = null
    // Set when load() performs a version migration so callers can report the
    // transition. Null when no migration occurred.
    this._migrationReport = null
    // Tracks whether this instance currently holds the advisory lock, so
    // withLock is re-entrant (a callback that re-enters withLock on the same
    // instance does not self-deadlock).
    this._lockHeld = false
    // Set by _migrate() when a backup/quarantine rename is needed; load()
    // performs the rename after _migrate() returns (the migrate logic is
    // synchronous and cannot touch the filesystem itself).
    this._pendingQuarantine = null
  }

  /**
   * Acquire the advisory registry lock for the duration of `fn`, then release
   * it in a finally block (release-on-throw guaranteed). The callback receives
   * this Registry instance and is responsible for load()/save() inside the
   * locked region — the lock guards the load-mutate-save window, not
   * individual method calls.
   *
   * Re-entrant within the same process: a callback that calls withLock again
   * on the same instance skips re-acquire. Read-only ops (drift, status) do
   * not need the lock.
   *
   * @param {(registry: Registry) => Promise<any>} fn
   * @param {{ timeout?: number, pid?: number, command?: string }} [options]
   * @returns {Promise<any>} whatever fn returns
   */
  async withLock(fn, options = {}) {
    if (this._lockHeld) {
      // Already holding — re-enter without re-acquiring.
      return fn(this)
    }
    const pid = options.pid ?? process.pid
    await acquirePidLock(this.lockPath, {
      timeout: options.timeout,
      pid,
      command: options.command,
    })
    this._lockHeld = true
    try {
      return await fn(this)
    } finally {
      this._lockHeld = false
      await releasePidLock(this.lockPath, { pid })
    }
  }

  /**
   * Quarantine the current registry file by renaming it aside with a suffix,
   * using a collision counter so repeated quarantines never overwrite each
   * other. Returns the quarantined path. The original is never deleted.
   *
   * @param {string} suffix - e.g. '.corrupt-1699999999999' or '.pre-migrate-3.0.0'
   * @returns {Promise<string>} the path the corrupt file was moved to
   */
  async _quarantine(suffix) {
    await ensureDir(join(this.projectRoot, REGISTRY_DIR))
    const base = this.registryPath
    let target = `${base}${suffix}`
    let counter = 1
    // Resolve collisions: if the target already exists, append -2, -3, …
    while (true) {
      try {
        await rename(base, target)
        return target
      } catch (err) {
        if (err.code === 'ENOENT') {
          // The registry file does not exist — nothing to quarantine.
          return base
        }
        if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY') {
          counter += 1
          target = `${base}${suffix}-${counter}`
          continue
        }
        throw err
      }
    }
  }

  /**
   * Validate the top-level shape of a parsed registry object. Returns
   * { valid, errors }. Used after JSON.parse to catch partially-corrupt
   * valid JSON (e.g. `syncs` is a string) before it produces phantom drift.
   *
   * @param {any} data
   * @returns {{ valid: boolean, errors: string[] }}
   */
  _validateShape(data) {
    const errors = []
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      errors.push('registry root must be an object')
      return { valid: false, errors }
    }
    if (typeof data.version !== 'string') {
      errors.push('version must be a string')
    }
    if (
      'syncs' in data &&
      (typeof data.syncs !== 'object' || data.syncs === null || Array.isArray(data.syncs))
    ) {
      errors.push('syncs must be an object')
    }
    if (
      'traces' in data &&
      (typeof data.traces !== 'object' || data.traces === null || Array.isArray(data.traces))
    ) {
      errors.push('traces must be an object')
    }
    if (
      'artifacts' in data &&
      (typeof data.artifacts !== 'object' ||
        data.artifacts === null ||
        Array.isArray(data.artifacts))
    ) {
      errors.push('artifacts must be an object')
    }
    if ('history' in data && !Array.isArray(data.history)) {
      errors.push('history must be an array')
    }
    if ('imports' in data && !Array.isArray(data.imports)) {
      errors.push('imports must be an array')
    }
    if ('loadedRules' in data && !Array.isArray(data.loadedRules)) {
      errors.push('loadedRules must be an array')
    }
    // Crash-recovery journal keys: null when idle, otherwise an object. A
    // malformed marker (e.g. a string) would produce phantom behavior during
    // recovery, so quarantine before trusting it.
    if (
      'pendingSync' in data &&
      data.pendingSync !== null &&
      (typeof data.pendingSync !== 'object' || Array.isArray(data.pendingSync))
    ) {
      errors.push('pendingSync must be null or an object')
    }
    if (
      'pendingArchive' in data &&
      data.pendingArchive !== null &&
      (typeof data.pendingArchive !== 'object' || Array.isArray(data.pendingArchive))
    ) {
      errors.push('pendingArchive must be null or an object')
    }
    return { valid: errors.length === 0, errors }
  }

  async load() {
    // Reset per-load diagnostic state.
    this._corruptionError = null
    this._migrationReport = null

    const raw = await readFileSafe(this.registryPath)
    if (!raw) {
      this.data = freshRegistry()
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Unparseable JSON — quarantine the corrupt file, never silently reset.
      const stamp = Date.now()
      const quarantinedPath = await this._quarantine(`.corrupt-${stamp}`)
      this.data = freshRegistry()
      this._corruptionError = new RegistryError(
        `registry.json was corrupt (unparseable JSON) and has been quarantined to ${quarantinedPath}. A fresh registry was initialized.`,
        { quarantinedPath, category: 'corruption' },
      )
      logger.warn(this._corruptionError.message)
      // Persist the fresh registry so the canonical file exists on disk and a
      // read-only caller does not leave the project without registry.json.
      await this.save()
      return
    }

    // Valid JSON but unexpected shape (e.g. `syncs` is a string) — quarantine
    // before running on partially-corrupt state that would produce phantom drift.
    const { valid, errors } = this._validateShape(parsed)
    if (!valid) {
      const stamp = Date.now()
      const quarantinedPath = await this._quarantine(`.corrupt-${stamp}`)
      this.data = freshRegistry()
      this._corruptionError = new RegistryError(
        `registry.json had an invalid shape (${errors.join('; ')}) and has been quarantined to ${quarantinedPath}. A fresh registry was initialized.`,
        { quarantinedPath, category: 'corruption' },
      )
      logger.warn(this._corruptionError.message)
      await this.save()
      return
    }

    // _migrate is synchronous; if it decided a backup/quarantine is needed it
    // stashes the request here. We perform the rename now (filesystem side).
    this._pendingQuarantine = null
    this.data = this._migrate(parsed)
    if (this._pendingQuarantine) {
      const req = this._pendingQuarantine
      this._pendingQuarantine = null
      const stamp = Date.now()
      const quarantinedPath = await this._quarantine(`${req.suffix}-${stamp}`)
      if (req.category === 'version_mismatch') {
        // Future/unknown version — the on-disk file was quarantined and data is
        // a fresh registry. Surface a structured error so a downgrade is visible.
        this._corruptionError = new RegistryError(
          `registry.json is version v${req.originalVersion}, newer than the supported v${SCHEMA_VERSION}. It has been quarantined to ${quarantinedPath} and a fresh registry was initialized to avoid destroying newer state.`,
          {
            quarantinedPath,
            originalVersion: req.originalVersion,
            category: 'version_mismatch',
          },
        )
        logger.warn(this._corruptionError.message)
      } else {
        // Older version — backed up successfully; report the transition.
        logger.info(
          `Backed up old v${req.originalVersion} registry to ${quarantinedPath} before migrating to v${SCHEMA_VERSION}.`,
        )
      }
      // The on-disk registry.json was just renamed aside. Persist the migrated
      // (or fresh) data so a read-only caller doesn't leave the project without
      // a canonical registry.json — otherwise the next load would see no file
      // and silently reinitialize, losing the migration + backup pairing.
      await this.save()
    }
  }

  async save() {
    if (!this.data) throw new Error('Registry not loaded.')
    await ensureDir(join(this.projectRoot, '.specfuse'))
    await writeFileAtomic(this.registryPath, JSON.stringify(this.data, null, 2) + '\n')
  }

  // ── Sync records ──────────────────────────────────────────────────────────
  recordSync(sourceId, targetId, sourceHash, targetHash) {
    if (!this.data.syncs) this.data.syncs = {}
    this.data.syncs[`${sourceId}→${targetId}`] = {
      sourceHash,
      targetHash,
      syncedAt: new Date().toISOString(),
    }
  }
  getLastSync(sourceId, targetId) {
    return this.data?.syncs?.[`${sourceId}→${targetId}`] ?? null
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────
  setArtifact(id, updates) {
    this.data.artifacts = {
      ...this.data.artifacts,
      [id]: { ...this.data.artifacts?.[id], ...updates },
    }
  }
  getArtifact(id) {
    return this.data?.artifacts?.[id] ?? DEFAULT_ARTIFACTS[id] ?? null
  }
  getArtifactPathLabel(id) {
    return this.getArtifact(id)?.path ?? null
  }
  getDefaultArtifacts() {
    return DEFAULT_ARTIFACTS
  }
  resolvePath(id) {
    const a = this.getArtifact(id)
    return a?.path ? join(this.projectRoot, a.path) : null
  }

  // ── Rule definitions & sync entries ────────────────────────────────────────

  /**
   * Get the full list of loaded rule definitions.
   * Each entry has { id, source, pass }.
   * @returns {Array<{id: string, source: string, pass: string}>}
   */
  getRuleDefinitions() {
    return this.data?.loadedRules ?? []
  }

  /**
   * Get all sync entries with their source/target paths and results.
   * Returns an array of { sourceId, targetId, sourceHash, targetHash, syncedAt }.
   * @returns {Array<{sourceId: string, targetId: string, sourceHash: string, targetHash: string, syncedAt: string}>}
   */
  getSyncEntries() {
    const syncs = this.data?.syncs ?? {}
    return Object.entries(syncs).map(([key, val]) => {
      const [sourceId, targetId] = key.split('→')
      return {
        sourceId: sourceId ?? '',
        targetId: targetId ?? '',
        sourceHash: val.sourceHash ?? '',
        targetHash: val.targetHash ?? '',
        syncedAt: val.syncedAt ?? '',
      }
    })
  }

  /**
   * Remove sync entries by registry key.
   * @param {string[]} keys
   * @returns {number} Number of entries removed
   */
  removeSyncEntries(keys) {
    if (!this.data.syncs) this.data.syncs = {}
    let removed = 0
    for (const key of keys) {
      if (Object.hasOwn(this.data.syncs, key)) {
        delete this.data.syncs[key]
        removed++
      }
    }
    return removed
  }

  /**
   * Remove trace entries by story ID.
   * @param {string[]} storyIds
   * @returns {number} Number of entries removed
   */
  removeTraceEntries(storyIds) {
    if (!this.data.traces) this.data.traces = {}
    let removed = 0
    for (const storyId of storyIds) {
      if (Object.hasOwn(this.data.traces, storyId)) {
        delete this.data.traces[storyId]
        removed++
      }
    }
    return removed
  }

  /** Clear all recorded sync state. */
  clearSyncState() {
    this.data.syncs = {}
  }

  /** Clear all traceability state. */
  clearTraceState() {
    this.data.traces = {}
  }

  // ── Phase & state ─────────────────────────────────────────────────────────
  setPhase(phase) {
    this.data.phase = phase
  }
  getPhase() {
    return this.data?.phase ?? 'unknown'
  }
  setProjectName(name) {
    this.data.projectName = name
  }
  getProjectName() {
    return this.data?.projectName ?? 'My Project'
  }
  setLoadedRules(rules) {
    this.data.loadedRules = rules.map((r) => ({ id: r.id, source: r.source, pass: r.pass }))
  }
  getLoadedRules() {
    return this.data?.loadedRules ?? []
  }
  setHooksInstalled(val) {
    this.data.hooksInstalled = val
  }
  getHooksInstalled() {
    return this.data?.hooksInstalled ?? false
  }

  // ── History ──────────────────────────────────────────────────────────────────

  /**
   * Record a history event.
   * @param {string} type - Event type (one of EVENT_TYPES)
   * @param {string} summary - Human-readable summary
   * @param {object} [details] - Optional structured details
   */
  recordHistoryEvent(type, summary, details = {}) {
    if (!this.data.history) this.data.history = []
    const seq = this.data.history.length + 1
    this.data.history.push({
      id: `evt-${String(seq).padStart(3, '0')}`,
      timestamp: new Date().toISOString(),
      type,
      summary,
      details,
    })
    // Prune if exceeding maxHistory
    const max = this.data.maxHistory ?? 100
    if (this.data.history.length > max) {
      this.data.history = this.data.history.slice(-max)
    }
  }

  /**
   * Get history events with optional filtering.
   * @param {{ since?: string, until?: string, limit?: number, type?: string }} [options]
   * @returns {Array<object>}
   */
  getHistory(options = {}) {
    let events = this.data?.history ?? []
    if (options.type) {
      events = events.filter((e) => e.type === options.type)
    }
    if (options.since) {
      const since = new Date(options.since).getTime()
      events = events.filter((e) => new Date(e.timestamp).getTime() >= since)
    }
    if (options.until) {
      const until = new Date(options.until).getTime()
      events = events.filter((e) => new Date(e.timestamp).getTime() <= until)
    }
    if (options.limit && options.limit < events.length) {
      events = events.slice(-options.limit)
    }
    return events
  }

  /**
   * Set the maximum number of history events to retain.
   * @param {number} max
   */
  setMaxHistory(max) {
    this.data.maxHistory = max
    // Prune immediately if current history exceeds new limit
    if (this.data.history && this.data.history.length > max) {
      this.data.history = this.data.history.slice(-max)
    }
  }

  /**
   * Get the current maxHistory setting.
   * @returns {number}
   */
  getMaxHistory() {
    return this.data?.maxHistory ?? 100
  }

  // ── Crash-recovery journal ──────────────────────────────────────────────────
  //
  // The journal lives inside registry.json (design D1) so the source of truth
  // is a single file. `pendingSync` marks an in-flight two-pass sync; it is
  // written before any target-file mutation and cleared only after the final
  // save() succeeds, so an interrupted run leaves a resolvable marker rather
  // than a silently-stale registry. `pendingArchive` marks an in-flight
  // change archive (copy done, source not yet removed) so a re-run completes
  // the record without duplicating the archived directory.

  /**
   * Persist a pending-sync marker. `marker` shape:
   *   { snapshot, manifest, startedAt }
   * where `snapshot` is a deep copy of the pre-sync registry state (syncs,
   * traces, artifacts, phase) and `manifest` is an array of
   *   { ruleId, targetPath, sourceId, targetId, sourceHash, targetHash, transformedContent }
   * recording the intended writes. Calling this overwrites any prior marker
   * (a fresh sync supersedes a stale one — recovery handles the prior run first).
   *
   * @param {{ snapshot: object, manifest: object[], startedAt: string } | null} marker
   */
  setPendingSync(marker) {
    this.data.pendingSync = marker
  }

  /** @returns {{ snapshot: object, manifest: object[], startedAt: string } | null} */
  getPendingSync() {
    return this.data?.pendingSync ?? null
  }

  /** Clear the pending-sync marker (sets to null). */
  clearPendingSync() {
    this.data.pendingSync = null
  }

  /**
   * Persist a pending-archive marker. `marker` shape:
   *   { change, sourceDir, archiveDir }
   * Records that a directory copy has succeeded and the source is about to be
   * removed, so a crash in that window leaves a resolvable marker.
   *
   * @param {{ change: string, sourceDir: string, archiveDir: string } | null} marker
   */
  setPendingArchive(marker) {
    this.data.pendingArchive = marker
  }

  /** @returns {{ change: string, sourceDir: string, archiveDir: string } | null} */
  getPendingArchive() {
    return this.data?.pendingArchive ?? null
  }

  /** Clear the pending-archive marker (sets to null). */
  clearPendingArchive() {
    this.data.pendingArchive = null
  }

  // ── Import records ────────────────────────────────────────────────────────

  /**
   * Record an import event.
   * @param {{ timestamp?: string, sourceProject?: string, mode?: string, conflict?: string, artifactCounts?: object }} metadata
   */
  recordImport(metadata = {}) {
    if (!this.data.imports) this.data.imports = []
    this.data.imports.push({
      id: `imp-${String(this.data.imports.length + 1).padStart(3, '0')}`,
      timestamp: metadata.timestamp ?? new Date().toISOString(),
      sourceProject: metadata.sourceProject ?? 'unknown',
      mode: metadata.mode ?? 'merge',
      conflict: metadata.conflict ?? 'skip',
      artifactCounts: metadata.artifactCounts ?? {},
    })
    // Prune if exceeding 50
    if (this.data.imports.length > 50) {
      this.data.imports = this.data.imports.slice(-50)
    }
  }

  /**
   * Get import records with optional filtering.
   * @param {{ since?: string, until?: string, limit?: number }} [options]
   * @returns {Array<object>}
   */
  getImports(options = {}) {
    let imports = this.data?.imports ?? []
    if (options.since) {
      const since = new Date(options.since).getTime()
      imports = imports.filter((i) => new Date(i.timestamp).getTime() >= since)
    }
    if (options.until) {
      const until = new Date(options.until).getTime()
      imports = imports.filter((i) => new Date(i.timestamp).getTime() <= until)
    }
    if (options.limit && options.limit < imports.length) {
      imports = imports.slice(-options.limit)
    }
    return imports
  }

  // ── Trace links ───────────────────────────────────────────────────────────

  /**
   * Get all trace records from the registry.
   * Returns `{}` if no traces exist.
   * @returns {object} Map of storyId → { active: string[], implemented: boolean, implementedBy?: string }
   */
  getTraces() {
    return this.data?.traces ?? {}
  }

  /**
   * Record that a change references specific story IDs.
   * Updates the `active` array for each story, replacing any previous
   * entries for this changeName to keep links current.
   *
   * @param {string} changeName  Slug of the change (e.g., "add-login")
   * @param {string[]} storyIds  Story IDs referenced by this change
   */
  recordTrace(changeName, storyIds) {
    if (!this.data.traces) this.data.traces = {}

    // First, remove this changeName from all existing active arrays
    // (handles the case where stories field was edited)
    for (const storyId of Object.keys(this.data.traces)) {
      const record = this.data.traces[storyId]
      if (record.active) {
        record.active = record.active.filter((c) => c !== changeName)
      }
    }

    // Then add this changeName to the active arrays for the new story IDs
    for (const storyId of storyIds) {
      if (!this.data.traces[storyId]) {
        this.data.traces[storyId] = { active: [], implemented: false }
      }
      const record = this.data.traces[storyId]
      if (!record.active) record.active = []
      if (!record.active.includes(changeName)) {
        record.active.push(changeName)
      }
    }

    // Clean up empty records (no active changes, not implemented)
    for (const storyId of Object.keys(this.data.traces)) {
      const record = this.data.traces[storyId]
      if (!record.active?.length && !record.implemented) {
        delete this.data.traces[storyId]
      }
    }
  }

  /**
   * Mark a story as implemented by an archived change.
   * Removes the change from the active array and sets implemented=true.
   *
   * @param {string} storyId     Story ID to mark as implemented
   * @param {string} archiveName Archive directory name (e.g., "2026-07-08-add-login")
   */
  markStoryImplemented(storyId, archiveName) {
    if (!this.data.traces) this.data.traces = {}
    if (!this.data.traces[storyId]) {
      this.data.traces[storyId] = { active: [], implemented: false }
    }
    const record = this.data.traces[storyId]
    record.implemented = true
    record.implementedBy = archiveName
    // Remove the archived change from the active array
    record.active = (record.active || []).filter(
      (c) => c !== archiveName.replace(/^\d{4}-\d{2}-\d{2}-/, ''),
    )
  }

  /**
   * Remove all trace links for a given change name.
   * Used when a change is being re-indexed or cleaned up.
   *
   * @param {string} changeName  Slug of the change to remove
   */
  removeTraceLinks(changeName) {
    if (!this.data.traces) return
    for (const storyId of Object.keys(this.data.traces)) {
      const record = this.data.traces[storyId]
      if (record.active) {
        record.active = record.active.filter((c) => c !== changeName)
      }
      // Clean up empty records
      if (!record.active?.length && !record.implemented) {
        delete this.data.traces[storyId]
      }
    }
  }

  _fresh() {
    return freshRegistry()
  }

  /**
   * Non-destructive migration per the registry-concurrency-safety spec:
   * - same version  → backfill missing keys, no backup, no report needed
   * - older version with a defined migration → back up the old file, apply the
   *   migration chain field-by-field, preserve unmigrated fields, report it
   * - newer (unknown future) version → quarantine so a downgrade does not
   *   destroy newer-state data; surface a version_mismatch RegistryError
   * - older version WITHOUT a defined migration → back up, init fresh shape but
   *   copy over fields with valid shapes, report the transition
   *
   * @param {object} data - parsed + shape-validated registry object
   * @returns {object} the migrated data (mutated in place where practical)
   */
  _migrate(data) {
    if (data.version === SCHEMA_VERSION) {
      // Same version — ensure canonical keys exist (backfill, non-destructive).
      if (!data.traces) data.traces = {}
      if (!data.history) data.history = []
      if (!data.imports) data.imports = []
      if (!data.artifacts) data.artifacts = {}
      if (!data.syncs) data.syncs = {}
      if (!data.loadedRules) data.loadedRules = []
      if (data.maxHistory === null || data.maxHistory === undefined) data.maxHistory = 100
      // Crash-recovery journal keys — backfill to null on existing registries.
      if (data.pendingSync === undefined) data.pendingSync = null
      if (data.pendingArchive === undefined) data.pendingArchive = null
      return data
    }

    // Unknown / future version — quarantine rather than risk wiping newer state.
    // This is synchronous-safe because load() already validated the shape; we
    // stash the quarantine for load() to perform (load owns the filesystem).
    if (typeof data.version === 'string' && isNewerThan(data.version, SCHEMA_VERSION)) {
      this._pendingQuarantine = {
        suffix: `.future-version-${data.version}`,
        originalVersion: data.version,
        category: 'version_mismatch',
      }
      return freshRegistry()
    }

    // Older version with a defined migration — back up first, then migrate.
    if (MIGRATIONS[data.version]) {
      this._pendingQuarantine = {
        suffix: `.pre-migrate-${data.version}`,
        originalVersion: data.version,
      }
      const migrated = MIGRATIONS[data.version](data)
      logger.info(`Migrating registry from v${data.version} → v${SCHEMA_VERSION}…`)
      this._migrationReport = {
        from: data.version,
        to: SCHEMA_VERSION,
        preservedFields: Object.keys(data).filter((k) => k !== 'version'),
      }
      return migrated
    }

    // Older version without a defined migration — back up, init canonical shape,
    // preserve fields with valid shapes from the old data.
    this._pendingQuarantine = {
      suffix: `.unknown-version-${data.version}`,
      originalVersion: data.version,
    }
    const fresh = freshRegistry()
    const preserved = {
      ...fresh,
      phase: data.phase ?? fresh.phase,
      projectName: data.projectName ?? fresh.projectName,
      history: Array.isArray(data.history) ? data.history : fresh.history,
      imports: Array.isArray(data.imports) ? data.imports : fresh.imports,
      traces: isPlainObject(data.traces) ? data.traces : fresh.traces,
      syncs: isPlainObject(data.syncs) ? data.syncs : fresh.syncs,
      artifacts: isPlainObject(data.artifacts) ? data.artifacts : fresh.artifacts,
      loadedRules: Array.isArray(data.loadedRules) ? data.loadedRules : fresh.loadedRules,
      migratedFrom: data.version,
      migratedAt: new Date().toISOString(),
    }
    logger.info(
      `Migrating registry from v${data.version} → v${SCHEMA_VERSION} (no defined migration; fields preserved).`,
    )
    this._migrationReport = {
      from: data.version,
      to: SCHEMA_VERSION,
      preservedFields: Object.keys(data).filter((k) => k !== 'version'),
    }
    return preserved
  }
}

/**
 * Compare two semver-ish version strings. Returns true if `a` is strictly
 * newer than `b`. Handles simple `MAJOR.MINOR.PATCH` tuples; non-numeric parts
 * sort as 0.
 * @param {string} a
 * @param {string} b
 */
function isNewerThan(a, b) {
  const pa = String(a)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return true
    if (da < db) return false
  }
  return false
}
