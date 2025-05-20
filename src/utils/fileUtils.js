/**
 * Utility module for file operations
 * Contains common functions used in various project modules
 */

import fs from 'node:fs'

/**
 * Checks if a file or directory exists
 * @param {string} filePath - Path of the file or directory to check
 * @returns {Promise<boolean>} - true if it exists, false otherwise
 */
async function fileExists (filePath) {
  try {
    await fs.promises.stat(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export {
  fileExists
}
