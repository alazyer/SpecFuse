import { join }    from 'path';
import { readFileSafe, writeFileAtomic, pathExists } from '../../utils/fs.js';
import { upsertManagedSection, readManagedSection, extractAllH2Sections, stripManagedSections } from '../../utils/markdown.js';
import { Registry } from '../../core/registry.js';
import { loadRules } from '../../core/rule-loader.js';
import { runTwoPassSync } from '../../core/sync-engine.js';
import { logger }   from '../../utils/logger.js';
import chalk from 'chalk';

const CONSTITUTION_TEMPLATE = `# Project Constitution

> The single authoritative source of project constraints, standards, and architectural rules.
> Managed by SpecFuse. Sections inside \`<!-- specfuse:*:start/end -->\` are auto-generated.
> Add your own rules in the non-managed sections below.

---

## Core Principles

*(Add your project's guiding principles here)*

## Technical Constraints

*(Add technical constraints here — not covered by architecture or PRD)*

## Code Standards

*(Code quality, naming conventions, test coverage thresholds, style rules)*

## Security Rules

*(Authentication, secrets management, input validation, data handling)*

## Performance Budgets

*(Page load targets, API latency, bundle size limits)*
`;

// ── specfuse specify init ─────────────────────────────────────────────────────

/**
 * Create constitution.md and optionally sync from plan artifacts immediately.
 * @param {string} projectRoot
 * @param {{ sync?: boolean }} [options]
 */
export async function specifyInit(projectRoot, options = {}) {
  logger.header('SpecFuse Specify Init');
  logger.br();

  const constitutionPath = join(projectRoot, '.specfuse', 'constitution.md');

  if (pathExists(constitutionPath) && !options.force) {
    logger.info(`constitution.md already exists.`);
    logger.info(`Run ${chalk.cyan('specfuse specify show')} to view it.`);
    logger.info(`Run ${chalk.cyan('specfuse specify init --force')} to recreate from template.`);
    logger.br();
    return;
  }

  await writeFileAtomic(constitutionPath, CONSTITUTION_TEMPLATE);
  logger.success('Created constitution.md');

  // Auto-sync plan artifacts if they exist
  const hasPrd  = pathExists(join(projectRoot, '.specfuse', 'plan', 'prd.md'));
  const hasArch = pathExists(join(projectRoot, '.specfuse', 'plan', 'architecture.md'));

  if ((hasPrd || hasArch) && options.sync !== false) {
    logger.br();
    logger.info('Plan artifacts detected — syncing decisions into constitution.md…');
    const registry = new Registry(projectRoot);
    await registry.load();
    const rules = await loadRules(projectRoot);
    const { passA } = await runTwoPassSync(projectRoot, registry, rules.filter(r => r.pass === 'A'));
    const synced = passA.filter(r => r.changed).length;
    if (synced > 0) logger.success(`Synced ${synced} plan section(s) into constitution.md`);
  }

  logger.br();
  logger.header('Next Steps');
  logger.info(`1. Edit ${chalk.cyan('.specfuse/constitution.md')} — add your own rules in the non-managed sections`);
  logger.info(`2. Run ${chalk.cyan('specfuse sync')} to keep it current`);
  logger.info(`3. Run ${chalk.cyan('specfuse change new <n>')} to start building features`);
  logger.br();
}

// ── specfuse specify add ──────────────────────────────────────────────────────

/**
 * Add or update a named rule section in constitution.md.
 * @param {string} projectRoot
 * @param {string} sectionName   Heading for the new section (e.g. 'API Standards')
 * @param {string} [content]     Section body (defaults to placeholder)
 */
export async function specifyAdd(projectRoot, sectionName, content) {
  const constitutionPath = join(projectRoot, '.specfuse', 'constitution.md');

  if (!pathExists(constitutionPath)) {
    logger.error('constitution.md not found.');
    logger.info(`Run ${chalk.cyan('specfuse specify init')} first.`);
    process.exit(1);
  }

  const existing = await readFileSafe(constitutionPath);
  const body     = content ?? `*(Add ${sectionName} rules here)*`;

  // Check if the section already exists as a regular H2
  const hasSection = existing.includes(`## ${sectionName}`);

  let updated;
  if (hasSection) {
    // Replace existing section content
    const lines   = existing.split('\n');
    const result  = [];
    let inSection = false;
    for (const line of lines) {
      if (line === `## ${sectionName}`) { inSection = true; result.push(line); continue; }
      if (inSection && line.startsWith('## ')) { inSection = false; }
      if (!inSection) result.push(line);
      else if (inSection && result[result.length-1] === `## ${sectionName}`) {
        result.push(''); result.push(body); result.push('');
      }
    }
    updated = result.join('\n');
    logger.info(`Updated section: ${chalk.bold(sectionName)}`);
  } else {
    // Append a new section before the managed sections marker
    const stripped = stripManagedSections(existing).trimEnd();
    updated = `${stripped}\n\n## ${sectionName}\n\n${body}\n`;
    logger.success(`Added section: ${chalk.bold(sectionName)}`);
  }

  await writeFileAtomic(constitutionPath, updated);
  logger.info(`Run ${chalk.cyan('specfuse sync')} to propagate this section to change proposals.`);
  logger.br();
}

// ── specfuse specify show ─────────────────────────────────────────────────────

/**
 * Pretty-print the current constitution, separating user sections from managed sections.
 * @param {string} projectRoot
 */
export async function specifyShow(projectRoot) {
  const constitutionPath = join(projectRoot, '.specfuse', 'constitution.md');

  if (!pathExists(constitutionPath)) {
    logger.error('constitution.md not found.');
    logger.info(`Run ${chalk.cyan('specfuse specify init')} to create one.`);
    process.exit(1);
  }

  const content  = await readFileSafe(constitutionPath);
  const sections = extractAllH2Sections(content);

  // Detect managed sections
  const managedSections = [
    'plan-decisions', 'plan-prd', 'user-stories', 'implemented-features',
  ].filter(s => content.includes(`<!-- specfuse:${s}:start -->`));

  logger.header('.specfuse/constitution.md');
  logger.br();
  logger.header('User-defined Sections');

  for (const s of sections) {
    if (s.heading.startsWith('[SpecFuse')) continue;
    console.log(`  ${chalk.bold.cyan('##')} ${chalk.bold(s.heading)}`);
    const preview = s.content.split('\n')
      .filter(l => l.trim()).slice(0, 3)
      .map(l => `     ${chalk.dim(l)}`).join('\n');
    if (preview) console.log(preview);
    logger.br();
  }

  if (managedSections.length) {
    logger.header('Managed Sections (auto-synced by SpecFuse)');
    for (const ms of managedSections) {
      const body = readManagedSection(content, ms);
      const lineCount = body?.split('\n').filter(l => l.trim()).length ?? 0;
      console.log(`  ${chalk.dim('⇄')}  ${chalk.dim(ms)}  ${chalk.dim(`(${lineCount} lines)`)}`);
    }
    logger.br();
  }

  logger.info(`To update: edit ${chalk.cyan('.specfuse/constitution.md')} or run ${chalk.cyan('specfuse specify add <section>')}`);
  logger.info(`To sync managed sections: ${chalk.cyan('specfuse sync')}`);
  logger.br();
}
