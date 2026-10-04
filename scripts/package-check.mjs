#!/usr/bin/env node
/**
 * Pre-publish guardrails for the DocuDB package manifest.
 *
 * Verifies:
 *   - there are no runtime dependencies (the library ships zero);
 *   - the version is valid semver and not the 0.0.0 placeholder;
 *   - every path referenced by `main`, `module`, `types` and `exports`
 *     exists on disk and is reachable from the `files` list;
 *   - the `engines.node` floor matches what the README documents.
 *
 * It runs after `npm run build`, so the `dist` artifacts are present.
 * No dependencies: Node built-ins only.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const problems = []
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/**
 * Reports a problem
 * @param {string} message - Description of the problem
 */
function fail (message) {
  problems.push(message)
}

/**
 * Tells whether a file exists
 * @param {string} relative - Path relative to the repository root
 * @returns {boolean} true when it exists
 */
function exists (relative) {
  return fs.existsSync(path.join(ROOT, relative))
}

/**
 * Normalizes a manifest path so `./dist/x` and `dist/x` compare equal
 * @param {string} value - Path as written in the manifest
 * @returns {string} Path relative to the repository root
 */
function normalizeTarget (value) {
  return value.replace(/^\.\//, '')
}

/**
 * Turns a version declaration into comparable numbers, so that `>=18.0.0`
 * and `18` both become [18, 0, 0].
 * @param {string} value - Version or range
 * @returns {number[]} Major, minor and patch
 */
function versionNumbers (value) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value))
  if (match === null) return []
  return [
    Number(match[1]),
    match[2] === undefined ? 0 : Number(match[2]),
    match[3] === undefined ? 0 : Number(match[3])
  ]
}

/**
 * Tells whether a path would be part of the published tarball
 * @param {string} target - Path relative to the repository root
 * @returns {boolean} true when it is published
 */
function published (target) {
  const files = manifest.files ?? []
  if (files.includes(target)) return true

  return files.some(entry => {
    const candidate = path.join(ROOT, entry)
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return false
    const prefix = entry.endsWith('/') ? entry : `${entry}/`
    return target.startsWith(prefix)
  })
}

// 1. Zero runtime dependencies -------------------------------------------------
const runtime = Object.keys(manifest.dependencies ?? {})
if (runtime.length > 0) {
  fail(`runtime dependencies are not allowed, found: ${runtime.join(', ')}`)
}

// 2. Version -------------------------------------------------------------------
if (!SEMVER.test(manifest.version)) {
  fail(`version "${manifest.version}" is not valid semver`)
}
if (manifest.version === '0.0.0') {
  fail('version is the 0.0.0 placeholder; publish a real semver instead')
}

// 3. Entry points exist and are published ---------------------------------------
const targets = new Set()
for (const field of ['main', 'module', 'types']) {
  if (typeof manifest[field] === 'string') targets.add(normalizeTarget(manifest[field]))
}

const collectExports = value => {
  if (typeof value === 'string') {
    if (/\.(?:js|cjs|mjs|ts|cts)$/.test(value)) targets.add(normalizeTarget(value))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) collectExports(entry)
  }
}
collectExports(manifest.exports)

if (targets.size === 0) fail('no entry points found in main/module/types/exports')

for (const target of targets) {
  if (!exists(target)) {
    fail(`entry point does not exist on disk: ${target} (run "npm run build")`)
    continue
  }
  if (!published(target)) {
    fail(`entry point is not covered by the "files" list: ${target}`)
  }
}

// 4. Declared Node floor matches the documentation -------------------------------
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
const declared = versionNumbers(manifest.engines?.node ?? '').join('.')
const documented = readme.match(/Node\.js\s*(?:≥|>=)\s*([0-9][0-9.]*)/)

if (documented === null) {
  fail('README.md does not state the minimum Node.js version')
} else {
  const readmeFloor = versionNumbers(documented[1]).join('.')
  if (readmeFloor !== declared) {
    fail(
      `engines.node requires >=${declared} but README.md documents Node.js >=${readmeFloor}`
    )
  }
}

// -----------------------------------------------------------------------------

console.log('package:check')
console.log(`  · name: ${manifest.name}@${manifest.version}`)
console.log(`  · runtime dependencies: ${runtime.length}`)
console.log(`  · entry points: ${[...targets].sort().join(', ')}`)
console.log(`  · node floor: >=${declared}`)

if (problems.length > 0) {
  console.error('')
  console.error(`${problems.length} problem(s) found:`)
  for (const problem of problems) console.error(`  x ${problem}`)
  process.exit(1)
}

console.log('\n  OK package manifest is publishable')