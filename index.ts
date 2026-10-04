/**
 * DocuDB - Document-based NoSQL database for Node.js.
 *
 * Zero runtime dependencies, gzip compression, chunking, schema validation,
 * MongoDB-like queries, indexes and on-disk format versioning.
 */

import Database, { Collection } from './src/core/database.js'
import type { BulkOperation, BulkWriteResult } from './src/core/database.js'
import Schema from './src/schema/schema.js'
import Query from './src/query/query.js'
import FileStorage from './src/storage/fileStorage.js'
import IndexManager from './src/index/indexManager.js'
import aggregate from './src/aggregation/aggregate.js'
import migrateDatabase from './src/migrate/migrate.js'
import deepCopy from './src/utils/deepCopy.js'
import { KeyedMutex } from './src/utils/mutex.js'
import { MCO_ERROR, DocuDBError } from './src/errors/errors.js'
import {
  generateUUID,
  isValidUUID,
  isValidMongoID,
  isValidID
} from './src/utils/uuidUtils.js'
import {
  validatePath,
  sanitizeName,
  MAX_NAME_LENGTH
} from './src/utils/pathValidator.js'
import {
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  hasNestedValue,
  compareValues
} from './src/utils/paths.js'
import { FORMAT_VERSION } from './src/types/index.js'

/**
 * Type re-exports. Everything is exported as a type so that the runtime bundle
 * stays free of type-only imports.
 */
export type {
  // Options and primitives
  IdType,
  CommonOptions,
  DatabaseOptions,
  StorageOptions,
  CompressionOption,
  Logger,
  IndexManagerOptions,
  IndexField,
  Indices,

  // Documents
  DocumentStructure,
  Document,
  WithId,
  DocumentInput,
  Filter,
  Condition,
  InferSchema,

  // Metadata and statistics
  CollectionMetadata,
  CollectionStats,
  DatabaseStats,
  Index,
  IndexMetadata,
  IndexMetadataProperties,
  IndexOptions,
  IndexDescription,
  Metadata,
  StoredDocument,
  DocumentFileExtension,
  ExplainResult,
  OrderLogEntry,
  DocumentLocks,
  IndexDefinition,

  // Schema
  SchemaDefinition,
  SchemaOptions,
  SchemaFieldType,
  SchemaFieldDefinition,
  ValidationRules,
  CustomValidator,
  DefaultValueGenerator,
  SchemaInterface,

  // Query and updates
  QueryCriteria,
  QueryFieldName,
  QueryLogicalOperators,
  QuerySpecificOperators,
  QueryInterface,
  SortDirection,
  SortOptions,
  ProjectionValue,
  SelectFields,
  UpdateOperations,
  UpdateOperator,
  FindOptions,

  // Results
  OperationResult,
  UpdateResult,
  DeleteResult,
  InsertResult,

  // Aggregation
  AggregationStage,
  Accumulator,

  // Migration
  MigrationOptions,
  MigrationReport
} from './src/types/index.js'

export {
  // Main classes
  Database,
  Collection,
  Schema,
  Query,
  FileStorage,
  IndexManager,

  // Functions
  aggregate,
  migrateDatabase,
  deepCopy,

  // Utilities
  KeyedMutex,
  generateUUID,
  isValidUUID,
  isValidMongoID,
  isValidID,
  validatePath,
  sanitizeName,
  MAX_NAME_LENGTH,
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  hasNestedValue,
  compareValues,

  // Errors
  MCO_ERROR,
  DocuDBError,

  // Constants
  FORMAT_VERSION
}

export type { BulkOperation, BulkWriteResult }
