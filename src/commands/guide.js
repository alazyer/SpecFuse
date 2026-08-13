import { basename, join } from 'path'
import { readdir } from 'fs/promises'
import chalk from 'chalk'
import { pathExists } from '../utils/fs.js'
import { detectPhase } from '../core/phase-detector.js'
import { getPhaseAdvice } from '../core/workflow-advice.js'
import { logger } from '../utils/logger.js'
import { ARTIFACT_ROOTS } from '../core/registry.js'

const PERSONAS = new Set(['new-user', 'planner', 'developer', 'qa'])
const PERSONA_LABEL = {
  'new-user': 'New User',
  planner: 'Planner',
  developer: 'Developer',
  qa: 'QA',
}

function parsePersona(persona) {
  const raw = String(persona ?? 'new-user')
    .trim()
    .toLowerCase()
  if (raw === 'new' || raw === 'beginner') return { persona: 'new-user', valid: true, raw }
  if (PERSONAS.has(raw)) return { persona: raw, valid: true, raw }
  return { persona: 'new-user', valid: false, raw }
}

function addStep(steps, command, reason) {
  if (steps.some((step) => step.command === command)) return
  steps.push({ command, reason })
}

async function countMarkdownFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length
  } catch {
    return 0
  }
}

async function countDirectories(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).length
  } catch {
    return 0
  }
}

