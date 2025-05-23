/**
 * UUID utilities
 * Provides functions for generating and validating UUIDs
 */

import crypto from 'node:crypto'

/**
 * Generates a UUID v4 string
 * @returns {string} - UUID v4 string
 */
function generateUUID (): string {
  return crypto.randomUUID()
}

/**
 * Validates if a string is a valid UUID v4
 * @param uuid - The string to validate
 * @returns True if the string is a valid UUID v4
 */
function isValidUUID (uuid: string): boolean {
  if (typeof uuid !== 'string') return false
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return regex.test(uuid)
}

/**
 * Validates if a string is a valid MongoDB-style ID (24 hex characters)
 * @param {string} id - String to validate
 * @returns {boolean} - true if valid MongoDB-style ID, false otherwise
 */
function isValidMongoID (id: string): boolean {
  if (typeof id !== 'string') return false
  return /^[0-9a-f]{24}$/i.test(id)
}

/**
 * Validates if a string is a valid ID (either MongoDB ObjectId or UUID v4)
 * @param id - The string to validate
 * @returns True if the string is a valid ID
 */
function isValidID (id: string): boolean {
  return isValidUUID(id) || isValidMongoID(id)
}

export {
  generateUUID,
  isValidUUID,
  isValidMongoID,
  isValidID
}
