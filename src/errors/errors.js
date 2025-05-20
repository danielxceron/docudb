/**
 * Centralized error module
 * Defines constants and classes for consistent error handling
 */

// Error codes
const MCO_ERROR = {
  // General errors
  GENERAL: {
    INITIALIZATION_ERROR: 'INITIALIZATION_ERROR',
    INVALID_PARAMETER: 'INVALID_PARAMETER',
    NOT_FOUND: 'NOT_FOUND',
    OPERATION_FAILED: 'OPERATION_FAILED'
  },

  // Database errors
  DATABASE: {
    INIT_ERROR: 'DB_INIT_ERROR',
    COLLECTION_ERROR: 'COLLECTION_ERROR',
    LOAD_ERROR: 'LOAD_ERROR'
  },

  // Collection errors
  COLLECTION: {
    INVALID_NAME: 'INVALID_COLLECTION_NAME',
    NOT_FOUND: 'COLLECTION_NOT_FOUND',
    METADATA_ERROR: 'METADATA_ERROR',
    DROP_ERROR: 'DROP_ERROR'
  },

  // Document errors
  DOCUMENT: {
    INVALID_DOCUMENT: 'INVALID_DOCUMENT',
    NOT_FOUND: 'DOCUMENT_NOT_FOUND',
    INSERT_ERROR: 'INSERT_ERROR',
    UPDATE_ERROR: 'UPDATE_ERROR',
    DELETE_ERROR: 'DELETE_ERROR',
    QUERY_ERROR: 'QUERY_ERROR',
    INVALID_TYPE: 'INVALID_TYPE',
    LOCK_ERROR: 'DOCUMENT_LOCK_ERROR',
    INVALID_ID: 'INVALID_ID'
  },

  // Storage errors
  STORAGE: {
    INIT_ERROR: 'STORAGE_INIT_ERROR',
    SAVE_ERROR: 'SAVE_ERROR',
    READ_ERROR: 'READ_ERROR',
    DELETE_ERROR: 'DELETE_ERROR'
  },

  // Index errors
  INDEX: {
    INIT_ERROR: 'INDEX_INIT_ERROR',
    CREATE_ERROR: 'CREATE_ERROR',
    DROP_ERROR: 'DROP_ERROR',
    UPDATE_ERROR: 'UPDATE_ERROR',
    UNIQUE_VIOLATION: 'UNIQUE_VIOLATION',
    LOAD_ERROR: 'INDEX_LOAD_ERROR',
    SAVE_ERROR: 'INDEX_SAVE_ERROR'
  },

  // Compression errors
  COMPRESSION: {
    COMPRESS_ERROR: 'COMPRESS_ERROR',
    DECOMPRESS_ERROR: 'DECOMPRESS_ERROR'
  },

  // Schema errors
  SCHEMA: {
    // INVALID_SCHEMA: 'INVALID_SCHEMA',
    // INVALID_FORMAT: 'INVALID_FORMAT',
    // INVALID_UNIQUE: 'INVALID_UNIQUE',
    // INVALID_DEFAULT: 'INVALID_DEFAULT',
    // INVALID_REFERENCE: 'INVALID_REFERENCE',
    // INVALID_EMBEDDED: 'INVALID_EMBEDDED',
    // INVALID_EMBEDDED_ARRAY: 'INVALID_EMBEDDED_ARRAY',
    VALIDATION_ERROR: 'SCHEMA_VALIDATION_ERROR',
    REQUIRED_FIELD: 'REQUIRED_FIELD',
    INVALID_FIELD: 'INVALID_FIELD',
    INVALID_TYPE: 'INVALID_TYPE',
    INVALID_REGEX: 'INVALID_REGEX',
    INVALID_FORMAT: 'INVALID_FORMAT',
    INVALID_ENUM: 'INVALID_ENUM',
    INVALID_LENGTH: 'INVALID_LENGTH',
    INVALID_VALUE: 'INVALID_VALUE'
  },

  // Query errors
  QUERY: {
    INVALID_OPERATOR: 'INVALID_OPERATOR',
    INVALID_CRITERIA: 'INVALID_CRITERIA'
  }
}

/**
 * Class for handling DocuDB errors
 * @extends Error
 */
class DocuDBError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} code - Error code from MCO_ERROR
   * @param {Object} details - Additional error details
   */
  constructor (message, code, details = {}) {
    super(message)
    this.name = 'DocuDBError'
    this.code = code
    this.details = details
    this.timestamp = new Date()

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DocuDBError)
    }
  }

  /**
   * Converts the error to a JSON object
   * @returns {Object} - JSON representation of the error
   */
  toJSON () {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    }
  }
}

module.exports = {
  MCO_ERROR,
  DocuDBError
}
