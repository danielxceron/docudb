/**
 * Core type definitions for DocuDB
 * Contains interfaces and types for all major components
 */

export type IdType = 'mongo' | 'uuid'

/**
 * Database configuration options
 */
export interface DatabaseOptions {
  /** Database name */
  name?: string
  /** Directory to store data */
  dataDir?: string
  /** Maximum chunk size in bytes */
  chunkSize?: number
  /** Indicates if compression should be used */
  compression?: boolean
  /** ID generation type: 'mongo' or 'uuid' */
  idType?: IdType
}

/**
 * Storage options for file management
 */
export interface StorageOptions {
  /** Directory to store data */
  dataDir: string
  /** Maximum chunk size in bytes */
  chunkSize: number
  /** Indicates if compression should be used */
  compression: boolean
}

/**
 * Index manager options
 */
export interface IndexManagerOptions {
  /** Directory to store index data */
  dataDir: string
}

/**
 * Metadata for a collection
 */
export interface Metadata {
  indices: MetadataProperties[]
}

/**
 * Metadata properties
 */
export interface MetadataProperties {
  /** Field name */
  field?: string
  /** Index options */
  options?: IndexOptions
}

// _documentLocks globalThis
export interface DocumentLocks {
  [key: string]: boolean
}

// Create empty index structure
// this.indices[indexKey] = {
//   field,
//   isCompound,
//   unique: options.unique === true,
//   sparse: options.sparse === true,
//   entries: {}, // Map of values to document IDs
//   metadata: {
//     created: new Date(),
//     updated: new Date(),
//     name:
//       options.name ||
//       (isCompound ? `idx_${field.join('_')}` : `idx_${field}`),
//     ...options
//   }
// }

/**
 * Index options
 */
export interface IndexOptions {
  /** Index name */
  name?: string
  /** Field name */
  field?: string | string[]
  /** Whether the index is compound */
  isCompound?: boolean
  /** Whether the index enforces uniqueness */
  unique?: boolean
  /** Whether the index is sparse */
  sparse?: boolean
  /** Entries for the index */
  entries?: Record<string, string[]>
  /** Metadata for the index */
  metadata?: Record<string, any>
  /** Index options */
  options?: IndexOptions
}

/**
 * Collection options
 */
export interface CollectionOptions {
  /** ID generation type */
  idType?: IdType
  /** Schema for document validation */
  schema?: Schema
  /** Indicates if timestamps should be added automatically */
  timestamps?: boolean
}

/**
 * Collection metadata
 */
export interface CollectionMetadata {
  /** Collection name */
  count: number
  /** Indices for the collection */
  indices: IndexOptions[]
  /** Created date */
  created: Date
  /** Updated date */
  updated: Date
  /** Document order */
  documentOrder: string[]
}

/**
 * Index definition
 */
export interface IndexDefinition {
  /** Fields included in the index */
  fields: Record<string, 1 | -1> | string[]
  /** Whether the index enforces uniqueness */
  unique?: boolean
  /** Custom name for the index */
  name?: string
}

/**
 * Document with required _id field
 */
export interface Document {
  /** Document unique identifier */
  _id?: string
  [key: string]: any
}

export interface DocumentWithId extends Document {
  _id: string
}

/**
 * Schema field definition
 */
export interface SchemaFieldDefinition {
  /** Data type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
  /** Whether the field is required */
  required?: boolean
  /** Default value or function to generate default */
  default?: any | ((doc: any, field: string) => any)
  /** Validation rules */
  validate?: ValidationRules
  /** Transform function to modify the value */
  transform?: (value: any) => any
}

/**
 * Schema definition as a map of field definitions
 */
export type SchemaDefinition = Record<string, SchemaFieldDefinition>

/**
 * Schema options
 */
export interface SchemaOptions {
  /** ID generation type */
  idType?: IdType
  /** Whether to enforce strict mode (no additional fields) */
  strict?: boolean
  /** Whether to add timestamps automatically */
  timestamps?: boolean
}

/**
 * Validation rules for schema fields
 */
export interface ValidationRules {
  /** Minimum value for numbers */
  min?: number
  /** Maximum value for numbers */
  max?: number
  /** Minimum length for strings or arrays */
  minLength?: number
  /** Maximum length for strings or arrays */
  maxLength?: number
  /** Regular expression pattern for strings */
  pattern?: RegExp
  /** Enumerated allowed values */
  enum?: any[]
  /** Custom validation function */
  custom?: (value: any) => boolean | Promise<boolean>
}

/**
 * Query criteria for filtering documents
 */
export type QueryCriteria = Record<string, any>

/**
 * Sort options for query results
 */
export type SortOptions = Record<string, 1 | -1>

/**
 * Field selection for query results
 */
export type SelectFields = Record<string, 1 | 0> | string[]

/**
 * Update operations for modifying documents
 */
export interface UpdateOperations {
  /** Fields to set with new values */
  $set?: Record<string, any>
  /** Fields to increment by specified amount */
  $inc?: Record<string, number>
  /** Fields to multiply by specified amount */
  $mul?: Record<string, number>
  /** Fields to remove */
  $unset?: Record<string, any>
  /** Elements to add to arrays if not already present */
  $addToSet?: Record<string, any>
  /** Elements to push to arrays */
  $push?: Record<string, any>
  /** Elements to pull from arrays */
  $pull?: Record<string, any>
  /** Elements to pop from arrays (1 for last, -1 for first) */
  $pop?: Record<string, 1 | -1>
  [key: string]: any
}

/**
 * Find options for querying documents
 */
export interface FindOptions {
  /** Maximum number of results to return */
  limit?: number
  /** Number of results to skip */
  skip?: number
  /** Fields to sort by */
  sort?: SortOptions
  /** Fields to include or exclude */
  projection?: Record<string, 1 | 0>
}

/**
 * Result of an update operation
 */
export interface UpdateResult {
  /** Number of documents matched */
  matchedCount: number
  /** Number of documents modified */
  modifiedCount: number
  /** Indicates if the operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  /** Number of documents deleted */
  deletedCount: number
  /** Indicates if the operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result of an insert operation
 */
export interface InsertResult {
  /** Number of documents inserted */
  insertedCount: number
  /** IDs of inserted documents */
  insertedIds: string[]
  /** Indicates if the operation was acknowledged */
  acknowledged: boolean
}

/**
 * Schema class interface
 */
export interface Schema {
  /** Schema definition */
  definition: SchemaDefinition
  /** Schema options */
  options: SchemaOptions
  /** Validates a document against the schema */
  validate: (document: Document) => Document
}

/**
 * Query class interface
 */
export interface Query {
  /** Query criteria */
  criteria: QueryCriteria
  /** Sort options */
  sortOptions: SortOptions | null
  /** Limit value */
  limitValue: number | null
  /** Skip value */
  skipValue: number
  /** Fields to select */
  selectFields: SelectFields | null
  /** Checks if a document matches the criteria */
  matches: (doc: Record<string, any>) => boolean
  /** Sets sort options */
  sort: (sortBy: SortOptions) => Query
  /** Sets limit value */
  limit: (n: number) => Query
  /** Sets skip value */
  skip: (n: number) => Query
  /** Sets fields to select */
  select: (fields: SelectFields) => Query
  /** Executes the query on a collection of documents */
  execute: (documents: Array<Record<string, any>>) => Array<Record<string, any>>
}
