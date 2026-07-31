/**
 * Template CLI commands — list, show, copy, validate.
 */

import chalk from 'chalk'
import { logger } from '../utils/logger.js'
import {
  resolveTemplate,
  listTemplates,
  getTemplateVariables,
  extractVariableReferences,
  validateAllCustomTemplates,
  copyTemplate,
  suggestTemplateName,
  TEMPLATE_NAME_MAP,
} from '../core/template-resolver.js'

// ── specfuse template list ──────────────────────────────────────────────────

/**
 * List all available templates with override status.
 * @param {string} projectRoot
 * @param {{ json?: boolean }} [options]
 */
export async function templateListCommand(projectRoot, options = {}) {
  const templates = await listTemplates(projectRoot)

  if (options.json) {
    console.log(JSON.stringify({ templates }, null, 2))
    return
  }

  // Group by category
  const groups = {}
  for (const t of templates) {
    if (!groups[t.category]) groups[t.category] = []
    groups[t.category].push(t)
  }

  for (const [category, items] of Object.entries(groups)) {
    logger.header(`${categoryLabel(category)}`)
    for (const t of items) {
      const override = t.custom ? chalk.yellow(' (custom)') : ''
      console.log(`  ${chalk.green('◦')}  ${chalk.bold(t.name.padEnd(18))} ${chalk.dim(t.label)}${override}`)
    }
    logger.br()
  }

  logger.info(`${templates.length} templates (${templates.filter((t) => t.custom).length} customized)`)
  logger.br()
}

// ── specfuse template show ──────────────────────────────────────────────────

/**
 * Display a template with optional variable documentation.
 * @param {string} projectRoot
 * @param {string} name - Template name
 * @param {{ vars?: boolean, json?: boolean }} [options]
 */
export async function templateShowCommand(projectRoot, name, options = {}) {
  const resolved = await resolveTemplate(projectRoot, name)

  if (!resolved) {
    logger.error(`Unknown template: '${name}'`)
    const suggestions = suggestTemplateName(name)
    if (suggestions.length > 0) {
      logger.info(
        `Did you mean: ${suggestions.map((s) => chalk.cyan(s)).join(chalk.dim(' | '))}?`,
      )
    }
    logger.info('Run `specfuse template list` to see available templates.')
    process.exit(1)
  }

  const vars = getTemplateVariables(resolved.content)
  const extractedRefs = extractVariableReferences(resolved.content)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          name,
          content: resolved.content,
          source: resolved.source,
          variables: vars.length > 0 ? vars : extractedRefs.map((r) => ({ name: r, description: '' })),
        },
        null,
        2,
      ),
    )
    return
  }

  const sourceLabel = resolved.source === 'custom' ? chalk.yellow('custom') : chalk.dim('builtin')

  logger.header(`Template: ${chalk.bold(name)}  (${sourceLabel})`)
  logger.br()

  if (options.vars) {
    logger.header('Variables')
    const displayVars = vars.length > 0 ? vars : extractedRefs.map((r) => ({ name: r, description: '(auto-detected)' }))
    if (displayVars.length === 0) {
      logger.info(chalk.dim('No variables found in this template.'))
    } else {
      for (const v of displayVars) {
        logger.row(`  {{${v.name}}}`, v.description, chalk.cyan)
      }
    }
    logger.br()
  }

  logger.header('Content')
  console.log(resolved.content)
  logger.br()
}

// ── specfuse template copy ──────────────────────────────────────────────────

/**
 * Copy a built-in template to .specfuse/templates/ for customization.
 * @param {string} projectRoot
 * @param {string} name - Template name
 * @param {{ force?: boolean }} [options]
 */
export async function templateCopyCommand(projectRoot, name, options = {}) {
  if (!TEMPLATE_NAME_MAP[name]) {
    logger.error(`Unknown template: '${name}'`)
    const suggestions = suggestTemplateName(name)
    if (suggestions.length > 0) {
      logger.info(
        `Did you mean: ${suggestions.map((s) => chalk.cyan(s)).join(chalk.dim(' | '))}?`,
      )
    }
    logger.info('Run `specfuse template list` to see available templates.')
    process.exit(1)
  }

  try {
    const result = await copyTemplate(projectRoot, name, { force: options.force })

    if (result.alreadyExists) {
      logger.warn(`Template '${name}' already has a custom version at ${chalk.cyan(result.destPath)}`)
      logger.info(`Use ${chalk.cyan('--force')} to overwrite.`)
      logger.br()
      return
    }

    logger.br()
    logger.success(`Copied template '${chalk.bold(name)}' to ${chalk.cyan(result.destPath)}`)
    logger.br()
    logger.info('Edit the copy to customize. SpecFuse will use your version instead of the built-in.')
    logger.info(`To restore the default: delete ${chalk.cyan(result.destPath)}`)
    logger.br()
  } catch (err) {
    logger.error(err.message)
    process.exit(1)
  }
}

// ── specfuse template validate ──────────────────────────────────────────────

/**
 * Validate all custom templates in .specfuse/templates/.
 * @param {string} projectRoot
 * @param {{ json?: boolean }} [options]
 */
export async function templateValidateCommand(projectRoot, options = {}) {
  const results = await validateAllCustomTemplates(projectRoot)

  if (options.json) {
    console.log(JSON.stringify({ results, valid: results.every((r) => r.valid) }, null, 2))
    if (!results.every((r) => r.valid)) process.exit(1)
    return
  }

  if (results.length === 0) {
    logger.info('No custom templates found in .specfuse/templates/')
    logger.br()
    logger.info(`Run ${chalk.cyan('specfuse template copy <name>')} to create one.`)
    logger.br()
    return
  }

  logger.header('Custom Template Validation')
  logger.br()

  let allValid = true
  for (const r of results) {
    const icon = r.valid ? chalk.green('✔') : chalk.red('✖')
    console.log(`  ${icon}  ${chalk.bold(r.path)}`)
    if (!r.valid) {
      allValid = false
      for (const e of r.errors) {
        console.log(`     ${chalk.dim(`line ${e.line}:`)} ${chalk.red(e.message)}`)
      }
    }
  }

  logger.br()
  if (allValid) {
    logger.success(`All ${results.length} custom template(s) are valid.`)
  } else {
    const invalidCount = results.filter((r) => !r.valid).length
    logger.error(`${invalidCount} template(s) have validation errors.`)
    process.exit(1)
  }
  logger.br()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function categoryLabel(cat) {
  const labels = {
    plan: 'Plan',
    'plan/design': 'Plan / Design',
    change: 'Change',
    specify: 'Specify',
  }
  return labels[cat] ?? cat
}
