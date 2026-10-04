#!/usr/bin/env node
/**
 * Keeps the Spanish and English documentation in sync.
 *
 * Checks, for every translated pair:
 *   - both files exist;
 *   - the language switcher is present and points to an existing file;
 *   - the heading tree matches (same levels, same order, same count);
 *   - fenced code blocks match one by one;
 *   - the relative `.md` links resolve;
 *   - the MCO_ERROR codes quoted in the README match;
 *   - the benchmark figures quoted in the README match.
 *
 * For bilingual files the comparison is done half by half, using the
 * `<a id="español">` / `<a id="english">` markers as the split points.
 *
 * No dependencies: Node built-ins only.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Pairs of files that must be structurally identical */
const PAIRS = [
  { canonical: 'README.md', translated: 'README.es.md' },
  { canonical: 'CHANGELOG.md', translated: 'CHANGELOG.es.md' },
  { canonical: 'docs/ARCHITECTURE.md', translated: 'docs/ARCHITECTURE.es.md' }
]

/** Files with a Spanish half and an English half in the same document */
const BILINGUAL = [
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md'
]

/** Marker that starts each half of a bilingual document */
const SPLIT = /<a id="(español|english)"><\/a>/

const problems = []
const notes = []

/**
 * Reports a problem
 * @param {string} file - File the problem belongs to
 * @param {string} message - Description of the problem
 */
function fail (file, message) {
  problems.push(`${file}: ${message}`)
}

/**
 * Reads a file
 * @param {string} relative - Path relative to the repository root
 * @returns {string} File content
 */
