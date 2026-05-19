import { pathExists, listFiles } from '../utils/fs.js';
import { join } from 'path';

/**
 * Detect development phase from .specfuse/ directory structure.
 *
 * Phases:
 *   planning     — .specfuse/plan/ has content, no constitution yet
 *   feature-dev  — constitution.md exists
 *   maintenance  — .specfuse/changes/archive/ has completed changes
 *   unknown      — no SpecFuse artifacts found
 *
 * @param {string} projectRoot
 * @returns {Promise<{ phase: string, evidence: string[] }>}
 */
export async function detectPhase(projectRoot) {
  const evidence = [];

  const hasPrd    = pathExists(join(projectRoot, '.specfuse', 'plan', 'prd.md'));
  const hasArch   = pathExists(join(projectRoot, '.specfuse', 'plan', 'architecture.md'));
  const hasDesignSystem = pathExists(join(projectRoot, '.specfuse', 'plan', 'design', 'system.md'));
  const hasStories = pathExists(join(projectRoot, '.specfuse', 'plan', 'stories'));
  const hasConstitution = pathExists(join(projectRoot, '.specfuse', 'constitution.md'));
  const hasChanges = pathExists(join(projectRoot, '.specfuse', 'changes'));
  // Archive phase only if there are actual archived change dirs inside archive/
  // The archive/ directory itself is created on init — its existence alone means nothing
  const archivePath = join(projectRoot, '.specfuse', 'changes', 'archive');
  let hasArchive = false;
  if (pathExists(archivePath)) {
    try {
      const { readdirSync } = await import('fs');
      const entries = readdirSync(archivePath, { withFileTypes: true });
      hasArchive = entries.some(e => e.isDirectory());
    } catch { hasArchive = false; }
  }

  if (hasPrd)          evidence.push('.specfuse/plan/prd.md found');
  if (hasArch)         evidence.push('.specfuse/plan/architecture.md found');
  if (hasDesignSystem) evidence.push('.specfuse/plan/design/system.md found');
  if (hasStories)      evidence.push('.specfuse/plan/stories/ found');
  if (hasConstitution) evidence.push('constitution.md found');
  if (hasChanges)      evidence.push('.specfuse/changes/ found');
  if (hasArchive)      evidence.push('.specfuse/changes/archive/ found (completed changes)');

  if (hasArchive && hasConstitution) return { phase: 'maintenance',  evidence };
  if (hasConstitution)               return { phase: 'feature-dev',  evidence };
  if (hasPrd || hasArch || hasDesignSystem) return { phase: 'planning',     evidence };
  return { phase: 'unknown', evidence };
}

/** @param {string} phase @returns {string} */
export function describePhase(phase) {
  return {
    planning:      'Planning — building PRD, architecture, and user stories',
    'feature-dev': 'Feature Development — constitution active; creating change proposals',
    maintenance:   'Maintenance — delivering changes and archiving completed work',
    unknown:       'Unknown — run `specfuse init` to set up this project',
  }[phase] ?? 'Unknown phase';
}

/** @param {string} phase @returns {string} */
export function recommendedAction(phase) {
  return {
    planning:      'Run `specfuse specify init` to generate constitution.md from your plan, then `specfuse sync`',
    'feature-dev': 'Run `specfuse change new <name>` to start a change proposal, then `specfuse watch`',
    maintenance:   'Run `specfuse change archive <name>` when a change is done, then `specfuse sync`',
    unknown:       'Run `specfuse init` to start a new project or import an existing one',
  }[phase] ?? 'Run `specfuse init`';
}
