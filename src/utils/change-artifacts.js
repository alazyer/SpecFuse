import matter from 'gray-matter'
import { extractAllH2Sections, extractH2SectionAny } from './markdown.js'

export const CHANGE_STATUS_ORDER = ['draft', 'active', 'reviewed', 'verified', 'archived']
export const REVIEW_STATUS_ORDER = ['pending', 'approved', 'rejected']
export const VERIFY_STATUS_ORDER = ['unverified', 'pass', 'fail']

export function slugifyName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function titleCaseChangeName(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function parseFrontmatterDocument(content = '') {
  const parsed = matter(content)
  return {
    data: parsed.data ?? {},
    content: parsed.content ?? '',
  }
}

export function stringifyFrontmatterDocument(document, data) {
  const parsed = parseFrontmatterDocument(document)
  return matter.stringify(parsed.content.trimStart(), data)
}

export function normalizeChangeStatus(status, fallback = 'active') {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase()
  return CHANGE_STATUS_ORDER.includes(normalized) ? normalized : fallback
}

export function normalizeReviewStatus(status, fallback = 'pending') {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase()
  return REVIEW_STATUS_ORDER.includes(normalized) ? normalized : fallback
}

export function normalizeVerifyStatus(status, fallback = 'unverified') {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase()
  return VERIFY_STATUS_ORDER.includes(normalized) ? normalized : fallback
}

export function getChangeTitle(proposalContent = '', fallback = 'Untitled Change') {
  return (
    proposalContent.match(/^#\s+Change Proposal:\s+(.+)$/m)?.[1] ??
    proposalContent.match(/^#\s+(.+)$/m)?.[1] ??
    fallback
  )
}

export function extractAcceptanceCriteria(markdown = '') {
  const section = extractH2SectionAny(markdown, [
    'Acceptance Criteria',
    'AC',
    'Done When',
    'Criteria',
  ])
  if (!section) return []

  return section.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^- \[[ xX]\]\s+/.test(line))
    .map((line) => line.replace(/^- \[[ xX]\]\s+/, '').trim())
    .filter(Boolean)
}

export function extractChangeSummary(proposalContent = '', fallback = 'No summary available.') {
  const sections = extractAllH2Sections(proposalContent)
  const overview = sections.find((section) => ['Overview', 'Summary'].includes(section.heading))
  const summary = overview?.content
    ?.split(/[.!?\n]/)
    .map((part) => part.trim())
    .find(Boolean)
  return summary || getChangeTitle(proposalContent, fallback)
}

export function getConstitutionChecklistItems(constitutionContent = '') {
  return extractAllH2Sections(constitutionContent)
    .filter((section) => !section.heading.startsWith('[SpecFuse'))
    .map((section) => section.heading)
    .filter(Boolean)
}

export function buildUncheckedChecklist(items, formatter = (item) => item) {
  if (!items.length) return '- [ ] *(none found)*'
  return items.map((item) => `- [ ] ${formatter(item)}`).join('\n')
}

export function buildConfirmedChecklist(items) {
  return buildUncheckedChecklist(items, (item) => `confirmed: ${item}`)
}

export function countChecklist(markdown = '', pattern = /^- \[[ xX]\]/gm) {
  const matches = markdown.match(pattern) ?? []
  const checked = markdown.match(/^- \[[xX]\]/gm) ?? []
  return {
    total: matches.length,
    checked: checked.length,
    remaining: matches.length - checked.length,
  }
}

export function countVerifyChecklist(markdown = '') {
  const matches = markdown.match(/^- \[[ xX]\]\s+confirmed:/gm) ?? []
  const checked = markdown.match(/^- \[[xX]\]\s+confirmed:/gm) ?? []
  return {
    total: matches.length,
    checked: checked.length,
    remaining: matches.length - checked.length,
  }
}

export function detectUiImpact(designContent = '') {
  const match = designContent.match(/^\*\*Affects UI:\*\*\s*(.+)$/im)
  if (!match) return 'unknown'
  return match[1].trim().toLowerCase()
}

export function getChangeProposalState(proposalContent = '', options = {}) {
  const { data } = parseFrontmatterDocument(proposalContent)
  const explicit = normalizeChangeStatus(data.status, options.archived ? 'archived' : 'active')
  if (options.archived) return 'archived'

  const reviewStatus = normalizeReviewStatus(
    parseFrontmatterDocument(options.reviewContent ?? '').data?.status,
  )
  const verifyStatus = normalizeVerifyStatus(
    parseFrontmatterDocument(options.verifyContent ?? '').data?.status,
  )

  if (verifyStatus === 'pass') return 'verified'
  if (reviewStatus === 'approved') return 'reviewed'
  return explicit
}
