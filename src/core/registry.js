import { join } from 'path'
import { readFileSafe, writeFileAtomic, ensureDir } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

const REGISTRY_DIR = '.specfuse'
const REGISTRY_FILE = 'registry.json'
const SCHEMA_VERSION = '4.0.0'

/**
 * v4 canonical artifact paths — entirely under .specfuse/.
 * No external tool paths required.
 *
 * Plan artifacts:   .specfuse/plan/
 * Change artifacts: .specfuse/changes/
 * Constitution:     constitution.md  (project root, human-visible)
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
    this.data = null
  }

  async load() {
    const raw = await readFileSafe(this.registryPath)
    if (!raw) {
      this.data = this._fresh()
      return
    }
    try {
      const parsed = JSON.parse(raw)
      this.data = this._migrate(parsed)
    } catch {
      logger.warn('Registry is corrupt — resetting.')
      this.data = this._fresh()
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
    record.active = (record.active || []).filter((c) => c !== archiveName.replace(/^\d{4}-\d{2}-\d{2}-/, ''))
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
    }
  }

  _migrate(data) {
    if (data.version === SCHEMA_VERSION) {
      // Ensure keys exist even on same-version registries
      if (!data.traces) data.traces = {}
      if (!data.history) data.history = []
      if (!data.imports) data.imports = []
      if (data.maxHistory === null || data.maxHistory === undefined) data.maxHistory = 100
      return data
    }
    // Pre-v4 registries migrate non-destructively but reset sync state because artifact IDs changed.
    logger.info(`Migrating registry from v${data.version} → v${SCHEMA_VERSION}…`)
    return {
      ...this._fresh(),
      phase: data.phase ?? 'unknown',
      projectName: data.projectName ?? '',
      history: data.history ?? [],
      syncs: {}, // v4 has different artifact IDs — start fresh
      migratedFrom: data.version,
      migratedAt: new Date().toISOString(),
    }
  }
}
