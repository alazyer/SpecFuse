const PHASE_ADVICE = {
  unknown: {
    summary: 'Get to your first working SpecFuse baseline.',
    statusAction: 'Run `specfuse init` to start a new project or import an existing one',
    steps: [
      {
        command: 'specfuse init --name "My Project"',
        reason: 'Set up SpecFuse in this repository.',
      },
      { command: 'specfuse plan prd', reason: "Write what you're building and why." },
      { command: 'specfuse plan arch', reason: 'Write how it will be built.' },
      { command: 'specfuse specify init', reason: 'Create one shared rules file from your plan.' },
      { command: 'specfuse sync', reason: 'Apply those rules across your spec files.' },
    ],
  },
  planning: {
    summary: 'SpecFuse is set up. Now create your planning baseline.',
    statusAction:
      'Run `specfuse specify init` to generate constitution.md from your plan, then `specfuse sync`',
    steps: [
      { command: 'specfuse plan prd', reason: "Write what you're building and why." },
      { command: 'specfuse plan arch', reason: 'Write how it will be built.' },
      { command: 'specfuse specify init', reason: 'Create one shared rules file from your plan.' },
      { command: 'specfuse sync', reason: 'Apply those rules across your spec files.' },
    ],
  },
  'feature-dev': {
    summary: 'Drive feature work through change proposals with synced constitutional constraints.',
    statusAction:
      'Run `specfuse change new <name>` to start a change proposal, then `specfuse watch`',
    steps: [
      {
        command: 'specfuse change new <name>',
        reason: 'Create proposal/design/tasks templates under .specfuse/changes/ for the next change.',
      },
      {
        command: 'specfuse sync',
        reason: 'Inject constitutional constraints and refresh synced sections.',
      },
      {
        command: 'specfuse change review <name>',
        reason: 'Generate review.md and complete review checklist.',
      },
      {
        command: 'specfuse change verify <name>',
        reason: 'Generate verify.md and confirm acceptance criteria.',
      },
    ],
  },
  maintenance: {
    summary: 'Archive completed changes and keep constitutional history in sync.',
    statusAction:
      'Run `specfuse change archive <name>` when a change is done, then `specfuse sync`',
    steps: [
      {
        command: 'specfuse change list',
        reason: 'Inspect active and archived change status before closing work.',
      },
      {
        command: 'specfuse change archive <name>',
        reason: 'Archive a delivered change after verification pass.',
      },
      {
        command: 'specfuse sync',
        reason: 'Update implemented-features and downstream managed sections.',
      },
      {
        command: 'specfuse status',
        reason: 'Confirm overall project health, drift, and phase readiness.',
      },
    ],
  },
}

/**
 * @param {string} phase
 */
export function getPhaseAdvice(phase) {
  return PHASE_ADVICE[phase] ?? PHASE_ADVICE.unknown
}
