import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_DIR = join(__dirname, '..', '..', 'rules')

/**
 * @typedef {object} SyncRule
 * @property {string}    id
 * @property {'A'|'B'}  pass
 * @property {string}    source         Logical source ID (used as registry key)
 * @property {string[]} [sources]       All file paths that trigger this rule (for watch routing)
 * @property {string}    target
 * @property {string}    section
 * @property {boolean}  [isMultiTarget]
 * @property {Function}  extract        async (ctx) → data | null
 * @property {Function}  transform      (data, ctx) → string
 * @property {Function} [resolveTargets] async (ctx) → string[]
 */

const BUILTIN_RULE_FILES = [
  join(RULES_DIR, 'plan-to-constitution.rule.mjs'),
  join(RULES_DIR, 'changes-and-stories.rule.mjs'),
]

const REQUIRED = ['id', 'pass', 'source', 'target', 'section', 'extract', 'transform']

/**
 * Load all sync rules: built-in rules + optional .specfuse/rules.mjs plugins.
 *
 * @param {string} projectRoot
 * @param {{ allowPlugins?: boolean }} [options]
 * @returns {Promise<SyncRule[]>}
 */
export async function loadRules(projectRoot, options = {}) {
  const rules = []

  for (const filePath of BUILTIN_RULE_FILES) {
    try {
      const mod = await import(`file://${filePath}?t=1`)
      const candidates = Object.values(mod).filter((v) => v && typeof v === 'object' && v.id)
      for (const rule of candidates) {
        const v = validateRule(rule, filePath)
        if (v) rules.push(v)
      }
    } catch (err) {
      logger.warn(`Built-in rule load failed (${filePath}): ${err.message}`)
    }
  }

  // User plugin rules
  const userRulesPath = join(projectRoot, '.specfuse', 'rules.mjs')
  if (pathExists(userRulesPath)) {
    const isCi = process.env.CI === 'true'
    if (isCi && !options.allowPlugins) {
      logger.warn('User plugin rules skipped in CI (--allow-plugins not set).')
    } else {
      try {
        const mod = await import(`file://${userRulesPath}?t=${Date.now()}`)
        const userRules = Array.isArray(mod.default) ? mod.default : []
        for (const rule of userRules) {
          const v = validateRule(rule, userRulesPath)
          if (v) {
            rules.push(v)
            logger.info(`Loaded plugin rule: ${rule.id}`)
          }
        }
      } catch (err) {
        logger.error(`Failed to load .specfuse/rules.mjs: ${err.message}`)
      }
    }
  }

  logger.debug(`Loaded ${rules.length} rule(s): ${rules.map((r) => r.id).join(', ')}`)
  return rules
}

function validateRule(rule, src) {
  for (const f of REQUIRED) {
    if (rule[f] == null) {
      logger.error(`Rule in ${src} missing '${f}' (id: ${rule.id ?? '?'})`)
      return null
    }
  }
  if (!['A', 'B'].includes(rule.pass)) {
    logger.error(`Rule '${rule.id}': pass must be 'A' or 'B'`)
    return null
  }
  return rule
}
