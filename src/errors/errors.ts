/**
 * Error handling module
 * Provides standardized error codes and error classes
 */

/**
 * Database error codes
 */
export interface DatabaseErrorCodes {
  NOT_INITIALIZED: string
  INVALID_NAME: string
  LOAD_ERROR: any
  COLLECTION_ERROR: any
  /** Error during database initialization */
  INIT_ERROR: string
  /** Collection not found */
  COLLECTION_NOT_FOUND: string
  /** Invalid collection name */
  INVALID_COLLECTION_NAME: string
  /** Collection already exists */
  COLLECTION_ALREADY_EXISTS: string
  /** Document not found */
  DOCUMENT_NOT_FOUND: string
  /** Invalid document ID */
  INVALID_ID: string
  /** Duplicate document ID */
  DUPLICATE_ID: string
  /** Invalid query syntax */
  INVALID_QUERY: string
  /** Invalid update operation */
  INVALID_UPDATE: string
  /** Transaction processing error */
  TRANSACTION_ERROR: string
}

/**
 * Schema error codes
 */
export interface SchemaErrorCodes {
  CUSTOM_VALIDATION_ERROR: string
  INVALID_ENUM: any
  INVALID_REGEX: any
  INVALID_LENGTH: any
  INVALID_VALUE: any
  /** Invalid document structure */
  INVALID_DOCUMENT: string
  /** Missing required field */
  REQUIRED_FIELD: string
  /** Field has invalid type */
  INVALID_TYPE: string
  /** Validation rule failed */
  VALIDATION_ERROR: string
  /** Field not allowed in schema */
  INVALID_FIELD: string
}

/**
 * Storage error codes
 */
export interface StorageErrorCodes {
  SAVE_ERROR: any
  INIT_ERROR: any
  /** File not found */
  FILE_NOT_FOUND: string
  /** Error writing to storage */
  WRITE_ERROR: string
  /** Error reading from storage */
  READ_ERROR: string
  /** Error deleting from storage */
  DELETE_ERROR: string
  /** Error during compression/decompression */
  COMPRESSION_ERROR: string
}

/**
 * Index error codes
 */
export interface IndexErrorCodes {
  INVALID_FIELD_TYPE: string
  LOAD_ERROR: any
  SAVE_ERROR: any
  UNIQUE_VIOLATION: any
  INIT_ERROR: any
  DROP_ERROR: any
  /** Error creating index */
  CREATE_ERROR: string
  /** Error updating index */
  UPDATE_ERROR: string
  /** Error deleting index */
  DELETE_ERROR: string
  /** Unique constraint violation */
  UNIQUE_CONSTRAINT: string
}

export interface DocumentErrorCodes {
  INVALID_TYPE: string
  DELETE_ERROR: string
  LOCK_ERROR: string
  UPDATE_ERROR: string
  QUERY_ERROR: string
  INVALID_ID: string
  INVALID_DOCUMENT: string
  NOT_FOUND: string
  INSERT_ERROR: string
}

export interface CollectionErrorCodes {
  METADATA_ERROR: string
  DROP_ERROR: string
  INVALID_NAME: string
  INSERT_ERROR: any
}

export interface CompressionErrorCodes {
  COMPRESS_ERROR: string
  INSERT_ERROR: any
}

export interface QueryErrorCodes {
  INVALID_OPERATOR: string
  INSERT_ERROR: any
}

export interface InsertErrorCodes {
  INSERT_ERROR: any
}

/**
 * All error codes organized by module
 */
export interface ErrorCodes {
  QUERY: QueryErrorCodes
  DOCUMENT: DocumentErrorCodes
  COLLECTION: CollectionErrorCodes
  COMPRESSION: CompressionErrorCodes
  DATABASE: DatabaseErrorCodes
  SCHEMA: SchemaErrorCodes
  STORAGE: StorageErrorCodes
  INDEX: IndexErrorCodes
}

// Error codes organized by module
const MCO_ERROR: ErrorCodes = {
  DATABASE: {
    INVALID_NAME: 'DB000',
    INIT_ERROR: 'DB001',
    COLLECTION_NOT_FOUND: 'DB002',
    INVALID_COLLECTION_NAME: 'DB003',
    COLLECTION_ALREADY_EXISTS: 'DB004',
    DOCUMENT_NOT_FOUND: 'DB005',
    INVALID_ID: 'DB006',
    DUPLICATE_ID: 'DB007',
    INVALID_QUERY: 'DB008',
    INVALID_UPDATE: 'DB009',
    TRANSACTION_ERROR: 'DB010',
    NOT_INITIALIZED: 'DB011',
    LOAD_ERROR: undefined,
    COLLECTION_ERROR: undefined
  },
  SCHEMA: {
    INVALID_DOCUMENT: 'SCH001',
    REQUIRED_FIELD: 'SCH002',
    INVALID_TYPE: 'SCH003',
    VALIDATION_ERROR: 'SCH004',
    INVALID_FIELD: 'SCH005',
    CUSTOM_VALIDATION_ERROR: 'SCH006',
    INVALID_ENUM: undefined,
    INVALID_REGEX: undefined,
    INVALID_LENGTH: undefined,
    INVALID_VALUE: undefined
  },
  STORAGE: {
    FILE_NOT_FOUND: 'STO001',
    WRITE_ERROR: 'STO002',
    READ_ERROR: 'STO003',
    DELETE_ERROR: 'STO004',
    COMPRESSION_ERROR: 'STO005',
    SAVE_ERROR: undefined,
    INIT_ERROR: undefined
  },
  INDEX: {
    CREATE_ERROR: 'IDX001',
    UPDATE_ERROR: 'IDX002',
    DELETE_ERROR: 'IDX003',
    UNIQUE_CONSTRAINT: 'IDX004',
    LOAD_ERROR: undefined,
    SAVE_ERROR: undefined,
    UNIQUE_VIOLATION: undefined,
    INIT_ERROR: undefined,
    DROP_ERROR: undefined,
    INVALID_FIELD_TYPE: 'IDX005'
  },
  DOCUMENT: {
    NOT_FOUND: 'DOC001',
    INSERT_ERROR: 'DOC002',
    INVALID_TYPE: 'DOC003',
    DELETE_ERROR: 'DOC004',
    LOCK_ERROR: 'DOC005',
    UPDATE_ERROR: 'DOC006',
    QUERY_ERROR: 'DOC007',
    INVALID_ID: 'DOC008',
    INVALID_DOCUMENT: 'DOC009'
  },
  COLLECTION: {
    METADATA_ERROR: 'COL001',
    DROP_ERROR: 'COL002',
    INVALID_NAME: 'COL003',
    INSERT_ERROR: 'COL004'
  },
  COMPRESSION: {
    INSERT_ERROR: 'COM001',
    COMPRESS_ERROR: 'COM002'
  },
  QUERY: {
    INSERT_ERROR: 'QUE001',
    INVALID_OPERATOR: 'QUE002'
  }
}

/**
 * Class for handling DocuDB errors
 * @extends Error
 */
class DocuDBError extends Error {
  code: string
  details: any
  timestamp: Date
  /**
   * @param {string} message - Error message
   * @param {string} code - Error code from MCO_ERROR
   * @param {Object} details - Additional error details
   */
  constructor (message: string, code: string, details: any = {}) {
    super(message)
    this.name = 'DocuDBError'
    this.code = code
    this.details = details
    this.timestamp = new Date()

    // Capture stack trace
    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, DocuDBError)
    }
  }

  /**
   * Converts the error to a JSON object
   * @returns {Object} - JSON representation of the error
   */
  toJSON (): object {
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

export { MCO_ERROR, DocuDBError }
