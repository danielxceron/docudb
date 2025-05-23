/**
 * Core type definitions for DocuDB
 * Contains interfaces and types for all major components
 */

/**
 * ID generation strategy
 */
export type IdType = 'mongo' | 'uuid'

/**
 * Common configuration options shared across components
 */
export interface CommonOptions {
  /** Directory to store data
   * @default './data'
  */
  dataDir: string
}

/**
 * Database configuration options
 */
export interface DatabaseOptions extends Partial<CommonOptions> {
  /** Database name
   * @default 'docudb'
  */
  name?: string

  /** Maximum chunk size in bytes
   * @default 1024
  */
  chunkSize?: number

  /** Indicates if compression should be used
   * @default false
  */
  compression?: boolean

  /** ID generation type: 'mongo' or 'uuid'
   * @default 'mongo'
  */
  idType?: IdType
}

/**
 * Storage options for file management
 */
export interface StorageOptions extends CommonOptions {
  /** Maximum chunk size in bytes */
  chunkSize: number
  /** Indicates if compression should be used */
  compression: boolean
}

/**
 * Index manager options
 */
export interface IndexManagerOptions extends CommonOptions {}

/**
 * Field definition for indexes
 */
export type IndexField = string | string[]

/**
 * Metadata for a collection
 */
export interface Metadata {
  indices: IndexMetadataProperties[]
}

/**
 * Metadata properties for indexes
 */
export interface IndexMetadataProperties {
  /** Field name */
  field?: IndexField
  /** Index options */
  options?: IndexOptions
}

/**
 * Document locks for concurrency control
 */
export interface DocumentLocks {
  [documentId: string]: boolean
}

/**
 * Index structure
 */
export interface Index extends IndexMetadataProperties {
  /** Index name */
  name: string
  /** Whether the index is compound */
  isCompound: boolean
  /** Whether the index enforces uniqueness */
  unique: boolean
  /** Whether the index is sparse */
  sparse: boolean
  /** Entries for the index */
  entries: Record<string, string[]>
  /** Metadata for the index */
  metadata: Record<string, any>
}

/**
 * Index options
 */
export interface IndexOptions {
  /** Index name */
  name?: string
  /** Field name */
  field?: IndexField
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
  /** Nested index options */
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
  /** Number of documents in the collection */
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
 * Index definition for creating indexes
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
 * Base document structure
 */
export interface Document {
  /** Document unique identifier */
  _id?: string
  [key: string]: any
}

/**
 * Document with guaranteed ID field
 */
export interface DocumentWithId extends Document {
  _id: string
}

/**
 * Supported schema field types
 */
export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'

/**
 * Default value generator function
 */
export type DefaultValueGenerator = (doc: Document, field: string) => unknown

/**
 * Schema field definition
 */
export interface SchemaFieldDefinition {
  /** Data type */
  type: SchemaFieldType
  /** Whether the field is required */
  required?: boolean
  /** Default value or function to generate default */
  default?: unknown | DefaultValueGenerator
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
 * Custom validation function type
 */
export type CustomValidator = (value: any, doc?: Document) => boolean | string | Promise<boolean | string>

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
  enum?: unknown[]
  /** Custom validation function that can return a boolean or an error message */
  custom?: CustomValidator
  /** Custom error message for validation failures */
  message?: string
}

/**
 * Query criteria for filtering documents
*/
export interface QueryCriteria extends QueryOperator {
  [key: string]: any | QueryCriteria
}

export interface QueryOperator {
  /** Logical operators */

  /** Or operator
   * @description Logical OR operator
   * @example { $or: [{ name: 'John' }, { age: { $gt: 30 } }] }
   */
  $or?: QueryCriteria[]

  /** And operator
   * @description Logical AND operator
   * @example { $and: [{ name: 'John', age: { $gt: 30 } }, { city: 'New York' }] }
   */
  $and?: QueryCriteria[]

  /** Not operator
   * @description Logical NOT operator
   * @example { $not: { name: 'John' } }
   * @example { $not: { name: { $eq: 'John' } } }
   */
  $not?: QueryCriteria

  /** Array of values */

  /** In operator
   * @description Matches any of the values in the array
   * @example { $in: ['John', 'Jane'] }
   */
  $in?: any[]

