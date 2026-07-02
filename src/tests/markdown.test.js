import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  upsertManagedSection,
  readManagedSection,
  extractH2Section,
  extractH2SectionAny,
  extractAllH2Sections,
  stripManagedSections,
  hashContent,
  contentToRules,
} from '../utils/markdown.js'

// ─── upsertManagedSection ────────────────────────────────────────────────────

describe('upsertManagedSection', () => {
  test('appends a new section when none exists', () => {
    const content = '# My Doc\n\nSome text here.'
    const result = upsertManagedSection(content, 'bmad-decisions', 'Rule A\nRule B')
    assert.ok(result.includes('<!-- specfuse:bmad-decisions:start -->'))
    assert.ok(result.includes('Rule A'))
    assert.ok(result.includes('Rule B'))
    assert.ok(result.includes('<!-- specfuse:bmad-decisions:end -->'))
  })

  test('replaces existing managed section', () => {
    const content = [
      '# Doc',
      '<!-- specfuse:bmad-decisions:start -->',
      'Old content',
      '<!-- specfuse:bmad-decisions:end -->',
      'After marker',
    ].join('\n')
    const result = upsertManagedSection(content, 'bmad-decisions', 'New content')
    assert.ok(result.includes('New content'))
    assert.ok(!result.includes('Old content'))
    assert.ok(result.includes('After marker'), 'content after marker must be preserved')
  })

  test('preserves all content outside markers', () => {
    const content = [
      '# Doc',
      'User content before',
      '<!-- specfuse:test:start -->',
      'managed',
      '<!-- specfuse:test:end -->',
      'User content after',
    ].join('\n')
    const result = upsertManagedSection(content, 'test', 'updated managed')
    assert.ok(result.includes('User content before'))
    assert.ok(result.includes('User content after'))
    assert.ok(result.includes('updated managed'))
  })

  test('is idempotent — running twice produces the same managed section', () => {
    const content = '# Doc\n\nHello'
    const first = upsertManagedSection(content, 'sect', 'value')
    const second = upsertManagedSection(first, 'sect', 'value')
    assert.equal(readManagedSection(first, 'sect'), readManagedSection(second, 'sect'))
  })

  test('produces exactly one managed section on repeated writes', () => {
    const content = '# Doc\n\nHello'
    const first = upsertManagedSection(content, 'sect', 'v1')
    const second = upsertManagedSection(first, 'sect', 'v2')
    const count = (second.match(/specfuse:sect:start/g) ?? []).length
    assert.equal(count, 1, 'must never create duplicate managed sections')
  })

  test('handles multiple independent sections in the same document', () => {
    let doc = '# Doc\n\nContent'
    doc = upsertManagedSection(doc, 'section-a', 'Content A')
    doc = upsertManagedSection(doc, 'section-b', 'Content B')
    assert.equal(readManagedSection(doc, 'section-a'), 'Content A')
    assert.equal(readManagedSection(doc, 'section-b'), 'Content B')
  })
})

// ─── readManagedSection ──────────────────────────────────────────────────────

describe('readManagedSection', () => {
  test('returns content inside markers', () => {
    const content = [
      '# Doc',
      '<!-- specfuse:bmad-decisions:start -->',
      'Line one',
      'Line two',
      '<!-- specfuse:bmad-decisions:end -->',
    ].join('\n')
    const result = readManagedSection(content, 'bmad-decisions')
    assert.ok(result.includes('Line one'))
    assert.ok(result.includes('Line two'))
  })

  test('returns null when section does not exist', () => {
    assert.equal(readManagedSection('# No managed sections', 'nonexistent'), null)
  })

  test('returns null when only the start marker exists (unclosed)', () => {
    const content = '<!-- specfuse:test:start -->\nContent but no end marker'
    assert.equal(readManagedSection(content, 'test'), null)
  })

  test('trims whitespace from extracted content', () => {
    const content = [
      '<!-- specfuse:x:start -->',
      '  ',
      '  trimmed content  ',
      '  ',
      '<!-- specfuse:x:end -->',
    ].join('\n')
    const result = readManagedSection(content, 'x')
    assert.equal(result, 'trimmed content')
  })
})

// ─── extractH2Section ────────────────────────────────────────────────────────

