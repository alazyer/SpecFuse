import { createPatch } from 'diff';
import { readFileSafe, listFiles } from '../utils/fs.js';
import { upsertManagedSection, readManagedSection } from '../utils/markdown.js';
import { buildRuleContext } from './rule-context.js';
import { resolveConstitutionPath } from './drift-detector.js';
import { join, basename } from 'path';

/**
 * @typedef {object} FileDiff
 * @property {string}   file      - Relative file path
 * @property {string}   section   - Managed section name
 * @property {string}   ruleId
 * @property {number}   added
 * @property {number}   removed
 * @property {string}   patch     - Unified diff patch string
 * @property {boolean}  hasChanges
 */

/**
 * Compute what `specfuse sync` would change without writing anything.
 *
 * @param {string} projectRoot
 * @param {import('./rule-loader.js').SyncRule[]} rules
 * @returns {Promise<FileDiff[]>}
 */
export async function computeDiff(projectRoot, rules) {
  const ctx   = buildRuleContext(projectRoot);
  const diffs = [];

  // Pass A rules first (simulate two-pass)
  const ordered = [
    ...rules.filter(r => r.pass === 'A'),
    ...rules.filter(r => r.pass === 'B'),
  ];

  // We simulate Pass A writes into memory so Pass B sees the updated constitution
  const memoryFS = new Map(); // path → content

  for (const rule of ordered) {
    const extracted = await rule.extract(ctx).catch(() => null);
    if (!extracted) continue;

    const managedContent = rule.transform(extracted, ctx);
    if (!managedContent) continue;

    if (rule.isMultiTarget && rule.resolveTargets) {
      const targetFiles = await rule.resolveTargets(ctx);
      for (const targetFile of targetFiles) {
        const existing       = memoryFS.get(targetFile) ?? await readFileSafe(targetFile) ?? '';
        const proposed       = upsertManagedSection(existing, rule.section, managedContent);
        const currentSection = readManagedSection(existing, rule.section) ?? '';
        // Normalise to relative path — targetFile may be absolute from resolveTargets()
        const relPath = targetFile.startsWith(projectRoot)
          ? targetFile.slice(projectRoot.length).replace(/^[/\\]/, '')
          : targetFile;
        const d = diffSection(currentSection, managedContent, relPath, rule.section, rule.id);
        diffs.push(d);
        memoryFS.set(targetFile, proposed);
      }
      continue;
    }

    const targetPath = rule.target === '.specfuse/constitution.md'
      ? resolveConstitutionPath(projectRoot)
      : join(projectRoot, rule.target);

    const existing = memoryFS.get(targetPath) ?? await readFileSafe(targetPath) ?? '';
    const proposed = upsertManagedSection(existing, rule.section, managedContent);
    const currentSection = readManagedSection(existing, rule.section) ?? '';
    const d = diffSection(currentSection, managedContent, rule.target, rule.section, rule.id);
    diffs.push(d);
    memoryFS.set(targetPath, proposed);
  }

  return diffs;
}

function diffSection(current, proposed, file, section, ruleId) {
  const a = current.trim();
  const b = proposed.trim();

  const patch = createPatch(
    `${file} [${section}]`,
    a + '\n',
    b + '\n',
    'current', 'proposed',
    { context: 3 }
  );

  const lines   = patch.split('\n').slice(4); // strip file header lines
  const added   = lines.filter(l => l.startsWith('+')).length;
  const removed = lines.filter(l => l.startsWith('-')).length;

  return {
    file, section, ruleId,
    added, removed,
    patch: lines.join('\n'),
    hasChanges: a !== b,
  };
}