function read (relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

/**
 * Tells whether a file exists
 * @param {string} relative - Path relative to the repository root
 * @returns {boolean} true when the file exists
 */
function exists (relative) {
  return fs.existsSync(path.join(ROOT, relative))
}

/**
 * Extracts the heading tree.
 *
 * Only levels and positions are compared: heading *text* is expected to differ
 * between languages, but the structure must not.
 * @param {string} content - Markdown content
 * @returns {number[]} Level of each heading
 */
function headings (content) {
  const result = []
  let inFence = false

  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = /^(#{1,6})\s+\S/.exec(line)
    if (match !== null) result.push(match[1].length)
  }

  return result
}

/**
 * Extracts the fence languages of the code blocks
 * @param {string} content - Markdown content
 * @returns {string[]} Language tag of each block, in order
 */
function codeBlockLanguages (content) {
  const languages = []
  for (const match of content.matchAll(/```([^\n]*)\n/g)) {
    languages.push(match[1].trim())
  }
  return languages
}

/**
 * Extracts the API surface quoted inside code blocks.
 *
 * Comments and prose are translated; identifiers, methods and operators are
 * not, so they are the part that must stay identical.
 * @param {string} content - Markdown content
 * @returns {string[]} Sorted unique API tokens
 */
function apiTokens (content) {
  const blocks = codeBlocks(content).join('\n')
  const tokens = new Set()

  for (const match of blocks.matchAll(/\$[a-zA-Z][a-zA-Z0-9]*/g)) {
    tokens.add(match[0])
  }
  for (const match of blocks.matchAll(/\b(?:db|users|orders|products|items|outbox|settings|query|locals)\.[a-zA-Z][a-zA-Z0-9]*/g)) {
    tokens.add(match[0])
  }
  for (const match of blocks.matchAll(/\bnew (?:Database|Schema|Query)\(/g)) {
    tokens.add(match[0])
  }
  for (const match of blocks.matchAll(/\bMCO_ERROR\.[A-Z]+\.[A-Z_]+/g)) {
    tokens.add(match[0])
  }

  return [...tokens].sort()
}

/**
 * Extracts fenced code blocks
 * @param {string} content - Markdown content
 * @returns {string[]} Block bodies
 */
function codeBlocks (content) {
  const blocks = []
  const pattern = /```[^\n]*\n([\s\S]*?)```/g
  let match = pattern.exec(content)

  while (match !== null) {
    blocks.push(match[1].replace(/\s+$/, ''))
    match = pattern.exec(content)
  }

  return blocks
}

/**
 * Extracts the MCO_ERROR codes cited in a document
 * @param {string} content - Markdown content
 * @returns {string[]} Sorted unique codes
 */
function errorCodes (content) {
  const codes = content.match(/\b(?:DB|DOC|SCH|STO|IDX|COL|COM|QUE)\d{3}\b/g) ?? []
  return [...new Set(codes)].sort()
}

/**
 * Extracts the benchmark figures quoted in a document
 * @param {string} content - Markdown content
 * @returns {string[]} Sorted unique figures
 */
function benchmarkFigures (content) {
  const patterns = [
    /~?\d[\d\s.,]*\s?(?:ms|s|MB)\b/g,
    /\b\d{1,3}(?:\s\d{3})+\b/g
  ]
  const found = []
  for (const pattern of patterns) {
    for (const match of content.match(pattern) ?? []) {
      found.push(match.replace(/\s+/g, ' ').trim())
    }
  }
  return [...new Set(found)].sort()
}

/**
 * Extracts the relative file links of a document
 * @param {string} content - Markdown content
 * @returns {string[]} Link targets that are not absolute URLs
 */
function markdownLinks (content) {
  const links = content.match(/\]\(([^)\s]+)\)/g) ?? []
  return links
    .map(link => /\(([^)\s]+)\)/.exec(link)[1])
    .filter(target => !/^[a-z]+:/i.test(target) && !target.startsWith('#'))
}

/**
 * Splits a bilingual document into its halves
 * @param {string} file - Relative path of the document
 * @returns {{ spanish: string, english: string } | null} The halves, or null when the markers are missing
 */
function halves (file) {
  const content = read(file)
  const positions = []

  for (const match of content.matchAll(new RegExp(SPLIT, 'g'))) {
    positions.push({ id: match[1], index: match.index })
  }

  const spanish = positions.find(entry => entry.id === 'español')
  const english = positions.find(entry => entry.id === 'english')

  if (spanish === undefined || english === undefined) {
    fail(file, 'missing one of the <a id="español"> / <a id="english"> markers')
    return null
  }

  return {
    spanish: content.slice(spanish.index, english.index),
    english: content.slice(english.index)
  }
}

/**
 * Compares two heading structures
 * @param {string} file - File being checked
 * @param {string} label - Human readable label of the comparison
 * @param {number[]} left - Heading levels of the first document
 * @param {number[]} right - Heading levels of the second document
 */
function compareHeadings (file, label, left, right) {
  if (left.length !== right.length) {
    fail(file, `${label}: ${left.length} headings vs ${right.length} (structure must match)`)
    return
  }

  left.forEach((level, index) => {
    if (level !== right[index]) {
      fail(file, `${label}: heading ${index + 1} is level ${level} vs ${right[index]}`)
    }
  })
}

/**
 * Compares the code blocks of two documents: same count, same fence languages
 * and same API surface. Comments and prose inside the examples are allowed to
 * differ, since they are translated.
 * @param {string} file - File being checked
 * @param {string} label - Human readable label of the comparison
 * @param {string} left - Raw content of the first document
 * @param {string} right - Raw content of the second document
 */
function compareCodeBlocks (file, label, left, right) {
  const leftBlocks = codeBlocks(left)
  const rightBlocks = codeBlocks(right)

  if (leftBlocks.length !== rightBlocks.length) {
    fail(file, `${label}: ${leftBlocks.length} code blocks vs ${rightBlocks.length}`)
    return
  }

  const leftLanguages = codeBlockLanguages(left)
  const rightLanguages = codeBlockLanguages(right)
  leftLanguages.forEach((language, index) => {
    if (language !== rightLanguages[index]) {
      fail(file, `${label}: code block ${index + 1} is "${language}" vs "${rightLanguages[index]}"`)
    }
  })

  compareSets(file, `${label} API tokens`, apiTokens(left), apiTokens(right))
}

/**
 * Compares two sets of values, reporting only the missing ones
 * @param {string} file - File being checked
 * @param {string} label - Human readable label of the comparison
 * @param {string[]} left - Values of the first document
 * @param {string[]} right - Values of the second document
 */
function compareSets (file, label, left, right) {
  const missing = left.filter(value => !right.includes(value))
  const extra = right.filter(value => !left.includes(value))

  for (const value of missing) fail(file, `${label}: "${value}" only in the English version`)
  for (const value of extra) fail(file, `${label}: "${value}" only in the Spanish version`)
}

/**
 * Builds a GitHub-compatible heading slug. Accented characters are kept,
 * which is what GitHub does.
 * @param {string} text - Heading text
 * @returns {string} The anchor
 */
function slug (text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/**
 * Verifies that every internal anchor of a document resolves to a heading
 * @param {string} file - Relative path of the document
 */
function checkAnchors (file) {
  const content = read(file)
  const anchors = new Set()
  let inFence = false

  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^#{1,6}\s+(.*)$/.exec(line)
    if (match !== null) anchors.add(slug(match[1]))
  }

  for (const match of content.matchAll(/\]\(#([^)]+)\)/g)) {
    if (!anchors.has(match[1])) {
      fail(file, `internal anchor does not resolve: #${match[1]}`)
    }
  }
}

/**
 * Verifies the language switcher of a single-language document
 * @param {string} file - Relative path of the document
 * @param {string} other - Relative path of the counterpart
 * @param {string} linkAsWritten - How the counterpart is linked from `file`
 */
function checkSwitcher (file, other, linkAsWritten) {
  const content = read(file)
  const head = content.split('\n').slice(0, 12).join('\n')

  if (!/English/i.test(head) || !/Español/i.test(head)) {
    fail(file, 'the language switcher is missing from the first 12 lines')
  }
  if (!head.includes(linkAsWritten)) {
    fail(file, `the language switcher does not link to ${linkAsWritten}`)
  }
  if (!exists(other)) {
    fail(file, `the language switcher points to a missing file: ${other}`)
  }
}

/**
 * Verifies that every relative markdown link resolves
 * @param {string} file - Relative path of the document
 */
function checkLinks (file) {
  const directory = path.dirname(file)

  for (const link of markdownLinks(read(file))) {
    const clean = link.split('#')[0]
    if (clean.length === 0) continue
    const target = path.normalize(path.join(directory, clean))
    if (!exists(target)) {
      fail(file, `link does not resolve: ${link}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Pairs of translated documents
// ---------------------------------------------------------------------------

for (const { canonical, translated } of PAIRS) {
  if (!exists(canonical)) {
    fail(canonical, 'file does not exist')
    continue
  }
  if (!exists(translated)) {
    fail(translated, 'file does not exist')
    continue
  }

  // Inside docs/ the counterpart is linked with a relative path.
  checkSwitcher(canonical, translated, path.relative(path.dirname(canonical), translated))
  checkSwitcher(translated, canonical, path.relative(path.dirname(translated), canonical))

  const left = read(canonical)
  const right = read(translated)

  compareHeadings(canonical, 'headings', headings(left), headings(right))
  compareCodeBlocks(canonical, 'code blocks', left, right)

  if (canonical === 'README.md') {
    compareSets(canonical, 'error codes', errorCodes(left), errorCodes(right))
    compareSets(canonical, 'benchmark figures', benchmarkFigures(left), benchmarkFigures(right))
  }

  checkLinks(canonical)
  checkLinks(translated)
  checkAnchors(canonical)
  checkAnchors(translated)

  notes.push(`${canonical} ↔ ${translated}`)
}

// ---------------------------------------------------------------------------
// Bilingual documents
// ---------------------------------------------------------------------------

for (const file of BILINGUAL) {
  if (!exists(file)) {
    fail(file, 'file does not exist')
    continue
  }

  checkLinks(file)
  checkAnchors(file)
  notes.push(`${file} (bilingual)`)

  const content = read(file)
  const head = content.split('\n').slice(0, 12).join('\n')
  if (!/English/i.test(head) || !/Español/i.test(head)) {
    fail(file, 'the language switcher is missing from the first 12 lines')
  }

  const parts = halves(file)
  if (parts === null) continue

  compareHeadings(file, 'headings', headings(parts.spanish), headings(parts.english))
  compareCodeBlocks(file, 'code blocks', parts.spanish, parts.english)
}

// ---------------------------------------------------------------------------

console.log('docs:check')
for (const note of notes) console.log(`  · ${note}`)

if (problems.length > 0) {
  console.error('')
  console.error(`${problems.length} problem(s) found:`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log('\n  ✓ Spanish and English documentation are in sync')