describe('extractH2Section', () => {
  test('extracts content of a named H2 section', () => {
    const content = [
      '# Doc',
      '## Architectural Decisions',
      'Use microservices.',
      'Use PostgreSQL.',
      '## Another Section',
      'Other content.',
    ].join('\n')
    const result = extractH2Section(content, 'Architectural Decisions')
    assert.ok(result.includes('Use microservices.'))
    assert.ok(result.includes('Use PostgreSQL.'))
    assert.ok(!result.includes('Other content.'), 'must not bleed into next section')
  })

  test('is case-insensitive', () => {
    const content = '## Tech Stack\nNode.js\n\n## Other\nstuff'
    assert.ok(extractH2Section(content, 'tech stack').includes('Node.js'))
    assert.ok(extractH2Section(content, 'TECH STACK').includes('Node.js'))
  })

  test('returns null when heading not found', () => {
    assert.equal(extractH2Section('## Only This\nContent', 'Missing Section'), null)
  })

  test('returns null on empty document', () => {
    assert.equal(extractH2Section('', 'Any Section'), null)
  })

  // ── Heading normalisation ────────────────────────────────────────────────

  test('matches numbered heading: "## 3. Non-Functional Requirements"', () => {
    const content = '## 3. Non-Functional Requirements\n- 99.9% uptime\n\n## Other\nstuff'
    const result = extractH2Section(content, 'Non-Functional Requirements')
    assert.ok(result !== null, 'numbered heading must match without the number prefix')
    assert.ok(result.includes('99.9% uptime'))
  })

  test('matches decimal-numbered heading: "## 2.1 Tech Stack"', () => {
    const content = '## 2.1 Tech Stack\nNode.js\n\n## Other\nstuff'
    const result = extractH2Section(content, 'Tech Stack')
    assert.ok(result !== null)
    assert.ok(result.includes('Node.js'))
  })

  test('matches emoji-prefixed heading: "## 🏗️ Architectural Decisions"', () => {
    const content = '## 🏗️ Architectural Decisions\n- Microservices\n\n## Other\nstuff'
    const result = extractH2Section(content, 'Architectural Decisions')
    assert.ok(result !== null, 'emoji prefix must be stripped before matching')
    assert.ok(result.includes('Microservices'))
  })

  test('matches emoji + numbered heading: "## 🔒 3. Security"', () => {
    const content = '## 🔒 3. Security\n- TLS required\n\n## Other\nstuff'
    const result = extractH2Section(content, 'Security')
    assert.ok(result !== null)
    assert.ok(result.includes('TLS required'))
  })

  test('matches security emoji heading from real BMAD template', () => {
    const content = '## 🔐 Security Considerations\n- No secrets in env\n\n## End\nfin'
    const result = extractH2Section(content, 'Security Considerations')
    assert.ok(result !== null, 'real BMAD emoji heading must match')
  })
})

// ─── extractH2SectionAny ─────────────────────────────────────────────────────

describe('extractH2SectionAny', () => {
  test('returns first matching candidate', () => {
    const content = '## Technology Stack\nNode.js\n\n## Other\nstuff'
    const result = extractH2SectionAny(content, ['Tech Stack', 'Technology Stack', 'Technologies'])
    assert.ok(result !== null)
    assert.equal(result.heading, 'Technology Stack')
    assert.ok(result.content.includes('Node.js'))
  })

  test('tries candidates in order — returns first match, not longest', () => {
    const content = '## Tech Stack\nNode.js\n## Technology Stack\nDupe'
    const result = extractH2SectionAny(content, ['Tech Stack', 'Technology Stack'])
    assert.equal(result.heading, 'Tech Stack', 'must return first candidate that matches')
  })

  test('returns null when no candidates match', () => {
    assert.equal(extractH2SectionAny('## Only This\nContent', ['Missing A', 'Missing B']), null)
  })

  test('works with emoji heading candidates', () => {
    const content = '## 🏗️ Architectural Decisions\n- Use Docker\n\n## Other\nstuff'
    const result = extractH2SectionAny(content, [
      'Architectural Decisions',
      'Architecture Decisions',
      'ADRs',
    ])
    assert.ok(result !== null, 'emoji heading must be found via candidate list')
    assert.ok(result.content.includes('Use Docker'))
  })
})

// ─── extractAllH2Sections ────────────────────────────────────────────────────

describe('extractAllH2Sections', () => {
  test('extracts all H2 sections in document order', () => {
    const content = ['# Title', '## Section A', 'Content A', '## Section B', 'Content B'].join('\n')
    const sections = extractAllH2Sections(content)
    assert.equal(sections.length, 2)
    assert.equal(sections[0].heading, 'Section A')
    assert.equal(sections[1].heading, 'Section B')
    assert.ok(sections[0].content.includes('Content A'))
    assert.ok(sections[1].content.includes('Content B'))
  })

  test('does not include headings inside managed sections', () => {
    const content = [
      '## Real Section',
      'Real content',
      '<!-- specfuse:bmad-decisions:start -->',
      '## Fake Section Inside Marker',
      'managed content',
      '<!-- specfuse:bmad-decisions:end -->',
    ].join('\n')
    const sections = extractAllH2Sections(content)
    assert.equal(sections.length, 1, 'managed section internals must be excluded')
    assert.equal(sections[0].heading, 'Real Section')
  })

  test('returns empty array for document with no H2 headings', () => {
    assert.equal(extractAllH2Sections('# H1 only\nContent').length, 0)
    assert.equal(extractAllH2Sections('').length, 0)
  })
})

