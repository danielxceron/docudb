/**
 * Core type definitions for DocuDB
 * Contains interfaces and types for all major components
 */

/** On-disk format version written by this build */
export const FORMAT_VERSION = 2

/** ID generation strategy */
export type IdType = 'mongo' | 'uuid'

/**
 * Common configuration options shared across components
 */
export interface CommonOptions {
  /** Root directory where databases are stored
   * @default './data'
   */
  dataDir: string
}

/** Compression strategy */
export type CompressionOption = boolean | 'auto'

/** Optional lifecycle hooks */
export interface Logger {
  debug?: (message: string, ...args: unknown[]) => void
  info?: (message: string, ...args: unknown[]) => void
  warn?: (message: string, ...args: unknown[]) => void
  error?: (message: string, ...args: unknown[]) => void
}

/**
 * Database configuration options
 */
export interface DatabaseOptions extends Partial<CommonOptions> {
  /** Database name
   * @default 'docudb'
   */
  name?: string

  /** Maximum size in bytes of a single chunk before a document is split
   * @default 1048576 (1 MiB)
   */
  chunkSize?: number

  /** gzip compression. `'auto'` compresses only payloads above 4 KiB
   * @default true
   */
  compression?: CompressionOption

  /** Minimum payload size (bytes) compressed when `compression: 'auto'`
   * @default 4096
   */
  compressionThreshold?: number

  /** gzip compression level (0-9)
   * @default 6
   */
  compressionLevel?: number

  /** ID generation type: 'mongo' or 'uuid'
   * @default 'mongo'
   */
  idType?: IdType

  /** Maximum number of documents kept in the in-memory LRU cache
   * @default 1000
   */
  cacheSize?: number

  /** When greater than 0, metadata and index writes are grouped and flushed
   * every `flushInterval` ms and on `close()`
   * @default 0 (write-through, maximum durability)
   */
  flushInterval?: number

  /** Acquire an exclusive lock file so a second process cannot open the data
   * directory. Disable it when several instances live in one process
   * @default false
   */
  fileLock?: boolean

  /** Optional logger. The library never writes to the console by itself
   * @default undefined
   */
  logger?: Logger
}

/**
 * Storage options for file management
 */
export interface StorageOptions extends CommonOptions {
  /** Maximum chunk size in bytes */
  chunkSize: number
  /** Compression strategy */
  compression: CompressionOption
  /** Minimum payload size for `'auto'` compression */
  compressionThreshold: number
  /** gzip level */
  compressionLevel: number
}

/** Extension of a single document file */
export type DocumentFileExtension = '.json' | '.json.gz'

/** Storage outcome for a single document */
export interface StoredDocument {
  /** Absolute paths of the files holding the document */
  paths: string[]
  /** Total bytes written on disk */
  bytes: number
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
  options?: IndexMetadata
}

/**
 * Document locks for concurrency control
 */
export interface DocumentLocks {
  [documentId: string]: boolean
}

/** Serialized index metadata */
export interface IndexMetadata {
  created: string
  updated: string
  name: string
  [key: string]: unknown
}

/**
 * Index structure as persisted on disk
 */
export interface Index {
  /** Indexed fields; always an array internally */
  fields: string[]
  /** Legacy single field projection */
  field: IndexField
  /** Whether the index spans several fields */
  isCompound: boolean
  /** Whether the index enforces uniqueness */
  unique: boolean
  /** Whether documents without the field are skipped */
  sparse: boolean
  /** Map of value key to document ids */
  entries: Record<string, string[]>
  /** Index metadata */
  metadata: IndexMetadata
}

/**
 * Index options
 */
export interface IndexOptions {
  /** Index name */
  name?: string
  /** Field name (alternative to the first argument) */
  field?: IndexField
  /** Whether the index is compound */
  isCompound?: boolean
  /** Whether the index enforces uniqueness */
  unique?: boolean
  /** Whether the index is sparse */
  sparse?: boolean
  /** Metadata for the index */
  metadata?: Record<string, unknown>
  /** Legacy nested options */
  options?: IndexOptions
}

/** Registry of indexes keyed by `collection:field+field` */
export interface Indices {
  [key: string]: Index
}

