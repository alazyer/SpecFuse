/**
 * Template API — list, show, copy, and validate templates.
 *
 * All functions return structured data objects, never log to console,
 * and throw typed errors instead of calling process.exit.
 */

import { resolve as resolvePath } from 'path'
import {
  resolveTemplate,
  listTemplates,
  getTemplateVariables,
  extractVariableReferences,
  validateTemplate,
  validateAllCustomTemplates,
  copyTemplate,
  suggestTemplateName,
  TEMPLATE_NAME_MAP,
} from '../core/template-resolver.js'

/**
 * Resolve a project root path.
 * @param {string} root
 * @returns {string}
 */
function resolveRoot(root) {
  return resolvePath(root ?? '.')
}

/**
 * List all available templates with override status.
 *
 * @param {string} root - Project root path
 * @returns {Promise<Array<{name: string, label: string, category: string, custom: boolean, builtinPath: string|null}>>}
 */
export async function list(root) {
  return listTemplates(resolveRoot(root))
}

/**
 * Show a template with variable documentation.
 *
 * @param {string} root - Project root path
 * @param {string} name - Template name
 * @returns {Promise<{name: string, content: string, source: string, variables: Array<{name: string, description: string}>}|null>}
 */
export async function show(root, name) {
  const projectRoot = resolveRoot(root)
  const resolved = await resolveTemplate(projectRoot, name)

  if (!resolved) return null

  const vars = getTemplateVariables(resolved.content)
  const extractedRefs = extractVariableReferences(resolved.content)

  return {
    name,
    content: resolved.content,
    source: resolved.source,
    variables: vars.length > 0 ? vars : extractedRefs.map((r) => ({ name: r, description: '' })),
  }
}

/**
 * Copy a built-in template to .specfuse/templates/ for customization.
 *
 * @param {string} root - Project root path
 * @param {string} name - Template name
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{destPath: string, created: boolean, alreadyExists: boolean}>}
 */
export async function copy(root, name, options = {}) {
  return copyTemplate(resolveRoot(root), name, options)
}

/**
 * Validate all custom templates in .specfuse/templates/.
 *
 * @param {string} root - Project root path
 * @returns {Promise<Array<{path: string, valid: boolean, errors: Array<{line: number, message: string}>}>>}
 */
export async function validate(root) {
  return validateAllCustomTemplates(resolveRoot(root))
}

/**
 * Validate a single template's syntax.
 *
 * @param {string} content - Template content
 * @returns {{valid: boolean, errors: Array<{line: number, message: string}>}}
 */
export { validateTemplate }

/**
 * Get template variable documentation from @vars block.
 *
 * @param {string} content - Template content
 * @returns {Array<{name: string, description: string}>}
 */
export { getTemplateVariables }

/**
 * Extract all {{variable}} references from template content.
 *
 * @param {string} content
 * @returns {string[]}
 */
export { extractVariableReferences }

/**
 * Suggest close matches for an invalid template name.
 *
 * @param {string} input
 * @returns {string[]}
 */
export { suggestTemplateName }

/**
 * Template name map for reference.
 */
export { TEMPLATE_NAME_MAP }
