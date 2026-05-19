import { join } from 'path';
import { readFileSafe, writeFileAtomic, ensureDir } from '../utils/fs.js';
import { logger } from '../utils/logger.js';

const REGISTRY_DIR   = '.specfuse';
const REGISTRY_FILE  = 'registry.json';
const SCHEMA_VERSION = '4.0.0';

/**
 * v3 canonical artifact paths — entirely under .specfuse/.
 * No external tool paths required.
 *
 * Plan artifacts:   .specfuse/plan/
 * Change artifacts: .specfuse/changes/
 * Constitution:     constitution.md  (project root, human-visible)
 */
export const ARTIFACT_PATHS = {
  'plan:prd':          '.specfuse/plan/prd.md',
  'plan:arch':         '.specfuse/plan/architecture.md',
  'plan:design-system': '.specfuse/plan/design/system.md',
  'plan:design-flows': '.specfuse/plan/design/flows',
  'plan:design-screens': '.specfuse/plan/design/screens',
  'plan:stories':      '.specfuse/plan/stories',       // directory
  'changes:active':    '.specfuse/changes',             // directory
  'changes:archive':   '.specfuse/changes/archive',     // directory
  'constitution':      '.specfuse/constitution.md',
};

const DEFAULT_ARTIFACTS = {
  'plan:prd':    { label: 'PRD',          path: ARTIFACT_PATHS['plan:prd'] },
  'plan:arch':   { label: 'Architecture', path: ARTIFACT_PATHS['plan:arch'] },
  'plan:design-system': { label: 'Design System', path: ARTIFACT_PATHS['plan:design-system'] },
  'plan:design-flows': { label: 'Design Flows', path: ARTIFACT_PATHS['plan:design-flows'], isDirectory: true },
  'plan:design-screens': { label: 'Design Screens', path: ARTIFACT_PATHS['plan:design-screens'], isDirectory: true },
  'plan:stories':{ label: 'Stories',      path: ARTIFACT_PATHS['plan:stories'], isDirectory: true },
  'constitution':{ label: 'Constitution', path: ARTIFACT_PATHS.constitution },
  'changes:active':  { label: 'Active Changes',   path: ARTIFACT_PATHS['changes:active'],  isDirectory: true },
  'changes:archive': { label: 'Change Archive',   path: ARTIFACT_PATHS['changes:archive'], isDirectory: true },
};

export class Registry {
  constructor(projectRoot) {
    this.projectRoot  = projectRoot;
    this.registryPath = join(projectRoot, REGISTRY_DIR, REGISTRY_FILE);
    this.data         = null;
  }

  async load() {
    const raw = await readFileSafe(this.registryPath);
    if (!raw) { this.data = this._fresh(); return; }
    try {
      const parsed = JSON.parse(raw);
      this.data = this._migrate(parsed);
    } catch {
      logger.warn('Registry is corrupt — resetting.');
      this.data = this._fresh();
    }
  }

  async save() {
    if (!this.data) throw new Error('Registry not loaded.');
    await ensureDir(join(this.projectRoot, '.specfuse'));
    await writeFileAtomic(this.registryPath, JSON.stringify(this.data, null, 2) + '\n');
  }

  // ── Sync records ──────────────────────────────────────────────────────────
  recordSync(sourceId, targetId, sourceHash, targetHash) {
    if (!this.data.syncs) this.data.syncs = {};
    this.data.syncs[`${sourceId}→${targetId}`] = {
      sourceHash, targetHash, syncedAt: new Date().toISOString(),
    };
  }
  getLastSync(sourceId, targetId) {
    return this.data?.syncs?.[`${sourceId}→${targetId}`] ?? null;
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────
  setArtifact(id, updates) {
    this.data.artifacts = { ...this.data.artifacts, [id]: { ...this.data.artifacts?.[id], ...updates } };
  }
  getArtifact(id)       { return this.data?.artifacts?.[id] ?? DEFAULT_ARTIFACTS[id] ?? null; }
  getDefaultArtifacts() { return DEFAULT_ARTIFACTS; }
  resolvePath(id)       { const a = this.getArtifact(id); return a?.path ? join(this.projectRoot, a.path) : null; }

  // ── Phase & state ─────────────────────────────────────────────────────────
  setPhase(phase)             { this.data.phase = phase; }
  getPhase()                  { return this.data?.phase ?? 'unknown'; }
  setProjectName(name)        { this.data.projectName = name; }
  getProjectName()            { return this.data?.projectName ?? 'My Project'; }
  setLoadedRules(rules)       { this.data.loadedRules = rules.map(r => ({ id: r.id, source: r.source, pass: r.pass })); }
  getLoadedRules()            { return this.data?.loadedRules ?? []; }
  setHooksInstalled(val)      { this.data.hooksInstalled = val; }
  getHooksInstalled()         { return this.data?.hooksInstalled ?? false; }

  _fresh() {
    return {
      version: SCHEMA_VERSION, phase: 'unknown', projectName: '',
      artifacts: {}, syncs: {}, loadedRules: [], hooksInstalled: false,
      initializedAt: new Date().toISOString(),
    };
  }

  _migrate(data) {
    if (data.version === SCHEMA_VERSION) return data;
    // Pre-v4 registries migrate non-destructively but reset sync state because artifact IDs changed.
    logger.info(`Migrating registry from v${data.version} → v${SCHEMA_VERSION}…`);
    return {
      ...this._fresh(),
      phase:       data.phase ?? 'unknown',
      projectName: data.projectName ?? '',
      syncs:       {},   // v4 has different artifact IDs — start fresh
      migratedFrom: data.version,
      migratedAt:   new Date().toISOString(),
    };
  }
}
