import { readFileSafe, listFiles } from '../utils/fs.js'
import {
  extractH2Section,
  extractH2SectionAny,
  extractAllH2Sections,
  hashContent,
  contentToRules,
  readManagedSection,
} from '../utils/markdown.js'

/**
 * Build a frozen context object for a sync rule to use.
 * Rules may not access the filesystem or registry directly — only through this API.
 *
 * @param {string} projectRoot
 * @returns {Readonly<RuleContext>}
 */
export function buildRuleContext(projectRoot) {
  const ctx = {
    projectRoot,

    // ── File I/O (read-only) ────────────────────────────────────────────
    /** @param {string} relativePath */
    read: (relativePath) =>
      readFileSafe(relativePath.startsWith('/') ? relativePath : `${projectRoot}/${relativePath}`),

    /** @param {string} dir  @param {string} ext */
    listFiles: (dir, ext) => listFiles(dir.startsWith('/') ? dir : `${projectRoot}/${dir}`, ext),

    // ── Markdown helpers ─────────────────────────────────────────────────
    extractH2Section,
    extractH2SectionAny,
    extractAllH2Sections,
    readManagedSection,
    contentToRules,
    hashContent,

    // ── Date helper ──────────────────────────────────────────────────────
    today: () => new Date().toISOString().slice(0, 10),
  }

  return Object.freeze(ctx)
}
