/**
 * Name and path validation.
 *
 * Strategy: an *allow list* of characters plus containment verification.
 * The previous implementation used a block list of ~60 patterns which
 * rejected every name containing a dot and names such as `hosts`, and which
 * still had to be extended ad hoc for every new bypass technique.
 */

import path from 'node:path'

/** Maximum length of a database or collection name */
export const MAX_NAME_LENGTH = 64

/** Names reserved by Windows (invalid on Windows, confusing everywhere) */
const WINDOWS_RESERVED = [
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]

/** Allow list: starts alphanumeric, then alphanumerics, dot, dash or underscore */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Characters never allowed regardless of position */
const FORBIDDEN_CHARS = /[<>:"|?*\\/]/

/** Control characters (NUL, tab, newlines, ESC, DEL...) */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export interface ValidatedPath {
  /** Resolved, safe absolute path, or null when the input was rejected */
  safePath: string | null
  /** Reason of the rejection, or null when the input is valid */
  error: string | null
}

/**
 * Validates a database or collection name against the allow list.
 * @param name - Candidate name
 * @returns `{ safePath, error }` where `safePath` is the sanitized name
 */
export function sanitizeName (name: string): ValidatedPath {
  if (typeof name !== 'string') {
    return { safePath: null, error: 'Name must be a string' }
  }

  if (name.length === 0 || name.trim().length === 0) {
    return { safePath: null, error: 'Name cannot be empty' }
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      safePath: null,
      error: `Name cannot exceed ${MAX_NAME_LENGTH} characters`
    }
  }

  if (FORBIDDEN_CHARS.test(name)) {
    return { safePath: null, error: 'Name contains forbidden characters' }
  }

  if (CONTROL_CHARS.test(name)) {
    return { safePath: null, error: 'Name contains control characters' }
  }

  if (!NAME_PATTERN.test(name)) {
    return {
      safePath: null,
      error:
        'Name must start with a letter or digit and may only contain letters, digits, dots, dashes and underscores'
    }
  }

  if (name.includes('..') || name.startsWith('.') || name.endsWith('.')) {
    return {
      safePath: null,
      error: 'Name cannot contain path traversal sequences'
    }
  }

  const base = (name.split('.')[0] ?? '').toLowerCase()
  if (WINDOWS_RESERVED.includes(base)) {
    return { safePath: null, error: `"${name}" is a reserved name` }
  }

  return { safePath: name, error: null }
}

/**
 * Validates that `name` resolves inside `baseDir`.
 * @param name - Database or collection name
 * @param baseDir - Directory that must contain the resolved path
 * @returns `{ safePath, error }` where `safePath` is an absolute path
 */
export function validatePath (name: string, baseDir: string): ValidatedPath {
  const sanitized = sanitizeName(name)
  if (sanitized.safePath === null) {
    return { safePath: null, error: sanitized.error }
  }

  if (typeof baseDir !== 'string' || baseDir.trim().length === 0) {
    return { safePath: null, error: 'Base directory is required' }
  }

  const fullPath = path.resolve(baseDir, sanitized.safePath)
  const relative = path.relative(path.resolve(baseDir), fullPath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      safePath: null,
      error: 'Access denied: path outside allowed directory'
    }
  }

  return { safePath: fullPath, error: null }
}

export default { validatePath, sanitizeName }