async function listDirectories(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function collectGuideState(projectRoot) {
  const hasWorkspace = pathExists(join(projectRoot, '.specfuse'))
  const isGitRepo = pathExists(join(projectRoot, '.git'))
  const hasPrd = pathExists(join(projectRoot, '.specfuse', 'plan', 'prd.md'))
  const hasArch = pathExists(join(projectRoot, '.specfuse', 'plan', 'architecture.md'))
  const hasDesignSystem = pathExists(join(projectRoot, '.specfuse', 'plan', 'design', 'system.md'))
  const hasConstitution = pathExists(join(projectRoot, '.specfuse', 'constitution.md'))
  const storyCount = await countMarkdownFiles(join(projectRoot, '.specfuse', 'plan', 'stories'))
  const activeChangeNames = (
    await listDirectories(join(projectRoot, '.specfuse', 'changes'))
  ).filter((name) => name !== 'archive')
  const archivedChanges = await countDirectories(
    join(projectRoot, '.specfuse', 'changes', 'archive'),
  )
  const { phase } = await detectPhase(projectRoot)

  return {
    phase,
    projectName: basename(projectRoot),
    hasWorkspace,
    isGitRepo,
    hasPrd,
    hasArch,
    hasDesignSystem,
    hasConstitution,
    storyCount,
    activeChanges: activeChangeNames.length,
    activeChangeNames,
    archivedChanges,
  }
}

function removeStep(steps, command) {
  const index = steps.findIndex((step) => step.command === command)
  if (index >= 0) steps.splice(index, 1)
}

function partitionGuideSteps(guidance) {
  const doNowSteps = guidance.steps.slice(0, 4)
  const nextSteps = guidance.steps.slice(4)

  if (
    (guidance.effectivePhase === 'unknown' || guidance.effectivePhase === 'planning') &&
    ![...doNowSteps, ...nextSteps].some((step) => step.command === 'specfuse change new <name>')
  ) {
    nextSteps.push({
      command: 'specfuse change new <name>',
      reason: 'Start your first change after the baseline is ready.',
    })
  }

  return { doNowSteps, nextSteps }
}

function buildGuidance(state, persona) {
  const effectivePhase = state.phase === 'unknown' && state.hasWorkspace ? 'planning' : state.phase
  const phaseAdvice = getPhaseAdvice(effectivePhase)
  const steps = phaseAdvice.steps.map((step) => ({ ...step }))
  const focus = phaseAdvice.summary

  if (!state.hasWorkspace) {
    return {
      focus: 'Get to your first working SpecFuse baseline.',
      steps: [
        {
          command: `specfuse init --name "${state.projectName}"`,
          reason: 'Set up SpecFuse in this repository.',
        },
        {
          command: 'specfuse plan prd && specfuse plan arch',
          reason: "Write what you're building and why, then write how it will be built.",
        },
        {
          command: 'specfuse specify init && specfuse sync',
          reason:
            'Create one shared rules file from your plan, then apply those rules across your spec files.',
        },
      ],
      effectivePhase: 'unknown',
    }
  }

  if (effectivePhase === 'planning' || !state.hasConstitution) {
    if (state.hasPrd) removeStep(steps, 'specfuse plan prd')
    if (state.hasArch) removeStep(steps, 'specfuse plan arch')
    if (state.hasConstitution) removeStep(steps, 'specfuse specify init')
    if (!state.hasDesignSystem)
      addStep(
        steps,
        'specfuse plan design system',
        'Create reusable design constraints for UI consistency.',
      )
    if (state.storyCount === 0)
      addStep(
        steps,
        'specfuse plan story "First story"',
        'Seed user stories so constitutional user-story sections stay meaningful.',
      )
    return { focus, steps, effectivePhase }
  }

  if (effectivePhase === 'feature-dev') {
    if (state.activeChanges > 0) removeStep(steps, 'specfuse change new <name>')
    if (persona === 'developer')
      addStep(
        steps,
        'specfuse watch',
        'Keep sync automatic while editing planning or change artifacts.',
      )
    if (persona === 'qa')
      addStep(
        steps,
        'specfuse drift --fail',
        'Use CI-friendly drift checks to block stale spec state.',
      )
    return { focus, steps, effectivePhase }
  }

  if (state.activeChanges === 0) removeStep(steps, 'specfuse change list')
  if (persona === 'qa')
    addStep(steps, 'specfuse doctor', 'Run diagnostics to catch malformed or incomplete artifacts.')
  return { focus, steps, effectivePhase }
}

/**
 * @param {string} projectRoot
 * @param {{ persona?: string, json?: boolean }} [options]
 */
export async function guideCommand(projectRoot, options = {}) {
  const { persona, valid: personaValid, raw: rawPersona } = parsePersona(options.persona)
  const state = await collectGuideState(projectRoot)
  const guidance = buildGuidance(state, persona)
  const phaseLabel =
    guidance.effectivePhase === state.phase
      ? state.phase
      : `${state.phase} -> ${guidance.effectivePhase}`
  const missing = []
  if (!state.hasPrd) missing.push('PRD')
  if (!state.hasArch) missing.push('Architecture')
  if (!state.hasConstitution) missing.push('Constitution')
  const warnings = []
  if (!personaValid)
    warnings.push(
      `Unknown persona '${rawPersona}'. Using 'new-user'. Allowed: new-user, planner, developer, qa.`,
    )
  if (!state.isGitRepo)
    warnings.push(
      'No .git directory found at --root. If you are in a subdirectory, rerun with --root <repository-root>.',
    )

  if (options.json) {
    const { doNowSteps, nextSteps } = partitionGuideSteps(guidance)
    console.log(
      JSON.stringify(
        {
          persona,
          personaInput: rawPersona,
          personaValid,
          phase: state.phase,
          effectivePhase: guidance.effectivePhase,
          focus: guidance.focus,
          missingArtifacts: missing,
          warnings,
          isGitRepo: state.isGitRepo,
          activeChanges: state.activeChanges,
          activeChangesRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE,
          archivedChanges: state.archivedChanges,
          archivedChangesRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ARCHIVE,
          governanceChangesRoot: ARTIFACT_ROOTS.GOVERNANCE_CHANGES,
          storyCount: state.storyCount,
          doNowSteps,
          nextSteps,
          steps: [...doNowSteps, ...nextSteps],
        },
        null,
        2,
      ),
    )
    return
  }

  logger.header('SpecFuse Guide  v1')
  logger.row('Persona', PERSONA_LABEL[persona], chalk.cyan)
  logger.row('Phase', phaseLabel, chalk.yellowBright)
  logger.row(
    'Active changes',
    String(state.activeChanges),
    state.activeChanges ? chalk.cyan : chalk.dim,
  )
  logger.row(
    'Archived changes',
    String(state.archivedChanges),
    state.archivedChanges ? chalk.green : chalk.dim,
  )
  logger.br()

  warnings.forEach((w) => logger.warn(w))
  if (warnings.length) logger.br()

  logger.info(guidance.focus)

  if (missing.length) logger.info(`Missing baseline artifacts: ${chalk.yellow(missing.join(', '))}`)

  const { doNowSteps, nextSteps } = partitionGuideSteps(guidance)
  logger.br()
  logger.header('Do These Now')
  const doNowTotal = doNowSteps.length
  doNowSteps.forEach((step, index) => {
    console.log(`  ${chalk.bold(`Step ${index + 1} of ${doNowTotal}`)} ${chalk.cyan(step.command)}`)
    console.log(`     ${chalk.dim(step.reason)}`)
  })

  if (nextSteps.length) {
    logger.br()
    logger.header('Next (Optional)')
    nextSteps.forEach((step, index) => {
      console.log(`  ${chalk.bold(`${index + 1}.`)} ${chalk.cyan(step.command)}`)
      console.log(`     ${chalk.dim(step.reason)}`)
    })
  }

  logger.br()
  logger.success('If these commands succeed, your baseline is ready.')
  logger.info(`Need full command reference? Run ${chalk.cyan('specfuse --help')}`)
  logger.br()
}
