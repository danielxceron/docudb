import path from 'node:path'

/**
 * Comprehensive list of dangerous path patterns
 */
const DANGEROUS_PATTERNS = [
  // Basic path traversal
  /\./,
  /\.\./,
  /\.\.\//,
  /\.\.\\/,

  // URL encoded traversal
  /%2e%2e/i,
  /%2f/i,
  /%5c/i,
  /%252e/i,
  /%252f/i,
  /%255c/i,

  // Unicode encoded traversal
  /\u002e\u002e/,
  /\u002f/,
  /\u005c/,
  /%c0%ae/i,
  /%c0%af/i,
  /%c1%9c/i,

  // Null bytes and control characters
  /\x00/,
  /\u0000/,
  /[\x01-\x1f\x7f]/,

  // Template injection
  /\$\{.*\}/,
  /#\{.*\}/,
  /\{\{.*\}\}/,

  // System directories (Unix/Linux)
  /^\/etc\//i,
  /^\/proc\//i,
  /^\/sys\//i,
  /^\/dev\//i,
  /^\/bin\//i,
  /^\/usr\/bin\//i,
  /^\/root\//i,
  /^\/var\/log\//i,
  /^\/var\/www\//i,
  /^\/usr\/local\//i,

  // Windows system directories
  /^[a-z]:\\windows\\/i,
  /^[a-z]:\\boot\.ini/i,
  /^[a-z]:\\autoexec\.bat/i,
  /^\\windows\\/i,

  // Home directory access
  /^~\//,
  /~root\//i,
  /~admin\//i,
  /~\/.ssh\//i,
  /~\/.bashrc/i,

  // Multiple slashes/backslashes
  /\/\//,
  /\\\\/,
  /\/\.\//,
  /\\\.\\/,

  // Root access
  /^\/$/,
  /^\\$/,

  // Bypass attempts
  /\.{4,}/,
  /\.{3,}[\/\\]/,

  // Mixed case evasion (specific files)
  /passwd/i,
  /shadow/i,
  /hosts/i,
  /boot\.ini/i,
  /autoexec\.bat/i,
  /config\/sam/i,

  // Configuration files
  /wp-config\.php/i,
  /\.env/i,
  /database\.yml/i,
  /application\.properties/i,
  /nginx\.conf/i,
  /apache2\.conf/i,
  /settings\.ini/i
]

/**
 * Specific dangerous file paths to block
 */
const DANGEROUS_FILES = [
  // Unix/Linux system files
  'etc/passwd',
  'etc/shadow',
  'etc/hosts',
  'proc/version',
  'proc/self/environ',
  'proc/self/cmdline',
  'sys/class/dmi/id/product_name',
  'dev/random',
  'bin/sh',
  'usr/bin/id',
  'var/log/apache2/access.log',
  'var/log/nginx/error.log',
  'var/log/auth.log',
  'root/.bash_history',
  'root/.ssh/id_rsa',

  // Windows system files
  'windows/system32/config/sam',
  'windows/system32/drivers/etc/hosts',
  'windows/repair/sam',
  'windows/system32/logfiles',
  'boot.ini',
  'autoexec.bat',

  // Configuration files
  'wp-config.php',
  '.env',
  'database.yml',
  'application.properties',
  'nginx.conf',
  'apache2.conf',
  'settings.ini',
  'database.sqlite'
]

interface ValidatedPath {
  safePath: string | null
  error: string | null
}

/**
 * Validates paths to prevent path traversal attacks
 * @param {string} userPath - User-provided path
 * @param {string} baseDir - Allowed base directory
 * @returns {Object} - {isValid: boolean, safePath: string, error: string}
 */
function validatePath (userPath: string, baseDir: string): ValidatedPath {
  try {
    const validUserPath = sanitizeName(userPath)

    if (validUserPath.error !== null) {
      return {
        safePath: null,
        error: validUserPath.error
      }
    }

    let cleanPath = validUserPath.safePath ?? ''

    // Additional cleaning for URL encoding
    try {
      cleanPath = decodeURIComponent(cleanPath)
    } catch (e) {
      // If decoding fails, continue with original
    }

    // Check again after cleaning
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cleanPath)) {
        return {
          safePath: null,
          error: 'Dangerous pattern detected after cleaning'
        }
      }
    }

    // Create full path and resolve it
    const fullPath = path.resolve(baseDir, cleanPath)

    // Verify that path is within base directory
    if (
      !fullPath.startsWith(baseDir + path.sep) &&
      fullPath !== baseDir
    ) {
      return {
        safePath: null,
        error: 'Access denied: path outside allowed directory'
      }
    }

    // Final check - ensure the resolved path doesn't contain dangerous elements
    const relativePath = path.relative(baseDir, fullPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return {
        safePath: null,
        error: 'Invalid path resolution'
      }
    }

    return {
      safePath: fullPath,
      error: null
    }
  } catch (error) {
    return {
      safePath: null,
      error: `Error processing path: ${(error as Error).message}`
    }
  }
}

/**
 * Validate and sanitize a directory name
 * @param {string} name - Directory name
 * @returns {string} - Sanitized directory name
 */
function sanitizeName (userPath: string): ValidatedPath {
  // Check that input is not empty and is a string
  if (userPath === undefined || typeof userPath !== 'string') {
    return {
      safePath: null,
      error: 'Invalid or empty path'
    }
  }

  // Check for empty or whitespace-only paths
  if (userPath.trim() === '' || /^\s+$/.test(userPath)) {
    return {
      safePath: null,
      error: 'Path cannot be empty or contain only whitespace'
    }
  }

  // Check for dangerous patterns first (before any cleaning)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(userPath)) {
      return {
        safePath: null,
        error: 'Dangerous pattern detected in path'
      }
    }
  }

  // Check for specific dangerous file paths
  const normalizedPath = userPath.toLowerCase().replace(/[\\\/]+/g, '/')
  for (const dangerousFile of DANGEROUS_FILES) {
    if (
      normalizedPath.includes(dangerousFile.toLowerCase()) ||
      normalizedPath.endsWith(dangerousFile.toLowerCase())
    ) {
      return {
        safePath: null,
        error: 'Access to system file denied'
      }
    }
  }

  // Additional checks for absolute paths
  if (path.isAbsolute(userPath)) {
    return {
      safePath: null,
      error: 'Absolute paths are not allowed'
    }
  }

  // Limit length
  if (userPath.length > 64) {
    return {
      safePath: null,
      error: 'Name too long'
    }
  }

  // Clean and normalize user path (more conservative cleaning)
  const cleanPath = userPath
    .replace(/\0/g, '') // Remove null bytes
    .replace(/[\x01-\x1f\x7f]/g, '') // Remove control characters
    .replace(/[<>:"|?*]/g, '') // Remove dangerous characters
    .trim()

  return {
    safePath: cleanPath,
    error: null
  }
}

export { validatePath, sanitizeName }
