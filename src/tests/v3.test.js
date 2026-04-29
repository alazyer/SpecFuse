import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Registry }       from '../core/registry.js';
import { loadRules }      from '../core/rule-loader.js';
import { runTwoPassSync } from '../core/sync-engine.js';
import { checkAllDrift }  from '../core/drift-detector.js';
import { detectPhase }    from '../core/phase-detector.js';
import { readManagedSection } from '../utils/markdown.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ARCH_DOC = `# Architecture
## Architectural Decisions
- Microservices with Docker
- PostgreSQL per service
## Tech Stack
- Node.js 20 LTS
- Redis 7
## Security
- TLS 1.3 required
- JWT 15-minute expiry
`;

const PRD_DOC = `# PRD
## Non-Functional Requirements
- 99.9% uptime SLA
- 10,000 concurrent users
## Technical Constraints
- Deploy to AWS
`;

const ARCHIVED_PROPOSAL = `# Change Proposal: User Auth
## Overview
Implements JWT authentication with refresh token rotation.
`;

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf3-test-'));
  // Minimal structure — tests set up what they need via setup helpers
  await mkdir(join(root, '.specfuse', 'plan', 'stories'), { recursive: true });
  await mkdir(join(root, '.specfuse', 'changes', 'add-cart'), { recursive: true });
  await mkdir(join(root, '.specfuse', 'changes', 'archive'), { recursive: true });
  // NOTE: archive/ dir is empty — hasArchive = false until a dated subdir is added
  return root;
}

async function setupPlan(root, { arch = false, prd = false } = {}) {
  if (arch) await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'), ARCH_DOC);
  if (prd)  await writeFile(join(root, '.specfuse', 'plan', 'prd.md'), PRD_DOC);
}

async function setupChange(root, { proposal = false, archived = false } = {}) {
  if (proposal) await writeFile(
    join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'),
    '# Change Proposal: Add Cart\n## Overview\nAdd shopping cart.\n'
  );
  if (archived) {
    await mkdir(join(root, '.specfuse', 'changes', 'archive', '2026-04-01-user-auth'), { recursive: true });
    await writeFile(
      join(root, '.specfuse', 'changes', 'archive', '2026-04-01-user-auth', 'proposal.md'),
      ARCHIVED_PROPOSAL
    );
  }
}

// ─── Phase detection ──────────────────────────────────────────────────────────

describe('Phase detection', () => {
  let root;
  beforeEach(async () => { root = await makeFixture(); });
  afterEach(async  () => { await rm(root, { recursive: true, force: true }); });

  test('detects planning when plan artifacts exist but no constitution', async () => {
    await setupPlan(root, { arch: true });
    const { phase } = await detectPhase(root);
    assert.equal(phase, 'planning');
  });

  test('detects feature-dev when constitution.md exists', async () => {
    await setupPlan(root, { arch: true });
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n');
    const { phase } = await detectPhase(root);
    assert.equal(phase, 'feature-dev');
  });

  test('detects maintenance when archive has completed changes', async () => {
    await writeFile(join(root, '.specfuse', 'constitution.md'), '# Constitution\n');
    await setupChange(root, { archived: true });
    const { phase } = await detectPhase(root);
    assert.equal(phase, 'maintenance');
  });

  test('detects unknown when no SpecFuse artifacts exist', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'sf3-empty-'));
    const { phase } = await detectPhase(emptyRoot);
    assert.equal(phase, 'unknown');
    await rm(emptyRoot, { recursive: true, force: true });
  });
});

// ─── Rule loader ──────────────────────────────────────────────────────────────

describe('Rule loader', () => {
  let root;
  beforeEach(async () => { root = await makeFixture(); });
  afterEach(async  () => { await rm(root, { recursive: true, force: true }); });

  test('loads all 5 built-in rules', async () => {
    const rules = await loadRules(root);
    assert.ok(rules.length >= 5, `Expected ≥5 rules, got ${rules.length}`);
  });

  test('all rules have correct structure', async () => {
    const rules = await loadRules(root);
    for (const r of rules) {
      assert.ok(r.id,      `Rule missing id`);
      assert.ok(['A','B'].includes(r.pass), `Rule ${r.id}: pass must be A or B`);
      assert.ok(r.source,  `Rule ${r.id} missing source`);
      assert.ok(r.sources, `Rule ${r.id} missing sources[]`);
      assert.ok(r.target,  `Rule ${r.id} missing target`);
      assert.ok(r.section, `Rule ${r.id} missing section`);
      assert.equal(typeof r.extract,   'function');
      assert.equal(typeof r.transform, 'function');
    }
  });

  test('all source paths are under .specfuse/ or are .specfuse/constitution.md', async () => {
    const rules = await loadRules(root);
    for (const r of rules) {
      const validSource = r.source.startsWith('.specfuse/') || r.source === '.specfuse/constitution.md';
      assert.ok(validSource,
        `Rule ${r.id}: source '${r.source}' must be under .specfuse/ — no external tool paths`);
    }
  });

  test('Pass A rules feed into constitution, Pass B flows out', async () => {
    const rules = await loadRules(root);
    const passA = rules.filter(r => r.pass === 'A');
    const passB = rules.filter(r => r.pass === 'B');
    assert.ok(passA.every(r => r.target === '.specfuse/constitution.md'),
      'All Pass A rules should target constitution.md');
    assert.ok(passB.every(r => r.source === '.specfuse/constitution.md'),
      'All Pass B rules should source from constitution.md');
  });

  test('constitution→changes rule resolves change directories not flat files', async () => {
    const rules  = await loadRules(root);
    const rule   = rules.find(r => r.isMultiTarget);
    assert.ok(rule, 'should have a multi-target rule');
    const { buildRuleContext } = await import('../core/rule-context.js');
    const ctx     = buildRuleContext(root);
    const targets = await rule.resolveTargets(ctx);
    assert.ok(targets.length > 0, 'should find change directories');
    assert.ok(targets.every(t => t.endsWith('proposal.md')),
      'each target must be proposal.md inside a change directory');
    assert.ok(!targets.some(t => t.includes('archive')),
      'archive/ must be excluded from active changes');
  });
});

// ─── Two-pass sync ────────────────────────────────────────────────────────────

describe('Two-pass sync engine', () => {
  let root;
  beforeEach(async () => { root = await makeFixture(); });
  afterEach(async  () => { await rm(root, { recursive: true, force: true }); });

  test('Pass A syncs arch decisions into constitution, Pass B injects header into proposal', async () => {
    await setupPlan(root, { arch: true });
    await setupChange(root, { proposal: true });

    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    const { passA, passB } = await runTwoPassSync(root, registry, rules);

    assert.ok(passA.some(r => r.changed && r.ruleId.includes('arch')),
      'Pass A should sync architecture decisions');
    assert.ok(passB.some(r => r.changed),
      'Pass B should inject header into change proposal');

    const proposal = await readFile(
      join(root, '.specfuse', 'changes', 'add-cart', 'proposal.md'), 'utf8');
    const header   = readManagedSection(proposal, 'constitution-header');
    assert.ok(header, 'constitution-header must be injected into proposal.md');
  });

  test('archive rule populates implemented-features in constitution', async () => {
    await setupChange(root, { archived: true });
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    await runTwoPassSync(root, registry, rules);

    const constitution = await readFile(join(root, '.specfuse', 'constitution.md'), 'utf8');
    const section = readManagedSection(constitution, 'implemented-features');
    assert.ok(section, 'implemented-features section must exist');
    assert.ok(section.includes('user-auth'), 'should reference archived change name');
  });

  test('single sync achieves IN_SYNC on all pairs', async () => {
    await setupPlan(root, { arch: true, prd: true });
    // Add a story file so stories rule has content to sync
    await writeFile(
      join(root, '.specfuse', 'plan', 'stories', 'story-001-auth.md'),
      '# Story: User Auth\n## Acceptance Criteria\n- [ ] Login works\n'
    );
    await setupChange(root, { proposal: true, archived: true });

    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    await runTwoPassSync(root, registry, rules);

    const drifts  = await checkAllDrift(root, registry, rules);
    const nonSync = drifts.filter(d => d.state !== 'IN_SYNC' && d.state !== 'SOURCE_MISSING');
    assert.equal(nonSync.length, 0,
      `Expected all IN_SYNC: ${nonSync.map(d => `${d.state}:${d.ruleId}`).join(', ')}`);
  });

  test('Pass B is skipped when Pass A has an error', async () => {
    await setupPlan(root, { arch: true });
    await setupChange(root, { proposal: true });

    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    const brokenRule = {
      id: 'broken→constitution:broken', pass: 'A',
      source: '.specfuse/plan/broken.md', sources: ['.specfuse/plan/broken.md'],
      target: '.specfuse/constitution.md', section: 'broken',
      async extract() { throw new Error('Intentional failure'); },
      transform() { return ''; },
    };

    const { passA, passB } = await runTwoPassSync(root, registry, [...rules, brokenRule]);
    const broken = passA.find(r => r.ruleId === brokenRule.id);
    assert.ok(broken?.message.startsWith('Error:'), 'broken rule must appear as error in passA');
    assert.equal(passB.length, 0, 'Pass B must not run when Pass A has errors');
  });

  test('registry persists after sync', async () => {
    await setupPlan(root, { arch: true });
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    await runTwoPassSync(root, registry, rules);

    const fresh = new Registry(root);
    await fresh.load();
    const lastSync = fresh.getLastSync('.specfuse/plan/architecture.md', '.specfuse/constitution.md');
    assert.ok(lastSync, 'sync record must be persisted to disk');
    assert.ok(lastSync.syncedAt);
  });
});

// ─── Drift detection ──────────────────────────────────────────────────────────

describe('Drift detection', () => {
  let root;
  beforeEach(async () => { root = await makeFixture(); });
  afterEach(async  () => { await rm(root, { recursive: true, force: true }); });

  test('NEVER_SYNCED before first sync', async () => {
    await setupPlan(root, { arch: true });
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    const drifts   = await checkAllDrift(root, registry, rules);
    const archDrift = drifts.find(d => d.ruleId.includes('arch'));
    assert.equal(archDrift?.state, 'NEVER_SYNCED');
  });

  test('IN_SYNC after sync', async () => {
    await setupPlan(root, { arch: true });
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    await runTwoPassSync(root, registry, rules);
    const drifts   = await checkAllDrift(root, registry, rules);
    const archDrift = drifts.find(d => d.ruleId.includes('arch'));
    assert.equal(archDrift?.state, 'IN_SYNC');
  });

  test('SOURCE_CHANGED when plan artifact modified post-sync', async () => {
    await setupPlan(root, { arch: true });
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    await runTwoPassSync(root, registry, rules);

    await writeFile(join(root, '.specfuse', 'plan', 'architecture.md'),
      ARCH_DOC + '\n- Added new constraint');

    const drifts   = await checkAllDrift(root, registry, rules);
    const archDrift = drifts.find(d => d.ruleId.includes('arch'));
    assert.equal(archDrift?.state, 'SOURCE_CHANGED');
  });

  test('SOURCE_MISSING when plan artifact does not exist', async () => {
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    const drifts   = await checkAllDrift(root, registry, rules);
    const archDrift = drifts.find(d => d.ruleId.includes('arch'));
    assert.equal(archDrift?.state, 'SOURCE_MISSING');
  });

  test('change proposal drift uses directory model', async () => {
    await setupPlan(root, { arch: true });
    await setupChange(root, { proposal: true });
    const registry = new Registry(root); await registry.load();
    const rules    = await loadRules(root);
    await runTwoPassSync(root, registry, rules);

    const drifts = await checkAllDrift(root, registry, rules);
    const changeDrift = drifts.find(d => d.targetId?.includes('add-cart'));
    assert.ok(changeDrift, 'should track add-cart change');
    assert.equal(changeDrift.state, 'IN_SYNC');
  });
});

// ─── Registry v3 ─────────────────────────────────────────────────────────────

describe('Registry v3', () => {
  let root;
  beforeEach(async () => { root = await makeFixture(); });
  afterEach(async  () => { await rm(root, { recursive: true, force: true }); });

  test('fresh registry has correct v3 schema', async () => {
    const registry = new Registry(root);
    await registry.load();
    assert.equal(registry.data.version, '3.0.0');
    assert.equal(registry.data.phase, 'unknown');
  });

  test('migrates v2 registry to v3 with fresh syncs', async () => {
    await mkdir(join(root, '.specfuse'), { recursive: true });
    await writeFile(join(root, '.specfuse', 'registry.json'), JSON.stringify({
      version: '2.0.0', phase: 'feature-dev', detectedFrameworks: ['bmad'],
      artifacts: {}, syncs: { 'docs/architecture.md→constitution.md': { sourceHash: 'abc' } },
    }));
    const registry = new Registry(root);
    await registry.load();
    assert.equal(registry.data.version, '3.0.0');
    assert.equal(registry.data.migratedFrom, '2.0.0');
    assert.deepEqual(registry.data.syncs, {}, 'v3 migration must reset syncs (different artifact IDs)');
  });

  test('all artifact paths are under .specfuse/ or project root', () => {
    const registry = new Registry('/fake/root');
    registry.data  = registry._fresh();
    const defaults = registry.getDefaultArtifacts();
    for (const [id, desc] of Object.entries(defaults)) {
      const isInternal = desc.path.startsWith('.specfuse/') || desc.path === '.specfuse/constitution.md';
      assert.ok(isInternal,
        `Artifact ${id}: path '${desc.path}' must be under .specfuse/ (including .specfuse/constitution.md)`);
    }
  });
});
