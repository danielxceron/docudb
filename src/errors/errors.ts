/**
 * Error handling module
 * Provides standardized error codes and error classes
 */

/** Database error codes */
export interface DatabaseErrorCodes {
  /** Database not initialized */
  NOT_INITIALIZED: string
  /** Invalid database name */
  INVALID_NAME: string
  /** Error while loading existing data */
  LOAD_ERROR: string
  /** Generic collection error */
  COLLECTION_ERROR: string
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
  /** Database is already closed */
  CLOSED: string
  /** On-disk format is not supported */
  UNSUPPORTED_FORMAT: string
  /** Migration failed */
  MIGRATION_ERROR: string
}

/** Schema error codes */
export interface SchemaErrorCodes {
  /** Custom validator failed */
  CUSTOM_VALIDATION_ERROR: string
  /** Value not in enum */
  INVALID_ENUM: string
  /** String does not match pattern */
  INVALID_REGEX: string
  /** Length out of bounds */
  INVALID_LENGTH: string
  /** Value out of bounds */
  INVALID_VALUE: string
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
  /** Asynchronous validator used on the synchronous path */
  ASYNC_VALIDATOR: string
}

/** Storage error codes */
export interface StorageErrorCodes {
  /** Error while saving data */
  SAVE_ERROR: string
  /** Error while initializing storage */
  INIT_ERROR: string
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

/** Index error codes */
export interface IndexErrorCodes {
  /** Invalid field type for an index */
  INVALID_FIELD_TYPE: string
  /** Error loading indexes */
  LOAD_ERROR: string
  /** Error saving indexes */
  SAVE_ERROR: string
  /** Duplicate value in a unique index */
  UNIQUE_VIOLATION: string
  /** Error initializing indexes */
  INIT_ERROR: string
  /** Error dropping an index */
  DROP_ERROR: string
  /** Error creating an index */
  CREATE_ERROR: string
  /** Error updating an index */
  UPDATE_ERROR: string
  /** Error deleting an index */
  DELETE_ERROR: string
  /** Unique constraint violation (legacy alias) */
  UNIQUE_CONSTRAINT: string
}

/** Document error codes */
export interface DocumentErrorCodes {
  /** Invalid type */
  INVALID_TYPE: string
  /** Error deleting a document */
  DELETE_ERROR: string
  /** Document is locked by another operation */
  LOCK_ERROR: string
  /** Error updating a document */
  UPDATE_ERROR: string
  /** Error executing a query */
  QUERY_ERROR: string
  /** Invalid document ID */
  INVALID_ID: string
  /** Invalid document */
  INVALID_DOCUMENT: string
  /** Document not found */
  NOT_FOUND: string
  /** Error inserting a document */
  INSERT_ERROR: string
  /** Duplicate document ID */
  DUPLICATE_ID: string
  /** Document already exists */
  ALREADY_EXISTS: string
  /** Batch operation partially applied */
  BULK_ERROR: string
}

/** Collection error codes */
export interface CollectionErrorCodes {
  /** Metadata error */
  METADATA_ERROR: string
  /** Error dropping the collection */
  DROP_ERROR: string
  /** Invalid collection name */
  INVALID_NAME: string
  /** Error inserting into the collection */
  INSERT_ERROR: string
  /** Error renaming the collection */
  RENAME_ERROR: string
}

/** Compression error codes */
export interface CompressionErrorCodes {
  /** Error compressing data */
  COMPRESS_ERROR: string
  /** Error decompressing data */
  DECOMPRESS_ERROR: string
  /** Legacy alias */
  INSERT_ERROR: string
}

/** Query error codes */
export interface QueryErrorCodes {
  /** Invalid operator */
  INVALID_OPERATOR: string
  /** Invalid criteria */
  INVALID_CRITERIA: string
  /** Unsupported aggregation stage */
  INVALID_STAGE: string
  /** Legacy alias */
  INSERT_ERROR: string
}

/** All error codes organized by module */
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

/** Stable, documented error codes. Every entry has a value: no `undefined`. */
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
    LOAD_ERROR: 'DB012',
    COLLECTION_ERROR: 'DB013',
    CLOSED: 'DB014',
    UNSUPPORTED_FORMAT: 'DB015',
    MIGRATION_ERROR: 'DB016'
  },
  SCHEMA: {
    INVALID_DOCUMENT: 'SCH001',
    REQUIRED_FIELD: 'SCH002',
    INVALID_TYPE: 'SCH003',
    VALIDATION_ERROR: 'SCH004',
    INVALID_FIELD: 'SCH005',
    CUSTOM_VALIDATION_ERROR: 'SCH006',
    INVALID_ENUM: 'SCH007',
    INVALID_REGEX: 'SCH008',
    INVALID_LENGTH: 'SCH009',
    INVALID_VALUE: 'SCH010',
    ASYNC_VALIDATOR: 'SCH011'
  },
  STORAGE: {
    FILE_NOT_FOUND: 'STO001',
    WRITE_ERROR: 'STO002',
    READ_ERROR: 'STO003',
    DELETE_ERROR: 'STO004',
    COMPRESSION_ERROR: 'STO005',
    SAVE_ERROR: 'STO006',
    INIT_ERROR: 'STO007'
  },
  INDEX: {
    CREATE_ERROR: 'IDX001',
    UPDATE_ERROR: 'IDX002',
    DELETE_ERROR: 'IDX003',
    UNIQUE_CONSTRAINT: 'IDX004',
    LOAD_ERROR: 'IDX006',
    SAVE_ERROR: 'IDX007',
    UNIQUE_VIOLATION: 'IDX008',
    INIT_ERROR: 'IDX009',
    DROP_ERROR: 'IDX010',
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
    INVALID_DOCUMENT: 'DOC009',
    DUPLICATE_ID: 'DOC010',
    ALREADY_EXISTS: 'DOC011',
    BULK_ERROR: 'DOC012'
  },
  COLLECTION: {
    METADATA_ERROR: 'COL001',
    DROP_ERROR: 'COL002',
    INVALID_NAME: 'COL003',
    INSERT_ERROR: 'COL004',
    RENAME_ERROR: 'COL005'
  },
  COMPRESSION: {
    COMPRESS_ERROR: 'COM001',
    DECOMPRESS_ERROR: 'COM002',
    INSERT_ERROR: 'COM001'
  },
  QUERY: {
    INVALID_OPERATOR: 'QUE001',
    INVALID_CRITERIA: 'QUE002',
    INVALID_STAGE: 'QUE003',
    INSERT_ERROR: 'QUE001'
  }
}