/**
 * Collection options
 */
export interface CollectionOptions {
  /** ID generation type */
  idType?: IdType
  /** Schema for document validation */
  schema?: SchemaInterface
  /** Adds `createdAt` and `updatedAt` automatically
   * @default false
   */
  timestamps?: boolean
  /** Maximum number of documents kept in the collection cache */
  cacheSize?: number
}

/** Description of an index, as returned by `listIndexes()` */
export interface IndexDescription {
  /** Indexed field, or fields when the index is compound */
  field: IndexField
  /** Indexed fields, always as a list */
  fields: string[]
  /** Whether the index enforces uniqueness */
  unique: boolean
  /** Whether documents without the field are skipped */
  sparse: boolean
  /** Index name */
  name: string
}

/**
 * Collection metadata (constant size, rewritten atomically)
 */
export interface CollectionMetadata {
  /** Number of documents in the collection */
  count: number
  /** Next sequence number to assign */
  nextSeq: number
  /** Indices for the collection */
  indices: IndexMetadataProperties[]
  /** Created date */
  created: string
  /** Updated date */
  updated: string
  /** On-disk format version */
  formatVersion: number
}

/** Entry of the append-only order log */
export type OrderLogEntry =
  | { s: number, i: string }
  | { d: string }
  | { o: string[] }

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
  /** Whether the index skips documents without the field */
  sparse?: boolean
}

/**
 * Base document structure
 */
export interface DocumentStructure {
  /** Document unique identifier */
  _id?: string
  [key: string]: any
}

/** Document with guaranteed ID field */
export interface Document extends DocumentStructure {
  _id: string
}

/** Document shape returned to callers */
export type WithId<T> = T & { _id: string }

/** Input accepted by insert/replace operations */
export type DocumentInput<T> = Omit<T, '_id'> & { _id?: string }

/**
 * Supported schema field types
 */
export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'object'
  | 'array'
  | 'null'
  | 'int'

/**
 * Default value generator function
 */
export type DefaultValueGenerator = (doc: DocumentStructure, field: string) => unknown

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
  /** Reject documents containing fields absent from the definition
   * @default false
   */
  strict?: boolean
  /** Maintain `_createdAt` / `_updatedAt` fields */
  timestamps?: boolean
}

/**
 * Custom validation function type
 */
export type CustomValidator = (
  value: any,
  doc?: DocumentStructure
) => boolean | string | void | Promise<boolean | string | void>

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
  /** Custom validation function */
  custom?: CustomValidator
  /** Custom error message for validation failures */
  message?: string
}

/**
 * Query logical operators
 */
export interface QueryLogicalOperators {
  /** Logical OR operator */
  $or?: QueryCriteria[]
  /** Logical AND operator */
  $and?: QueryCriteria[]
  /** Logical NOT operator */
  $not?: QueryCriteria
  /** Logical NOR operator */
  $nor?: QueryCriteria[]
}

/**
 * Query comparison operators
 */
export interface QuerySpecificOperators {
  /** Equal */
  $eq?: Date | number | string | boolean | null | undefined
  /** Not equal */
  $ne?: Date | number | string | boolean | null | undefined
  /** Greater than */
  $gt?: Date | number | string
  /** Greater than or equal */
  $gte?: Date | number | string
  /** Less than */
  $lt?: Date | number | string
  /** Less than or equal */
  $lte?: Date | number | string
  /** Matches any of the listed values */
  $in?: Array<Date | number | string | boolean | null | undefined>
  /** Matches none of the listed values */
  $nin?: Array<Date | number | string | boolean | null | undefined>
  /** Field existence */
  $exists?: boolean
  /** Regular expression (RegExp or `{ $regex, $options }`) */
  $regex?: RegExp | string
  /** Regular expression flags, used together with a string `$regex` */
  $options?: string
  /** Array length */
  $size?: number
  /** Array contains all listed values */
  $all?: Array<Date | number | string | boolean | null | undefined>
  /** Matches at least one array element against the nested condition */
  $elemMatch?: QueryCriteria
  /** BSON-like type check */
  $type?: SchemaFieldType | 'null' | 'objectId' | 'undefined'
  /** Case insensitive comparison */
  $options$?: never
}

