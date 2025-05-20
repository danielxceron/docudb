/**
 * Utility module for UUID operations
 * Provides functions for UUID generation and validation
 */

const crypto = require('crypto')

/**
 * Generates a UUID v4 string
 * @returns {string} - UUID v4 string
 */
function generateUUID () {
  return crypto.randomUUID()
}

/**
 * Validates if a string is a valid UUID v4
 * @param {string} uuid - String to validate
 * @returns {boolean} - true if valid UUID v4, false otherwise
 */
function isValidUUID (uuid) {
  if (!uuid) return false
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return regex.test(uuid)
}

/**
 * Validates if a string is a valid MongoDB-style ID (24 hex characters)
 * @param {string} id - String to validate
 * @returns {boolean} - true if valid MongoDB-style ID, false otherwise
 */
function isValidMongoID (id) {
  if (!id) return false
  return /^[0-9a-f]{24}$/i.test(id)
}

/**
 * Validates if a string is a valid ID (either UUID v4 or MongoDB-style ID)
 * @param {string} id - String to validate
 * @returns {boolean} - true if valid ID, false otherwise
 */
function isValidID (id) {
  return isValidUUID(id) || isValidMongoID(id)
}

module.exports = {
  generateUUID,
  isValidUUID,
  isValidMongoID,
  isValidID
}