  /** Not in operator
   * @description Matches none of the values in the array
   * @example { $nin: ['John', 'Jane'] }
   */
  $nin?: any[]

  /** Comparison operators */

  /** Equal operator (=)
   * @description Matches documents where the value of the field is equal to the specified value
   * @example
   * { name: { $eq: 'John' }, age: { $eq: 30 } }
   */
  $eq?: any

  /** Not equal operator (!=)
   * @description Matches documents where the value of the field is not equal to the specified value
   * @example { $ne: 'John' }
   */
  $ne?: any

  /** Greater than operator (>)
   * @description Matches documents where the value of the field is greater than the specified value
   * Similar to the greater than operator in SQL
   * @example { age: { $gt: 30 } }
   */
  $gt?: any

  /** Greater than or equal operator (>=)
   * @description Matches documents where the value of the field is greater than or equal to the specified value
   * Similar to the greater than or equal operator in SQL
   * @example { age: { $gte: 30 } }
   */
  $gte?: any

  /** Less than operator (<)
   * @description Matches documents where the value of the field is less than the specified value
   * Similar to the less than operator in SQL
   * @example { age: { $lt: 30 } }
   */
  $lt?: any

  /** Less than or equal operator (<=)
   * @description Matches documents where the value of the field is less than or equal to the specified value
   * Similar to the less than or equal operator in SQL
   * @example { age: { $lte: 30 } }
   */
  $lte?: any

  /** Existence operator
   * @description Matches documents where the specified field exists
   * @example { name: { $exists: true } }
   */
  $exists?: boolean

  /** Regular expression operator
   * @description Matches documents where the value of the field matches the specified regular expression
   * @example { name: { $regex: /John/ } }
   */
  $regex?: RegExp

  /** Size operator
   * @description Matches documents where the value of the field is an array and has the specified size
   * @example { tags: { $size: 2 } }
   */
  $size?: number

  /** All operator
   * @description Matches documents where the value of the field is an array and contains all the specified values
   * @example { tags: { $all: ['tag1', 'tag2'] } }
   */
  $all?: any[]
}

/**
 * Sort direction
 */
export type SortDirection = 1 | -1

/**
 * Sort options for query results
 */
export type SortOptions = Record<string, SortDirection>

/**
 * Projection value
 */
export type ProjectionValue = 1 | 0

/**
 * Field selection for query results
 */
export type SelectFields = Record<string, ProjectionValue> | string[]

/**
 * Update operations for modifying documents
 */
export interface UpdateOperations {
  /** Fields to set with new values */
  $set?: Record<string, unknown>
  /** Fields to increment by specified amount */
  $inc?: Record<string, number>
  /** Fields to multiply by specified amount */
  $mul?: Record<string, number>
  /** Fields to remove */
  $unset?: Record<string, unknown>
  /** Elements to add to arrays if not already present */
  $addToSet?: Record<string, unknown>
  /** Elements to push to arrays */
  $push?: Record<string, unknown>
  /** Elements to pull from arrays */
  $pull?: Record<string, unknown>
  /** Elements to pop from arrays (1 for last, -1 for first) */
  $pop?: Record<string, SortDirection>
  [key: string]: unknown
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
  projection?: Record<string, ProjectionValue>
}

/**
 * Base result interface for database operations
 */
export interface OperationResult {
  /** Indicates if the operation was acknowledged */
  acknowledged: boolean
}

/**
 * Result of an update operation
 */
export interface UpdateResult extends OperationResult {
  /** Number of documents matched */
  matchedCount: number
  /** Number of documents modified */
  modifiedCount: number
}

/**
 * Result of a delete operation
 */
export interface DeleteResult extends OperationResult {
  /** Number of documents deleted */
  deletedCount: number
}

/**
 * Result of an insert operation
 */
export interface InsertResult extends OperationResult {
  /** Number of documents inserted */
  insertedCount: number
  /** IDs of inserted documents */
  insertedIds: string[]
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
  matches: (doc: Record<string, unknown>) => boolean
  /** Sets sort options */
  sort: (sortBy: SortOptions) => Query
  /** Sets limit value */
  limit: (n: number) => Query
  /** Sets skip value */
  skip: (n: number) => Query
  /** Sets fields to select */
  select: (fields: SelectFields) => Query
  /** Executes the query on a collection of documents */
  execute: (documents: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
}
