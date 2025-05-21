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
export async function fileExists (filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath)
    return true
  } catch (error: any) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export default { fileExists }