/** Field to condition mapping used by typed filters */
export interface QueryFieldName {
  [key: string]: any
}

export type QueryCriteria = QueryLogicalOperators & QueryFieldName

/** Value accepted for a single field in a filter */
export type Condition<V> =
  | V
  | V[]
  | RegExp
  | { $regex: RegExp | string, $options?: string }
  | QuerySpecificOperators

/**
 * Typed filter. Falls back to a permissive index signature for schemaless
 * collections so that arbitrary fields keep working.
 */
export type Filter<T> = T extends DocumentStructure
  ? { [K in keyof T]?: Condition<T[K]> } & QueryLogicalOperators &
  Record<string, any>
  : QueryCriteria

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
export type ProjectionValue = 0 | 1 | boolean

/**
 * Field selection for query results
 */
export type SelectFields = Record<string, ProjectionValue> | string[]

/** Supported update operators */
export const UPDATE_OPERATORS = [
  '$set',
  '$unset',
  '$inc',
  '$mul',
  '$min',
  '$max',
  '$push',
  '$addToSet',
  '$pull',
  '$pop'
] as const

export type UpdateOperator = (typeof UPDATE_OPERATORS)[number]

/**
 * Update operations for modifying documents
 */
export interface UpdateOperations {
  /** Fields to set */
  $set?: Record<string, unknown>
  /** Fields to increment */
  $inc?: Record<string, number>
  /** Fields to multiply */
  $mul?: Record<string, number>
  /** Fields to set only when the document is created */
  $setOnInsert?: Record<string, unknown>
  /** Fields to keep the smallest of current/value */
  $min?: Record<string, unknown>
  /** Fields to keep the largest of current/value */
  $max?: Record<string, unknown>
  /** Fields to remove */
  $unset?: Record<string, unknown>
  /** Values appended only when missing */
  $addToSet?: Record<string, unknown>
  /** Values appended to arrays */
  $push?: Record<string, unknown>
  /** Values removed from arrays */
  $pull?: Record<string, unknown>
  /** Remove the first (1) or last (-1) element of an array */
  $pop?: Record<string, 1 | -1>
  /** Rename a field */
  $rename?: Record<string, string>
  /** Remove a field from an embedded document, preventing its creation */
  $unsetLeaf?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Find options for querying documents
 */
export interface FindOptions<T = DocumentStructure> {
  /** Maximum number of results to return */
  limit?: number
  /** Number of results to skip */
  skip?: number
  /** Fields to sort by */
  sort?: SortOptions
  /** Fields to include or exclude */
  projection?: Record<string, ProjectionValue> | string[]
  /** Reuse the internal document instead of returning a defensive copy */
  raw?: boolean
  /** @internal Keeps the generic parameter meaningful for consumers */
  readonly __document?: T
}

/**
 * Base result interface for database operations
 */
export interface OperationResult {
  /** Indicates if the operation was acknowledged */
  acknowledged: boolean
}

/** Result of an update operation */
export interface UpdateResult<T = DocumentStructure> extends OperationResult {
  /** Number of documents matched */
  matchedCount: number
  /** Number of documents modified */
  modifiedCount: number
  /** The modified document, when `returnDocument: 'after'` */
  document?: WithId<T> | null
}

/** Result of a delete operation */
export interface DeleteResult extends OperationResult {
  /** Number of documents deleted */
  deletedCount: number
}

/** Result of an insert operation */
export interface InsertResult<T = DocumentStructure> extends OperationResult {
  /** Number of documents inserted */
  insertedCount: number
  /** IDs of inserted documents */
  insertedIds: string[]
  /** @internal Keeps the generic parameter meaningful for consumers */
  readonly __document?: T
}

/** Result of `explain()` */
export interface ExplainResult {
  /** Whether an index was used */
  usedIndex: boolean
  /** Index key used, when any */
  index?: string
  /** Indexed fields consulted */
  fields?: string[]
  /** Number of index keys read */
  keysScanned: number
  /** Number of documents fetched from storage */
  docsFetched: number
  /** Documents considered by the filter */
  docsExamined: number
  /** Human readable plan */
  plan: string
}

/** Statistics of a collection */
export interface CollectionStats {
  /** Collection name */
  name: string
  /** Number of documents */
  count: number
  /** Bytes written by document files */
  storageSize: number
  /** Bytes of the metadata file */
  metadataSize: number
  /** Number of indexes */
  indexCount: number
  /** Documents currently cached */
  cachedDocuments: number
  /** Format version of the collection on disk */
  formatVersion: number
}

/** Statistics of a database */
export interface DatabaseStats {
  /** Database name */
  name: string
  /** Absolute path of the database directory */
  path: string
  /** Number of collections */
  collectionCount: number
  /** Per collection statistics */
  collections: Record<string, CollectionStats>
}

/** Migration options */
export interface MigrationOptions {
  /** Source format version */
  from: number
  /** Target format version */
  to: number
  /** Copy the tree before migrating
   * @default true
   */
  backup?: boolean
  /** Verify every migrated document (count + checksum)
   * @default true
   */
  verify?: boolean
  /** Progress callback */
  onProgress?: (info: { collection: string, processed: number, total: number }) => void
}

/** Migration report */
export interface MigrationReport {
  /** Format version before the migration */
  from: number
  /** Format version after the migration */
  to: number
  /** Backup directory, when created */
  backupPath?: string
  /** Documents migrated per collection */
  collections: Record<string, number>
  /** Whether verification passed */
  verified: boolean
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Aggregation stages supported by `Collection.aggregate()`
 */
export type AggregationStage =
  | { $match: QueryCriteria }
  | { $project: Record<string, unknown> }
  | { $group: GroupStage }
  | { $sort: SortOptions }
  | { $skip: number }
  | { $limit: number }
  | { $count: string }
  | { $unwind: string }

/** Accumulator used inside `$group` */
export type Accumulator =
  | { $sum: unknown }
  | { $avg: unknown }
  | { $min: unknown }
  | { $max: unknown }
  | { $first: unknown }
  | { $last: unknown }
  | { $push: unknown }
  | { $addToSet: unknown }
  | { $count: Record<string, never> }

/** `$group` stage specification */
export interface GroupStage {
  /** Group key expression */
  _id: unknown
  /** Accumulator per output field */
  [field: string]: Accumulator | unknown
}

/**
 * Schema class interface
 */
export interface SchemaInterface {
  /** Schema definition */
  definition: SchemaDefinition
  /** Schema options */
  options: SchemaOptions
  /** Validates and normalizes a document (synchronous) */
  validate: (document: DocumentStructure) => DocumentStructure
  /** Validates and normalizes a document, awaiting async validators */
  validateAsync: (document: DocumentStructure) => Promise<DocumentStructure>
}

/**
 * Query class interface
 */
export interface QueryInterface {
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
  /** Compiles the criteria into a reusable predicate */
  compile: () => (doc: Record<string, unknown>) => boolean
  /** Sets sort options */
  sort: (sortBy: SortOptions) => Query
  /** Limits the number of results */
  limit: (n: number) => Query
  /** Skips a number of results */
  skip: (n: number) => Query
  /** Selects fields to return */
  select: (fields: SelectFields) => Query
  /** Applies the query to a list of documents */
  execute: (documents: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
}

/** Query builder */
export type Query = Omit<QueryInterface, 'sort' | 'limit' | 'skip' | 'select' | 'criteria'> & {
  criteria: QueryCriteria
  sort: (sortBy: SortOptions) => Query
  limit: (n: number) => Query
  skip: (n: number) => Query
  select: (fields: SelectFields) => Query
}

/**
 * Infers the document type from a schema definition
 */
export type InferSchema<S extends SchemaDefinition> = {
  [K in keyof S]: S[K]['type'] extends 'string'
    ? string
    : S[K]['type'] extends 'number' | 'int'
      ? number
      : S[K]['type'] extends 'boolean'
        ? boolean
        : S[K]['type'] extends 'date'
          ? Date
          : S[K]['type'] extends 'array'
            ? unknown[]
            : S[K]['type'] extends 'object'
              ? Record<string, unknown>
              : unknown
}
