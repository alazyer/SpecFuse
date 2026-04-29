import { join, basename } from 'path';
import { readFileSafe, writeFileAtomic } from '../utils/fs.js';
import { upsertManagedSection, hashContent } from '../utils/markdown.js';
import { resolveConstitutionPath } from './drift-detector.js';
import { buildRuleContext } from './rule-context.js';
import { logger } from '../utils/logger.js';
import { stat } from 'fs/promises';

/**
 * @typedef {object} SyncResult
 * @property {string}   ruleId
 * @property {boolean}  changed
 * @property {string}   message
 * @property {'A'|'B'}  pass
 */

async function executeRule(rule, projectRoot, registry, ctx) {
  try {
    const extracted = await rule.extract(ctx);
    if (!extracted) {
      return [{ ruleId: rule.id, pass: rule.pass, changed: false,
        message: 'Source not found or empty — skipped.' }];
    }

    const managedContent = rule.transform(extracted, ctx);
    if (!managedContent) {
      return [{ ruleId: rule.id, pass: rule.pass, changed: false,
        message: 'Transform returned empty — skipped.' }];
    }

    // Multi-target: inject into each resolved target file (e.g. proposal.md in change dirs)
    if (rule.isMultiTarget && rule.resolveTargets) {
      const targetFiles = await rule.resolveTargets(ctx);
      if (!targetFiles.length) {
        return [{ ruleId: rule.id, pass: rule.pass, changed: false,
          message: 'No active change directories found in openspec/changes/.' }];
      }

      const constitutionContent = await readFileSafe(resolveConstitutionPath(projectRoot));
      const sourceHash = hashContent(constitutionContent ?? '');
      const results = [];

      for (const targetFile of targetFiles) {
        const changeDir  = basename(join(targetFile, '..'));   // parent dir = change name
        const targetId   = `changes:${changeDir}`;
        const existing   = await readFileSafe(targetFile) ?? '';
        const updated    = upsertManagedSection(existing, rule.section, managedContent);
        const targetHash = hashContent(managedContent);

        await writeFileAtomic(targetFile, updated);
        registry.recordSync('constitution', targetId, sourceHash, targetHash);

        logger.sync(`${rule.id} → ${changeDir}/proposal.md [${rule.section}]`);
        results.push({ ruleId: `${rule.id}:${changeDir}`, pass: rule.pass, changed: true,
          message: `Injected [${rule.section}] into ${changeDir}/proposal.md.` });
      }
      return results;
    }

    // Single-target rule
    const targetPath = rule.target === '.specfuse/constitution.md'
      ? resolveConstitutionPath(projectRoot)
      : join(projectRoot, rule.target);

    const existing   = await readFileSafe(targetPath) ?? defaultConstitution();
    const updated    = upsertManagedSection(existing, rule.section, managedContent);

    // Source hash: use raw file content so drift-detector comparisons align
    const rawSourcePath  = join(projectRoot, rule.source);
    const sourceStats    = await stat(rawSourcePath).catch(() => null);
    const rawFileContent = sourceStats?.isDirectory()
      ? `dir:${rule.source}`
      : await readFileSafe(rawSourcePath) ?? '';

    const sourceHash = hashContent(rawFileContent);
    const targetHash = hashContent(managedContent);

    await writeFileAtomic(targetPath, updated);
    registry.recordSync(rule.source, rule.target, sourceHash, targetHash);

    logger.sync(`${rule.id} [${rule.section}]`);
    return [{ ruleId: rule.id, pass: rule.pass, changed: true,
      message: `Synced [${rule.section}] to ${rule.target}.` }];

  } catch (err) {
    logger.error(`Rule ${rule.id} failed: ${err.message}`);
    logger.debug(err.stack ?? '');
    return [{ ruleId: rule.id, pass: rule.pass, changed: false,
      message: `Error: ${err.message}` }];
  }
}

/**
 * Run all sync rules in two passes.
 * Pass A (inbound → constitution) runs first and completes before Pass B.
 * Pass B (constitution → targets) always sees a fully-settled constitution.
 */
export async function runTwoPassSync(projectRoot, registry, rules) {
  const ctx  = buildRuleContext(projectRoot);
  const passA = rules.filter(r => r.pass === 'A');
  const passB = rules.filter(r => r.pass === 'B');

  logger.info(`Pass A — ${passA.length} inbound rule(s) (→ constitution)`);

  const passAResults = [];
  let   passAFailed  = false;

  for (const rule of passA) {
    const results = await executeRule(rule, projectRoot, registry, ctx);
    passAResults.push(...results);
    if (results.some(r => r.message.startsWith('Error:'))) passAFailed = true;
  }

  if (passAFailed) {
    logger.error('Pass A had errors — skipping Pass B to prevent writing stale headers.');
    await registry.save();
    return { passA: passAResults, passB: [] };
  }

  logger.br();
  logger.info(`Pass B — ${passB.length} outbound rule(s) (constitution →)`);

  // Rebuild context so Pass B sees constitution updated by Pass A
  const freshCtx     = buildRuleContext(projectRoot);
  const passBResults = [];

  for (const rule of passB) {
    const results = await executeRule(rule, projectRoot, registry, freshCtx);
    passBResults.push(...results);
  }

  await registry.save();
  return { passA: passAResults, passB: passBResults };
}

function defaultConstitution() {
  return `# Project Constitution

> Managed by SpecFuse. Sections inside \`<!-- specfuse:*:start/end -->\` are auto-generated.
> Do not edit content inside those markers — add custom rules below.

---

## Core Principles

*(Add your project's guiding principles here)*

## Technical Constraints

*(Add technical constraints here)*

## Code Standards

*(Add code quality and style rules here)*

## Security Rules

*(Add security requirements here)*
`;
}
