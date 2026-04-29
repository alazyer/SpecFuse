/**
 * Rule 1: .specfuse/plan/architecture.md → .specfuse/constitution.md [plan-decisions]
 * Rule 2: .specfuse/plan/prd.md          → .specfuse/constitution.md [plan-prd]
 *
 * Both source from the internal .specfuse/plan/ directory —
 * no external tool paths required.
 */

const ARCH_SECTIONS = [
  ['Architectural Decisions', 'Architecture Decisions', 'ADRs'],
  ['Tech Stack', 'Technology Stack', 'Technologies'],
  ['Constraints', 'Non-Functional Requirements', 'NFRs'],
  ['Security', 'Security Considerations', 'Security Rules'],
];

export const planArchRule = {
  id:      'plan:arch→constitution:plan-decisions',
  pass:    'A',
  source:  '.specfuse/plan/architecture.md',
  sources: ['.specfuse/plan/architecture.md'],
  target:  '.specfuse/constitution.md',
  section: 'plan-decisions',

  async extract(ctx) {
    const content = await ctx.read('.specfuse/plan/architecture.md');
    if (!content) return null;
    const parts = [];
    for (const group of ARCH_SECTIONS) {
      const found = ctx.extractH2SectionAny(content, group);
      if (found) parts.push({ heading: found.heading, content: found.content });
    }
    return parts.length ? parts : null;
  },

  transform(parts, ctx) {
    const sections = parts.map(({ heading, content }) =>
      `### From: ${heading}\n\n${ctx.contentToRules(heading, content)}`
    );
    return `> Auto-synced from \`.specfuse/plan/architecture.md\` by SpecFuse on ${ctx.today()}\n\n${sections.join('\n\n')}`;
  },
};

const PRD_SECTIONS = [
  ['Non-Functional Requirements', 'Non Functional Requirements', 'NFRs'],
  ['Technical Constraints', 'Tech Constraints', 'Constraints'],
  ['Tech Stack', 'Technology Stack'],
];

export const planPrdRule = {
  id:      'plan:prd→constitution:plan-prd',
  pass:    'A',
  source:  '.specfuse/plan/prd.md',
  sources: ['.specfuse/plan/prd.md'],
  target:  '.specfuse/constitution.md',
  section: 'plan-prd',

  async extract(ctx) {
    const content = await ctx.read('.specfuse/plan/prd.md');
    if (!content) return null;
    const parts = [];
    for (const group of PRD_SECTIONS) {
      const found = ctx.extractH2SectionAny(content, group);
      if (found) parts.push({ heading: found.heading, content: found.content });
    }
    return parts.length ? parts : null;
  },

  transform(parts, ctx) {
    const sections = parts.map(({ heading, content }) =>
      `### From: ${heading}\n\n${ctx.contentToRules(heading, content)}`
    );
    return `> Auto-synced from \`.specfuse/plan/prd.md\` by SpecFuse on ${ctx.today()}\n\n${sections.join('\n\n')}`;
  },
};