// ─── stripManagedSections ────────────────────────────────────────────────────

describe('stripManagedSections', () => {
  test('removes all managed sections', () => {
    const content = [
      'Before',
      '<!-- specfuse:a:start -->',
      'Managed A',
      '<!-- specfuse:a:end -->',
      'Between',
      '<!-- specfuse:b:start -->',
      'Managed B',
      '<!-- specfuse:b:end -->',
      'After',
    ].join('\n')
    const result = stripManagedSections(content)
    assert.ok(result.includes('Before'))
    assert.ok(result.includes('Between'))
    assert.ok(result.includes('After'))
    assert.ok(!result.includes('Managed A'))
    assert.ok(!result.includes('Managed B'))
  })

  test('leaves document unchanged when no managed sections present', () => {
    const content = '# Plain doc\n\nNo markers here.'
    assert.equal(stripManagedSections(content), content.trim())
  })

  test('handles multiple sections of the same name (should not happen, but must not crash)', () => {
    const content = [
      '<!-- specfuse:x:start -->A<!-- specfuse:x:end -->',
      'middle',
      '<!-- specfuse:x:start -->B<!-- specfuse:x:end -->',
    ].join('\n')
    const result = stripManagedSections(content)
    assert.ok(!result.includes('A'))
    assert.ok(!result.includes('B'))
    assert.ok(result.includes('middle'))
  })
})

// ─── hashContent ─────────────────────────────────────────────────────────────

describe('hashContent', () => {
  test('produces consistent hash for the same input', () => {
    assert.equal(hashContent('hello world'), hashContent('hello world'))
  })

  test('produces different hashes for different content', () => {
    assert.notEqual(hashContent('hello world'), hashContent('hello world!'))
  })

  test('is whitespace-tolerant — trims before hashing', () => {
    assert.equal(hashContent('content'), hashContent('  content  '))
    assert.equal(hashContent('content'), hashContent('\ncontent\n'))
  })

  test('produces a non-empty hex string', () => {
    const h = hashContent('test')
    assert.ok(h.length > 0)
    assert.ok(/^[0-9a-f]+$/.test(h), 'must be lowercase hex')
  })

  test('empty string and whitespace-only produce same hash', () => {
    assert.equal(hashContent(''), hashContent('   '))
  })
})

// ─── contentToRules ──────────────────────────────────────────────────────────

describe('contentToRules', () => {
  test('converts bullet lines to prefixed rules', () => {
    const result = contentToRules('Tech Stack', '- Node.js\n- PostgreSQL')
    assert.ok(result.includes('[Tech Stack]'))
    assert.ok(result.includes('Node.js'))
    assert.ok(result.includes('PostgreSQL'))
  })

  test('handles numbered lists', () => {
    const result = contentToRules('Constraints', '1. Use REST\n2. No GraphQL')
    assert.ok(result.includes('Use REST'))
    assert.ok(result.includes('No GraphQL'))
  })

  test('strips blank lines — only content lines become rules', () => {
    const result = contentToRules('Section', 'Rule one\n\nRule two')
    const lines = result.split('\n').filter((l) => l.trim())
    assert.equal(lines.length, 2)
  })

  test('strips existing bullet markers before prefixing', () => {
    const result = contentToRules('Security', '* Use TLS\n+ No HTTP')
    // Result lines must start with "- **[Security]**", not "- **[Security]** * Use TLS"
    const lines = result.split('\n').filter((l) => l.trim())
    for (const line of lines) {
      // After "- **[Security]** " there should be no leading bullet character
      const afterPrefix = line.replace(/^- \*\*\[Security\]\*\*\s*/, '')
      assert.ok(
        !afterPrefix.startsWith('*') &&
          !afterPrefix.startsWith('+') &&
          !afterPrefix.startsWith('-'),
        `Rule line still has leading bullet: ${JSON.stringify(line)}`,
      )
    }
    assert.ok(result.includes('Use TLS'))
    assert.ok(result.includes('No HTTP'))
  })

  test('each output line is prefixed with the section heading', () => {
    const result = contentToRules('My Section', 'Rule A\nRule B')
    const lines = result.split('\n').filter((l) => l.trim())
    assert.ok(lines.every((l) => l.includes('[My Section]')))
  })

  test('ignores sub-headings inside section content', () => {
    const result = contentToRules('Arch', '### Sub-heading\nActual rule')
    // H3 sub-headings are noise — should be stripped or ignored
    const lines = result.split('\n').filter((l) => l.trim() && l.includes('[Arch]'))
    assert.ok(lines.some((l) => l.includes('Actual rule')))
  })
})
