/**
 * Rule 3: .specfuse/plan/stories/ → .specfuse/constitution.md [user-stories]
 * Rule 4: .specfuse/changes/archive/ → .specfuse/constitution.md [implemented-features]
 * Rule 5: .specfuse/constitution.md → .specfuse/changes/*\/proposal.md [constitution-header]
 */
import { join, basename } from 'path';
import { readdir, access } from 'fs/promises';

async function dirExists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** Rule 3 */
export const storiesRule = {
  id:      'plan:stories→constitution:user-stories',
  pass:    'A',
  source:  '.specfuse/plan/stories',
  sources: ['.specfuse/plan/stories'],
  target:  '.specfuse/constitution.md',
  section: 'user-stories',

  async extract(ctx) {
    const dir = join(ctx.projectRoot, '.specfuse', 'plan', 'stories');
    if (!(await dirExists(dir))) return null;
    const files = await ctx.listFiles(dir, '.md');
    if (!files.length) return null;

    const stories = [];
    for (const file of files) {
      const content = await ctx.read(file);
      if (!content) continue;
      const title  = content.match(/^#\s+Story:\s+(.+)$/m)?.[1]
                  ?? content.match(/^#\s+(.+)$/m)?.[1]
                  ?? basename(file);
      const acSec  = ctx.extractH2SectionAny(content,
        ['Acceptance Criteria', 'AC', 'Done When', 'Criteria']);
      const ac = acSec
        ? acSec.content.split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('- ['))
            .slice(0, 3)
        : [];
      stories.push({ file: basename(file), title, ac });
    }
    return stories.length ? stories : null;
  },

  transform(stories, ctx) {
    const lines = stories.flatMap(s => [
      `### ${s.title} (\`${s.file}\`)`,
      ...s.ac.map(a => `- ${a.replace(/^-\s*\[[ x]\]\s*/, '')}`),
      '',
    ]);
    return `> Auto-synced from \`.specfuse/plan/stories/\` by SpecFuse on ${ctx.today()}\n\n${lines.join('\n')}`;
  },
};

/** Rule 4 */
export const archiveRule = {
  id:      'changes:archive→constitution:implemented-features',
  pass:    'A',
  source:  '.specfuse/changes/archive',
  sources: ['.specfuse/changes/archive'],
  target:  '.specfuse/constitution.md',
  section: 'implemented-features',

  async extract(ctx) {
    const archiveDir = join(ctx.projectRoot, '.specfuse', 'changes', 'archive');
    if (!(await dirExists(archiveDir))) return null;
    const entries = await readdir(archiveDir, { withFileTypes: true }).catch(() => []);
    const dirs    = entries.filter(e => e.isDirectory());
    if (!dirs.length) return null;

    const items = [];
    for (const d of dirs) {
      const proposalPath = join(archiveDir, d.name, 'proposal.md');
      const content = await ctx.read(proposalPath);
      if (!content) continue;
      const titleMatch    = content.match(/^#\s+Change Proposal:\s+(.+)$/m)
                         ?? content.match(/^#\s+(.+)$/m);
      const overviewSec   = ctx.extractH2SectionAny(content, ['Overview', 'Summary']);
      const summary = overviewSec
        ? overviewSec.content.split(/[.!?\n]/)[0].trim()
        : (titleMatch?.[1] ?? d.name);
      items.push({ name: d.name, summary });
    }
    return items.length ? items : null;
  },

  transform(items, ctx) {
    const lines = items.map(i => `- [archived] \`${i.name}\`: ${i.summary}`);
    return `> Auto-synced from \`.specfuse/changes/archive/\` by SpecFuse on ${ctx.today()}\n\n${lines.join('\n')}`;
  },
};

/** Rule 5 */
export const constitutionToChangesRule = {
  id:            'constitution→changes:proposal-headers',
  pass:          'B',
  source:        '.specfuse/constitution.md',
  sources:       ['.specfuse/constitution.md'],
  target:        '.specfuse/changes',
  section:       'constitution-header',
  isMultiTarget: true,

  async extract(ctx) {
    const content = await ctx.read('.specfuse/constitution.md');
    return content ?? null;
  },

  transform(constitutionContent, ctx) {
    const sections = ctx.extractAllH2Sections(constitutionContent)
      .filter(s => !s.heading.startsWith('[SpecFuse'))
      .map(s => `### ${s.heading}\n\n${s.content}`)
      .join('\n\n');
    return (
      `> Constitutional constraints — auto-synced by SpecFuse on ${ctx.today()}\n` +
      `> Review before implementing this change.\n\n` +
      sections
    );
  },

  async resolveTargets(ctx) {
    const changesDir = join(ctx.projectRoot, '.specfuse', 'changes');
    if (!(await dirExists(changesDir))) return [];
    const entries = await readdir(changesDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(e => e.isDirectory() && e.name !== 'archive')
      .map(e => join(changesDir, e.name, 'proposal.md'));
  },
};