/** Additional details attached to an error */
export interface DocuDBErrorDetails {
  [key: string]: unknown
}

/**
 * Error thrown by every DocuDB operation.
 *
 * The original error is always available through `cause` (standard `Error`
 * option) and through `details.originalError`. The `code` of a wrapped
 * `DocuDBError` is preserved so callers can react to the real cause.
 */
class DocuDBError extends Error {
  /** Stable error code from {@link MCO_ERROR} */
  code: string
  /** Structured information about the failure */
  details: DocuDBErrorDetails
  /** When the error was created */
  timestamp: Date

  /**
   * @param message - Human readable message
   * @param code - Error code from MCO_ERROR
   * @param details - Additional error details
   */
  constructor (
    message: string,
    code: string,
    details: DocuDBErrorDetails = {},
    options?: { cause?: unknown }
  ) {
    super(message, options as ErrorOptions)
    this.name = 'DocuDBError'
    this.code = code
    this.details = details
    this.timestamp = new Date()

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, DocuDBError)
    }
  }

  /**
   * Type guard for `DocuDBError`
   * @param value - Any value
   * @returns true when the value is a DocuDBError
   */
  static isDocuDBError (value: unknown): value is DocuDBError {
    return value instanceof DocuDBError
  }

  /**
   * Wraps an error while preserving its code when it already is a DocuDBError.
   *
   * The original message is kept as a prefix of the resulting message so that
   * `error.message.includes(...)` keeps working for consumers.
   * @param error - Original error
   * @param code - Fallback code when the original is not a DocuDBError
   * @param details - Additional details merged into the error
   * @returns A DocuDBError
   */
  static wrap (
    error: unknown,
    code: string,
    details: DocuDBErrorDetails = {}
  ): DocuDBError {
    if (DocuDBError.isDocuDBError(error)) {
      // Preserve the original code and message; only enrich the details.
      if (Object.keys(details).length > 0) {
        error.details = { ...error.details, ...details }
      }
      return error
    }

    const message = error instanceof Error ? error.message : String(error)
    return new DocuDBError(
      message,
      code,
      { ...details, originalError: error },
      { cause: error }
    )
  }

  /** Serializes the error (including the causal chain) to a plain object */
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
