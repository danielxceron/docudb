/**
 * Main database module.
 *
 * Integrates storage, indexes, schema validation and the query engine, and
 * exposes the CRUD interface.
 *
 * Design notes:
 * - The database directory is `<dataDir>/<name>`; `dataDir` is the root.
 * - Collection metadata has constant size and is rewritten atomically. Document
 *   ordering lives in an append-only log (`_order.log`) instead of a persisted
 *   array, which removes the previous O(n) write per insert.
 * - Documents are cached in an LRU and always returned as defensive copies.
 * - Document level operations run under a keyed mutex, acquired *before* the
 *   read, which removes the previous lost-update window.
 */

import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import FileStorage from '../storage/fileStorage.js'
import IndexManager from '../index/indexManager.js'
import Query, { sortDocuments, projectDocuments } from '../query/query.js'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import deepCopy from '../utils/deepCopy.js'
import { documentMutex } from '../utils/mutex.js'
import { isValidID } from '../utils/uuidUtils.js'
import { validatePath } from '../utils/pathValidator.js'
import {
  compareValues,
  getNestedValue,
  setNestedValue,
  unsetNestedValue
} from '../utils/paths.js'
import {
  appendLine,
  ensureDir,
  fileExists,
  readJson,
  readLines,
  removePath,
  writeJsonAtomic
} from '../utils/fileUtils.js'
import { aggregate as runAggregate } from '../aggregation/aggregate.js'
import { migrateDatabase } from '../migrate/migrate.js'
import type {
  AggregationStage,
  CollectionMetadata,
  CollectionOptions,
  CollectionStats,
  DatabaseOptions,
  DatabaseStats,
  Document,
  DocumentInput,
  DocumentStructure,
  ExplainResult,
  FindOptions,
  Filter,
  IdType,
  IndexField,
  IndexOptions,
  Logger,
  MigrationOptions,
  MigrationReport,
  OrderLogEntry,
  QueryCriteria,
  SchemaInterface,
  StorageOptions,
  UpdateOperations,
  WithId,
  UpdateResult,
  IndexDescription
} from '../types/index.js'
import { FORMAT_VERSION } from '../types/index.js'

/** Default schema used by `Schema` imports in consumer code */
type SchemaType = SchemaInterface

/** Default document cache size */
const DEFAULT_CACHE_SIZE = 1000

/** Internal cache entry */
interface CacheEntry {
  document: Document
  paths: string[]
}

/** Bulk operation descriptor */
export type BulkOperation =
  | { insertOne: DocumentStructure }
  | { updateOne: { filter: QueryCriteria, update: UpdateOperations, upsert?: boolean } }
  | { updateMany: { filter: QueryCriteria, update: UpdateOperations } }
  | { deleteOne: { filter: QueryCriteria } }
  | { deleteMany: { filter: QueryCriteria } }
  | { replaceOne: { filter: QueryCriteria, replacement: DocumentStructure, upsert?: boolean } }

/** Aggregated outcome of a bulk write */
export interface BulkWriteResult {
  /** Number of inserted documents */
  insertedCount: number
  /** Number of matched documents */
  matchedCount: number
  /** Number of modified documents */
  modifiedCount: number
  /** Number of deleted documents */
  deletedCount: number
  /** Number of upserted documents */
  upsertedCount: number
  /** Ids of inserted or upserted documents */
  insertedIds: string[]
  /** Whether the operation was acknowledged */
  acknowledged: boolean
}

class Database {
  /** Database name */
  public readonly name: string
  /** Root directory holding every database */
  public readonly rootDir: string
  /** Directory of this database */
  public readonly dataDir: string
  /** Collections of this database */
  public readonly collections: Record<string, Collection<any>>
  /** Resolved storage options */
  public readonly storageOptions: StorageOptions
  /** ID generation type */
  public readonly idType: IdType
  /** File storage instance */
  public readonly storage: FileStorage
  /** Index manager instance */
  public readonly indexManager: IndexManager
  /** Maximum number of cached documents per collection */
  public readonly cacheSize: number
  /** Metadata flush interval in ms */
  public readonly flushInterval: number
  /** Optional logger */
  public readonly logger: Logger | undefined

  /** Collection names in insertion order */
  private readonly order: string[]
  private _initialized: boolean
  private _closed: boolean
  private flushTimer: NodeJS.Timeout | null

  /**
   * Creates a new database instance
   * @param options - Configuration options
   */
  constructor (options: DatabaseOptions = {}) {
    this._initialized = false
    this._closed = false
    this.collections = {}
    this.order = []
    this.flushTimer = null

    this.name = options.name ?? 'docudb'
    this.idType = options.idType ?? 'mongo'
    this.cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE
    this.flushInterval = Math.max(0, options.flushInterval ?? 0)
    this.logger = options.logger

    // `dataDir` is the root directory; the database lives in `<root>/<name>`.
    const rootDir = path.resolve(options.dataDir ?? path.join(process.cwd(), 'data'))
    const validated = validatePath(this.name, rootDir)
    if (validated.safePath === null) {
      throw new DocuDBError(
        `Invalid database name: ${validated.error ?? ''}`,
        MCO_ERROR.DATABASE.INVALID_NAME,
        { name: this.name, rootDir }
      )
    }
    this.rootDir = rootDir
    this.dataDir = validated.safePath

    this.storageOptions = {
      dataDir: this.dataDir,
      chunkSize: options.chunkSize ?? 1024 * 1024,
      compression: options.compression ?? true,
      compressionThreshold: options.compressionThreshold ?? 4096,
      compressionLevel: options.compressionLevel ?? 6
    }

    this.storage = new FileStorage(this.storageOptions)
    this.indexManager = new IndexManager(
      { dataDir: this.dataDir },
      this.flushInterval
    )
    this.setFileLock(options.fileLock === true)
  }

  /** Whether `initialize()` already ran */
  get initialized (): boolean {
    return this._initialized
  }

  /**
   * Initializes the database
   */
  async initialize (): Promise<void> {
    if (this._initialized) return

    try {
      await this._acquireFileLock()
      await ensureDir(this.dataDir)
      await this.storage.initialize()
      await this._checkFormatVersion()
      await this._loadCollections()
      this._initialized = true
      this._ensureFlushTimer()
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.DATABASE.INIT_ERROR, {
        name: this.name,
        dataDir: this.dataDir
      })
    }
  }

  /**
   * Returns (and caches) a collection
   * @param collectionName - Collection name
   * @param options - Collection options
   * @returns The collection instance
   */
  collection<T extends DocumentStructure = DocumentStructure> (
    collectionName: string,
    options: CollectionOptions = {}
  ): Collection<T> {
    this._assertUsable()

    const validated = validatePath(collectionName, this.dataDir)
    if (validated.safePath === null) {
      throw new DocuDBError(
        `Collection name is invalid: ${validated.error ?? ''}`,
        MCO_ERROR.COLLECTION.INVALID_NAME,
        { collectionName }
      )
    }

    const existing = this.collections[collectionName]
    if (existing !== undefined) {
      if (options.schema !== undefined) existing.setSchema(options.schema)
      return existing as unknown as Collection<T>
    }

    const collection = new Collection<T>(collectionName, this, options)
    this.collections[collectionName] = collection
    this.order.push(collectionName)
    return collection
  }

  /** Tells whether a collection exists on disk or in memory */
  async collectionExists (collectionName: string): Promise<boolean> {
    this._assertUsable()
    if (this.collections[collectionName] !== undefined) return true
    return fileExists(path.join(this.dataDir, collectionName))
  }

  /**
   * Drops a collection and everything it owns
   * @param collectionName - Name of the collection to drop
   * @returns true when the collection existed
   */
  async dropCollection (collectionName: string): Promise<boolean> {
    this._assertUsable()

    const collection = this.collections[collectionName]
    if (collection === undefined && !(await fileExists(path.join(this.dataDir, collectionName)))) {
      return false
    }

    try {
      if (collection !== undefined) {
        await collection.drop()
      } else {
        await removePath(path.join(this.dataDir, collectionName))
        await this.indexManager.dropAll(collectionName)
      }

      delete this.collections[collectionName]
      const position = this.order.indexOf(collectionName)
      if (position >= 0) this.order.splice(position, 1)
      return true
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.COLLECTION.DROP_ERROR, {
        collectionName
      })
    }
  }

  /**
   * Renames a collection
   * @param from - Current name
   * @param to - New name
   * @returns true on success
   */
  async renameCollection (from: string, to: string): Promise<boolean> {
    this._assertUsable()
    const validated = validatePath(to, this.dataDir)
    if (validated.safePath === null) {
      throw new DocuDBError(
        `Collection name is invalid: ${validated.error ?? ''}`,
        MCO_ERROR.COLLECTION.INVALID_NAME,
        { collectionName: to }
      )
    }
    if (this.collections[from] === undefined) return false
    if (await fileExists(path.join(this.dataDir, to))) {
      throw new DocuDBError(
        `Collection already exists: ${to}`,
        MCO_ERROR.DATABASE.COLLECTION_ALREADY_EXISTS,
        { collectionName: to }
      )
    }

    try {
      await this.collections[from].close()
      await fs.rename(
        path.join(this.dataDir, from),
        path.join(this.dataDir, to)
      )
      delete this.collections[from]
      const position = this.order.indexOf(from)
      if (position >= 0) this.order[position] = to
      this.collections[to] = new Collection(to, this)
      await this.collections[to].initialize()
      return true
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.COLLECTION.RENAME_ERROR, {
        from,
        to
      })
    }
  }

  /**
   * Lists every collection of the database
   * @returns Collection names
   */
  async listCollections (): Promise<string[]> {
    this._assertUsable()
    return [...this.order]
  }

  /**
   * Returns a database-wide statistics report
   * @returns Statistics
   */
  async stats (): Promise<DatabaseStats> {
    this._assertUsable()
    const collections: Record<string, CollectionStats> = {}
    for (const name of this.order) {
      collections[name] = await this.collections[name].stats()
    }
    return {
      name: this.name,
      path: this.dataDir,
      collectionCount: this.order.length,
      collections
    }
  }

  /**
   * Copies the whole database directory
   * @param target - Destination path (defaults to `<dataDir>-backup`)
   * @returns The destination path
   */
  async backup (target?: string): Promise<string> {
    this._assertUsable()
    await this.flush()
    const destination = path.resolve(target ?? `${this.dataDir}-backup`)
    await removePath(destination)
    await ensureDir(path.dirname(destination))
    await fs.cp(this.dataDir, destination, { recursive: true })
    return destination
  }

  /**
   * Replaces the database content with a previously created backup
   * @param source - Path of the backup
   */
  async restore (source: string): Promise<void> {
    const origin = path.resolve(source)
    if (!(await fileExists(origin))) {
      throw new DocuDBError(
        `Backup not found: ${origin}`,
        MCO_ERROR.DATABASE.INIT_ERROR,
        { source: origin }
      )
    }

    this._assertUsable()
    await this.close()

    const staging = `${this.dataDir}.restoring`
    await removePath(staging)
    await fs.cp(origin, staging, { recursive: true })
    await removePath(this.dataDir)
    await fs.rename(staging, this.dataDir)

    this._initialized = false
    this._closed = false
    for (const name of this.order) delete this.collections[name]
    this.order.length = 0
    await this.initialize()
  }

  /** Writes every pending metadata change */
  async flush (): Promise<void> {
    if (!this._initialized) return
    for (const name of this.order) {
      await this.collections[name].flush()
    }
    await this.indexManager.flush()
  }

  /**
   * Compacts indexes and the order log of every collection
   */
  async compact (): Promise<void> {
    this._assertUsable()
    for (const name of this.order) {
      await this.collections[name].compact()
    }
  }

  /**
   * Migrates the on-disk format
   * @param options - Migration options
   * @returns A migration report
   */
  async migrate (options: MigrationOptions): Promise<MigrationReport> {
    if (this._initialized) await this.close()
    return migrateDatabase({
      dataDir: this.dataDir,
      databaseName: this.name,
      logger: this.logger,
      ...options
    })
  }

  /** Flushes everything and releases resources */
  async close (): Promise<void> {
    if (this._closed) return
    this._closed = true

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    for (const name of this.order) {
      try {
        await this.collections[name].close()
      } catch (error: any) {
        this.logger?.warn?.(`Error closing collection ${name}: ${(error as Error).message}`)
      }
    }
    await this.indexManager.close()
    await this._releaseFileLock()
  }

  /**
   * Loads the collections present on disk
   * @private
   */
  private async _loadCollections (): Promise<void> {
    let entries: Array<{ name: string, isDirectory: () => boolean }>
    try {
      entries = await fs.readdir(this.dataDir, { withFileTypes: true })
    } catch (error: any) {
      if (error.code === 'ENOENT') return
      throw DocuDBError.wrap(error, MCO_ERROR.DATABASE.LOAD_ERROR)
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue

      const collection = new Collection(entry.name, this)
      await collection.initialize()
      this.collections[entry.name] = collection
      this.order.push(entry.name)
    }
  }

  /**
   * Refuses to open a format written by a newer version
   * @private
   */
  private async _checkFormatVersion (): Promise<void> {
    const manifestPath = path.join(this.rootDir, '_format.json')
    const manifest = await readJson<{ formatVersion?: number }>(manifestPath)

    if (manifest === null) {
      // A directory without any collection is brand new: adopt the current
      // format. Otherwise it is v1 data that must be migrated explicitly.
      const entries = await fs.readdir(this.dataDir, { withFileTypes: true })
      const hasCollections = entries.some(
        entry => entry.isDirectory() && !entry.name.startsWith('_')
      )

      if (hasCollections) {
        throw new DocuDBError(
          `The data directory uses format v1. Run db.migrate({ from: 1, to: ${FORMAT_VERSION} }) before opening it.`,
          MCO_ERROR.DATABASE.UNSUPPORTED_FORMAT,
          { formatVersion: 1, supported: FORMAT_VERSION }
        )
      }

      await writeJsonAtomic(manifestPath, {
        formatVersion: FORMAT_VERSION,
        updated: new Date().toISOString()
      })
      return
    }

    const version = manifest.formatVersion ?? 1
    if (version > FORMAT_VERSION) {
      throw new DocuDBError(
        `Unsupported on-disk format version ${version}; this build supports up to ${FORMAT_VERSION}`,
        MCO_ERROR.DATABASE.UNSUPPORTED_FORMAT,
        { formatVersion: version, supported: FORMAT_VERSION }
      )
    }
    if (version < FORMAT_VERSION) {
      throw new DocuDBError(
        `The data directory uses format v${version}. Run db.migrate({ from: ${version}, to: ${FORMAT_VERSION} }) before opening it.`,
        MCO_ERROR.DATABASE.UNSUPPORTED_FORMAT,
        { formatVersion: version, supported: FORMAT_VERSION }
      )
    }
  }

  /**
   * Starts the metadata flush timer when a flush interval is configured
   * @private
   */
  private _ensureFlushTimer (): void {
    if (this.flushInterval <= 0 || this.flushTimer !== null) return
    this.flushTimer = setInterval(() => {
      void this.flush().catch(error => {
        this.logger?.warn?.(`Error flushing metadata: ${(error as Error).message}`)
      })
    }, this.flushInterval)
    this.flushTimer.unref?.()
  }

  /**
   * Acquires the exclusive lock file, when enabled
   * @private
   */
  private async _acquireFileLock (): Promise<void> {
    if (!this._fileLockEnabled) return
    const lockPath = path.join(this.dataDir, '_lock')
    await ensureDir(this.dataDir)

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fs.open(lockPath, 'wx')
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          host: process.env.HOSTNAME ?? 'localhost',
          startedAt: new Date().toISOString()
        }))
        await handle.close()
        return
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error

        const info = await readJson<{ pid?: number, startedAt?: string }>(lockPath)
        if (info?.pid !== undefined && isProcessAlive(info.pid) && attempt === 0) {
          throw new DocuDBError(
            `Another process (pid ${info.pid}) already opened ${this.dataDir}`,
            MCO_ERROR.DATABASE.INIT_ERROR,
            { lockPath, pid: info.pid }
          )
        }
        await removePath(lockPath)
      }
    }
  }

  /**
   * Releases the exclusive lock file
   * @private
   */
  private async _releaseFileLock (): Promise<void> {
    if (!this._fileLockEnabled) return
    await removePath(path.join(this.dataDir, '_lock'))
  }

  /** Whether the exclusive file lock is enabled */
  private _fileLockEnabled: boolean = false

  /**
   * Throws when the database is not initialized or already closed
   * @private
   */
  private _assertUsable (): void {
    if (this._closed) {
      throw new DocuDBError(
        'Database is closed',
        MCO_ERROR.DATABASE.CLOSED,
        { name: this.name }
      )
    }
    if (!this._initialized) {
      throw new DocuDBError(
        'Database not initialized. Call await db.initialize() first.',
        MCO_ERROR.DATABASE.NOT_INITIALIZED,
        { name: this.name }
      )
    }
  }

  /** @internal Enables or disables the file lock (called by the constructor options) */
  setFileLock (enabled: boolean): void {
    this._fileLockEnabled = enabled
  }
}

/**
 * Tells whether a process is still running
 * @param pid - Process id
 * @returns true when the process exists
 */
function isProcessAlive (pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error.code === 'EPERM'
  }
}

export class Collection<T extends DocumentStructure = DocumentStructure> {
  /** Collection name */
  public readonly name: string
  /** Owning database */
  public readonly db: Database
  /** File storage instance */
  public readonly storage: FileStorage
  /** Index manager instance */
  public readonly indexManager: IndexManager
  /** Resolved options */
  public options: CollectionOptions
  /** Schema used to validate documents */
  public schema: SchemaType | null
  /** Collection metadata */
  public metadata: CollectionMetadata

  /** Document cache (LRU by insertion order) */
  private readonly cache: Map<string, CacheEntry>
  /** Maximum number of cached documents */
  private readonly cacheLimit: number
  /** Document ids in insertion order */
  private order: string[]
  /** Ids whose deletion is already reflected in `order` */
  private metadataDirty: boolean
  private orderLoaded: boolean
  private flushTimer: NodeJS.Timeout | null

  /**
   * @param name - Collection name
   * @param database - Owning database
   * @param options - Additional options
   */
  constructor (
    name: string,
    database: Database,
    options: CollectionOptions = {}
  ) {
    this.name = name
    this.db = database
    this.storage = database.storage
    this.indexManager = database.indexManager
    this.options = { ...options }
    this.schema = options.schema ?? null
    this.cache = new Map()
    this.cacheLimit = options.cacheSize ?? database.cacheSize
    this.order = []
    this.metadataDirty = false
    this.orderLoaded = false
    this.flushTimer = null
    this.metadata = {
      count: 0,
      nextSeq: 1,
      indices: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      formatVersion: FORMAT_VERSION
    }
  }

  /** Replaces the schema of the collection */
  setSchema (schema: SchemaType | null): void {
    this.schema = schema
  }

  /** Absolute path of the collection directory */
  get directory (): string {
    return this.storage.collectionPath(this.name)
  }

  /** Absolute path of the collection metadata file */
  get metadataPath (): string {
    return this.storage.metadataPath(this.name)
  }

  /**
   * Initializes the collection: directories, metadata, order log and indexes
   */
  async initialize (): Promise<void> {
    try {
      await this.storage.ensureCollection(this.name)
      await this._loadMetadata()
      await this.indexManager.initialize(this.name)

      for (const definition of this.metadata.indices) {
        const field = definition.field
        if (field === undefined) continue
        await this.indexManager.restore(
          this.name,
          field,
          (definition.options ?? {}) as IndexOptions
        )
      }

      this._ensureFlushTimer()
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.COLLECTION.METADATA_ERROR, {
        collectionName: this.name
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Insert
  // ---------------------------------------------------------------------------

  /**
   * Inserts a document
   * @param doc - Document to insert
   * @returns The inserted document, including its `_id`
   */
  async insertOne (doc: DocumentInput<T>): Promise<WithId<T>> {
    const validated = await this._prepareForInsert(doc)
    const stored = await this._persistInsert(validated)
    await this._commit([{ id: stored.id, document: stored.document }])
    return deepCopy(stored.document) as WithId<T>
  }

  /**
   * Inserts several documents with a single metadata commit
   * @param docs - Documents to insert
   * @param options - `ordered: false` continues after a failure
   * @returns The inserted documents
   */
  async insertMany (
    docs: Array<DocumentInput<T>>,
    options: { ordered?: boolean } = {}
  ): Promise<Array<WithId<T>>> {
    if (!Array.isArray(docs)) {
      throw new DocuDBError(
        'Expected an array of documents',
        MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
      )
    }

    const ordered = options.ordered !== false
    const results: Array<WithId<T>> = []
    const prepared: Array<{ id: string, document: Document }> = []
    const errors: Array<{ index: number, error: unknown }> = []

    for (let index = 0; index < docs.length; index++) {
      try {
        const validated = await this._prepareForInsert(docs[index])
        prepared.push(await this._persistInsert(validated))
      } catch (error) {
        if (ordered) throw error
        errors.push({ index, error })
      }
    }

    await this._commit(prepared)
    for (const entry of prepared) results.push(deepCopy(entry.document) as WithId<T>)

    if (errors.length > 0) {
      this.logger?.warn?.(
        `insertMany skipped ${errors.length} document(s) because of validation errors`
      )
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Finds documents matching a filter
   * @param filter - Query criteria, a `Query` instance or nothing
   * @param options - sort, skip, limit and projection
   * @returns Matching documents
   */
  async find (
    filter: Filter<T> | QueryCriteria | Query = {},
    options: FindOptions<T> = {}
  ): Promise<Array<WithId<T>>> {
    try {
      const query = this._toQuery(filter, options)
      const raw = options.raw === true

      const optimized = await this._findWithOptimization(query, options)
      const results = optimized ?? query.execute(
        await this._loadAllDocuments()
      ) as Document[]

      if (raw) return results as Array<WithId<T>>
      return results.map(doc => deepCopy(doc)) as Array<WithId<T>>
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.DOCUMENT.QUERY_ERROR, {
        collectionName: this.name
      })
    }
  }

  /**
   * Finds the first document matching a filter
   * @param filter - Query criteria
   * @param options - sort and projection
   * @returns The document, or null
   */
  async findOne (
    filter: Filter<T> | QueryCriteria | Query = {},
    options: FindOptions<T> = {}
  ): Promise<WithId<T> | null> {
    const results = await this.find(filter, { ...options, limit: 1 })
    return results.length > 0 ? results[0] : null
  }

  /**
   * Finds a document by id
   * @param id - Document id
   * @returns The document, or null when it does not exist
   */
  async findById (id: string, options: { raw?: boolean } = {}): Promise<WithId<T> | null> {
    this._assertId(id)
    const document = await this._readDocument(id)
    if (document === null) return null
    return (options.raw === true ? document : deepCopy(document)) as WithId<T>
  }

  /**
   * Counts documents matching a filter
   * @param filter - Query criteria; when empty the metadata counter is used
   * @returns Number of matching documents
   */
  async count (filter: Filter<T> | QueryCriteria | Query = {}): Promise<number> {
    return this.countDocuments(filter)
  }

  /**
   * Counts documents matching a filter
   * @param filter - Query criteria
   * @returns Number of matching documents
   */
  async countDocuments (
    filter: Filter<T> | QueryCriteria | Query = {}
  ): Promise<number> {
    if (isEmptyFilter(filter)) return this.metadata.count
    const results = await this.find(filter, { raw: true })
    return results.length
  }

  /** Number of documents according to the metadata counter */
  async estimatedDocumentCount (): Promise<number> {
    return this.metadata.count
  }

  /**
   * Returns the distinct values of a field
   * @param field - Field path
   * @param filter - Optional filter
   * @returns Distinct values
   */
  async distinct (field: string, filter: Filter<T> | QueryCriteria = {}): Promise<unknown[]> {
    const documents = await this.find(filter as Filter<T>, { raw: true })
    const values = new Map<string, unknown>()
    for (const doc of documents) {
      const value = getNestedValue(doc, field)
      if (value === undefined) continue
      const key = typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : `${typeof value}:${String(value)}`
      values.set(key, value)
    }
    return [...values.values()]
  }

  /**
   * Runs an aggregation pipeline
   * @param pipeline - Ordered stages
   * @returns Pipeline output
   */
  async aggregate (pipeline: AggregationStage[]): Promise<Document[]> {
    try {
      const documents = await this._loadAllDocuments()
      const result = runAggregate(documents, pipeline)
      return result.map(doc => deepCopy(doc))
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.DOCUMENT.QUERY_ERROR, {
        collectionName: this.name
      })
    }
  }

  /**
   * Explains how a query would be executed
   * @param filter - Query criteria
   * @param options - sort, skip, limit and projection
   * @returns Execution plan
   */
  async explain (
    filter: Filter<T> | QueryCriteria | Query = {},
    options: FindOptions<T> = {}
  ): Promise<ExplainResult> {
    const query = this._toQuery(filter, options)
    let plan: ExplainResult | null = null

    await this._findWithOptimization(query, options, stats => {
      plan = stats
    })

    return plan ?? {
      usedIndex: false,
      keysScanned: 0,
      docsFetched: this.metadata.count,
      docsExamined: this.metadata.count,
      plan: 'COLLSCAN'
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Replaces a document identified by id
   * @param id - Document id
   * @param update - Update operators or a plain replacement object
   * @returns The updated document, or null when it does not exist
   */
  async updateById (
    id: string,
    update: UpdateOperations
  ): Promise<WithId<T> | null> {
    this._assertId(id)

    return documentMutex.withLock(this._lockKey(id), async () => {
      const existing = await this._readDocument(id)
      if (existing === null) return null

      let updated = this._applyUpdate(existing, update)
      if (this.schema != null) {
        updated = await this.schema.validateAsync(updated) as Document
      }

      await this._writeDocument(id, updated)
      return deepCopy(updated) as WithId<T>
    })
  }

  /**
   * Updates the first document matching a filter
   * @param filter - Query criteria
   * @param update - Update operators
   * @param options - `upsert` creates the document when nothing matches
   * @returns Update result
   */
  async updateOne (
    filter: Filter<T> | QueryCriteria,
    update: UpdateOperations,
    options: { upsert?: boolean } = {}
  ): Promise<UpdateResult<T>> {
    const document = await this.findOne(filter, { raw: true })
    if (document === null) {
      if (options.upsert === true) {
        const inserted = await this.insertOne(
          this._seedFromFilter(filter, update) as DocumentInput<T>
        )
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          document: inserted
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, document: null }
    }

    const updated = await this.updateById(document._id, update)
    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: updated === null ? 0 : 1,
      document: updated
    }
  }

  /**
   * Builds the document to insert on upsert: equality fields of the filter plus
   * the literal values of the update, mirroring MongoDB.
   * @param filter - Query criteria
   * @param update - Update operators
   * @returns The seed document
   * @private
   */
  private _seedFromFilter (
    filter: Filter<T> | QueryCriteria,
    update: UpdateOperations
  ): DocumentStructure {
    const seed: DocumentStructure = {}

    for (const [field, condition] of Object.entries(filter as Record<string, unknown>)) {
      if (field.startsWith('$')) continue
      if (condition === null || typeof condition !== 'object') {
        seed[field] = condition
      }
    }

    for (const operator of ['$set', '$setOnInsert'] as const) {
      const payload = update[operator]
      if (typeof payload !== 'object' || payload === null) continue
      for (const [field, value] of Object.entries(payload)) {
        if (!(field in seed)) seed[field] = value
      }
    }

    return seed
  }

  /**
   * Updates every document matching a filter
   * @param filter - Query criteria
   * @param update - Update operators
   * @returns Update result
   */
  async updateMany (
    filter: Filter<T> | QueryCriteria,
    update: UpdateOperations
  ): Promise<UpdateResult<T>> {
    const documents = await this.find(filter as Filter<T>, { raw: true })
    let modifiedCount = 0

    for (const document of documents) {
      const updated = await this.updateById(document._id, update)
      if (updated !== null) modifiedCount++
    }

    return {
      acknowledged: true,
      matchedCount: documents.length,
      modifiedCount
    }
  }

  /**
   * Replaces the first document matching a filter
   * @param filter - Query criteria
   * @param replacement - Replacement document
   * @param options - `upsert` creates the document when nothing matches
   * @returns Update result
   */
  async replaceOne (
    filter: Filter<T> | QueryCriteria,
    replacement: DocumentStructure,
    options: { upsert?: boolean } = {}
  ): Promise<UpdateResult<T>> {
    const document = await this.findOne(filter, { raw: true })
    if (document === null) {
      if (options.upsert === true) {
        const inserted = await this.insertOne({
          ...replacement,
          _id: (filter as { _id?: string })._id
        } as DocumentInput<T>)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          document: inserted
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, document: null }
    }

    const replacementDoc = deepCopy(replacement) as Record<string, unknown>
    delete replacementDoc._id
    delete replacementDoc._seq

    let final: Document = {
      ...replacementDoc,
      _id: document._id,
      ...(document._seq === undefined ? {} : { _seq: document._seq })
    } as Document

    if (this.schema != null) {
      final = await this.schema.validateAsync(final) as Document
    }
    if (this.options.timestamps === true) {
      final.createdAt ??= document.createdAt
      final.updatedAt = new Date().toISOString()
    }

    await documentMutex.withLock(this._lockKey(document._id), async () => {
      await this._writeDocument(document._id, final)
    })

    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      document: deepCopy(final) as WithId<T>
    }
  }

  /**
   * Atomically finds a document and updates it
   * @param filter - Query criteria
   * @param update - Update operators
   * @param options - `returnDocument: 'before' | 'after'` (default `after`)
   * @returns The document and the update result
   */
  async findOneAndUpdate (
    filter: Filter<T> | QueryCriteria,
    update: UpdateOperations,
    options: { returnDocument?: 'before' | 'after' } = {}
  ): Promise<{ document: WithId<T> | null, result: UpdateResult<T> }> {
    const before = await this.findOne(filter, { raw: true })
    if (before === null) {
      return {
        document: null,
        result: { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
      }
    }

    const after = await this.updateById(before._id, update)
    const result: UpdateResult<T> = {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: after === null ? 0 : 1
    }
    return {
      document: options.returnDocument === 'before'
        ? deepCopy(before)
        : after,
      result
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Deletes a document by id
   * @param id - Document id
   * @returns true when the document existed
   */
  async deleteById (id: string): Promise<boolean> {
    this._assertId(id)

    return documentMutex.withLock(this._lockKey(id), async () => {
      const existing = await this._readDocument(id)
      if (existing === null) return false

      await this.storage.deleteDocument(this.name, id)
      await this.indexManager.removeFromIndices(this.name, id)
      this.cache.delete(id)
      await this._removeFromOrder([id])
      this.metadata.count = Math.max(0, this.metadata.count - 1)
      this.metadata.updated = new Date().toISOString()
      this._markMetadataDirty()
      await this._commit([])
      return true
    })
  }

  /**
   * Deletes the first document matching a filter
   * @param filter - Query criteria
   * @returns true when a document was deleted
   */
  async deleteOne (filter: Filter<T> | QueryCriteria): Promise<boolean> {
    const document = await this.findOne(filter, { raw: true })
    if (document === null) return false
    return this.deleteById(document._id)
  }

  /**
   * Deletes every document matching a filter
   * @param filter - Query criteria
   * @returns Number of deleted documents
   */
  async deleteMany (filter: Filter<T> | QueryCriteria): Promise<number> {
    const documents = await this.find(filter as Filter<T>, { raw: true })
    if (documents.length === 0) return 0

    const ids = documents.map(doc => doc._id)
    for (const id of ids) {
      await documentMutex.withLock(this._lockKey(id), async () => {
        await this.storage.deleteDocument(this.name, id)
        await this.indexManager.removeFromIndices(this.name, id)
        this.cache.delete(id)
      })
    }

    await this._removeFromOrder(ids)
    this.metadata.count = Math.max(0, this.metadata.count - ids.length)
    this.metadata.updated = new Date().toISOString()
    this._markMetadataDirty()
    await this._commit([])
    return ids.length
  }

  /**
   * Finds a document and deletes it atomically
   * @param filter - Query criteria
   * @returns The deleted document, or null
   */
  async findOneAndDelete (
    filter: Filter<T> | QueryCriteria
  ): Promise<WithId<T> | null> {
    const document = await this.findOne(filter, { raw: true })
    if (document === null) return null
    await this.deleteById(document._id)
    return deepCopy(document)
  }

  // ---------------------------------------------------------------------------
  // Bulk
  // ---------------------------------------------------------------------------

  /**
   * Applies a batch of write operations
   * @param operations - Ordered write operations
   * @param options - `ordered: false` continues after a failure
   * @returns Aggregated result
   */
  async bulkWrite (
    operations: BulkOperation[],
    options: { ordered?: boolean } = {}
  ): Promise<BulkWriteResult> {
    if (!Array.isArray(operations)) {
      throw new DocuDBError(
        'bulkWrite expects an array of operations',
        MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
      )
    }

    const ordered = options.ordered !== false
    const result: BulkWriteResult = {
      insertedCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      upsertedCount: 0,
      insertedIds: [],
      acknowledged: true
    }

    for (const operation of operations) {
      try {
        if ('insertOne' in operation) {
          const inserted = await this.insertOne(operation.insertOne as DocumentInput<T>)
          result.insertedCount++
          result.insertedIds.push(inserted._id)
        } else if ('updateOne' in operation) {
          const { filter, update, upsert } = operation.updateOne
          const outcome = await this.updateOne(filter as Filter<T>, update, { upsert })
          result.matchedCount += outcome.matchedCount
          result.modifiedCount += outcome.modifiedCount
          if (outcome.document != null && outcome.matchedCount === 0) {
            result.upsertedCount++
            result.insertedIds.push(outcome.document._id)
          }
        } else if ('updateMany' in operation) {
          const { filter, update } = operation.updateMany
          const outcome = await this.updateMany(filter as Filter<T>, update)
          result.matchedCount += outcome.matchedCount
          result.modifiedCount += outcome.modifiedCount
        } else if ('deleteOne' in operation) {
          if (await this.deleteOne(operation.deleteOne.filter as Filter<T>)) {
            result.deletedCount++
          }
        } else if ('deleteMany' in operation) {
          result.deletedCount += await this.deleteMany(operation.deleteMany.filter as Filter<T>)
        } else if ('replaceOne' in operation) {
          const { filter, replacement, upsert } = operation.replaceOne
          const outcome = await this.replaceOne(
            filter as Filter<T>,
            replacement,
            { upsert }
          )
          result.matchedCount += outcome.matchedCount
          result.modifiedCount += outcome.modifiedCount
        } else {
          throw new DocuDBError(
            'Unknown bulk operation',
            MCO_ERROR.DOCUMENT.BULK_ERROR
          )
        }
      } catch (error) {
        if (ordered) {
          throw DocuDBError.wrap(error, MCO_ERROR.DOCUMENT.BULK_ERROR, {
            collectionName: this.name
          })
        }
        this.logger?.warn?.(
          `bulkWrite skipped an operation: ${(error as Error).message}`
        )
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  /**
   * Creates an index
   * @param field - Field or fields to index
   * @param options - Index options
   * @returns true when the index is available
   */
  async createIndex (
    field: IndexField,
    options: IndexOptions = {}
  ): Promise<boolean> {
    try {
      const existed = this.indexManager.hasIndex(this.name, normalizeField(field))
      await this.indexManager.createIndex(this.name, field, options)

      if (!existed) {
        const documents = await this._loadAllDocuments()
        await this.indexManager.rebuild(this.name, field, documents)
        this._registerIndex(field, options)
        await this._commit([])
      }

      return true
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.CREATE_ERROR, {
        collectionName: this.name,
        field
      })
    }
  }

  /**
   * Creates several indexes
   * @param definitions - Index definitions
   * @returns Number of indexes created
   */
  async createIndexes (
    definitions: Array<{ field: IndexField, options?: IndexOptions }>
  ): Promise<number> {
    let created = 0
    for (const definition of definitions) {
      const already = this.indexManager.hasIndex(this.name, normalizeField(definition.field))
      await this.createIndex(definition.field, definition.options ?? {})
      if (!already) created++
    }
    return created
  }

  /** Lists the indexes of the collection */
  async listIndexes (): Promise<IndexDescription[]> {
    return this.indexManager.listIndexedFields(this.name).map(fields => {
      const view = this.indexManager.indices[`${this.name}:${fields.join('+')}`]
      return {
        field: fields.length === 1 ? fields[0] : [...fields],
        fields: [...fields],
        unique: view?.unique ?? false,
        sparse: view?.sparse ?? false,
        name: view?.metadata?.name ?? `idx_${fields.join('_')}`
      }
    })
  }

  /**
   * Drops an index
   * @param field - Indexed field or fields
   * @returns true when an index was removed
   */
  async dropIndex (field: IndexField): Promise<boolean> {
    try {
      const removed = await this.indexManager.dropIndex(this.name, field)
      this.metadata.indices = this.metadata.indices.filter(
        definition => !sameField(definition.field, field)
      )
      this.metadata.updated = new Date().toISOString()
      this._markMetadataDirty()
      await this._commit([])
      return removed
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.DROP_ERROR, {
        collectionName: this.name,
        field
      })
    }
  }

  /** Drops every index of the collection */
  async dropIndexes (): Promise<void> {
    for (const fields of this.indexManager.listIndexedFields(this.name)) {
      await this.dropIndex(fields.length === 1 ? fields[0] : fields)
    }
  }

  // ---------------------------------------------------------------------------
  // Ordering (legacy API, kept for backwards compatibility)
  // ---------------------------------------------------------------------------

  /**
   * Position of a document in the collection order
   * @param id - Document id
   * @returns Zero based position, or -1 when not found
   * @deprecated Positions are only meaningful for schemaless "list" usage.
   */
  async getPosition (id: string): Promise<number> {
    if (typeof id !== 'string' || !isValidID(id)) {
      throw new DocuDBError(
        'Invalid ID: must be a valid MongoDB ObjectId or UUID v4',
        MCO_ERROR.DOCUMENT.INVALID_ID,
        { id }
      )
    }
    await this._loadOrder()
    return this.order.indexOf(id)
  }

  /**
   * Document at a given position
   * @param position - Zero based position
   * @returns The document, or null when out of range
   * @deprecated Positions are only meaningful for schemaless "list" usage.
   */
  async findByPosition (position: number): Promise<WithId<T> | null> {
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
      throw new DocuDBError(
        'Invalid Position: must be a non-negative number',
        MCO_ERROR.DOCUMENT.INVALID_DOCUMENT,
        { position }
      )
    }
    await this._loadOrder()
    const id = this.order[position]
    if (id === undefined) return null
    return this.findById(id)
  }

  /**
   * Moves a document inside the collection order
   * @param id - Document id
   * @param newIndex - Target position (clamped to the end)
   * @returns true when the document exists
   * @deprecated Positions are only meaningful for schemaless "list" usage.
   */
  async updatePosition (id: string, newIndex: number): Promise<boolean> {
    if (typeof id !== 'string') {
      throw new DocuDBError('Invalid ID', MCO_ERROR.DOCUMENT.INVALID_DOCUMENT, { id })
    }
    if (typeof newIndex !== 'number' || !Number.isInteger(newIndex) || newIndex < 0) {
      throw new DocuDBError(
        'Invalid index: must be a non-negative number',
        MCO_ERROR.DOCUMENT.INVALID_DOCUMENT,
        { newIndex }
      )
    }

    await this._loadOrder()
    const current = this.order.indexOf(id)
    if (current === -1) return false

    const target = Math.min(newIndex, this.order.length - 1)
    if (current === target) return true

    this.order.splice(current, 1)
    this.order.splice(target, 0, id)
    await this._appendOrderLog({ o: [...this.order] })
    this.metadata.updated = new Date().toISOString()
    this._markMetadataDirty()
    await this._commit([])
    return true
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  /**
   * Statistics of the collection
   * @returns Statistics
   */
  async stats (): Promise<CollectionStats> {
    const metadataSize = await fileSize(this.metadataPath)
    return {
      name: this.name,
      count: this.metadata.count,
      storageSize: await this.storage.collectionSize(this.name),
      metadataSize,
      indexCount: this.indexManager.countIndexes(this.name),
      cachedDocuments: this.cache.size,
      formatVersion: this.metadata.formatVersion
    }
  }

  /**
   * Compacts the order log and the index snapshots
   */
  async compact (): Promise<void> {
    await this._loadOrder()
    await this._appendOrderLog({ o: [...this.order] })
    await this._trimOrderLog()
    await this.indexManager.flush()
  }

  /** Removes the collection and every file it owns */
  async drop (): Promise<void> {
    try {
      this._stopFlushTimer()
      await this.indexManager.dropAll(this.name)
      await this.storage.dropCollection(this.name)
      this.cache.clear()
      this.order = []
      this.orderLoaded = false
      this.metadata = {
        count: 0,
        nextSeq: 1,
        indices: [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        formatVersion: FORMAT_VERSION
      }
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.COLLECTION.DROP_ERROR, {
        collectionName: this.name
      })
    }
  }

  /** Writes pending metadata and index changes */
  async flush (): Promise<void> {
    if (this.metadataDirty) {
      this.metadata.updated = new Date().toISOString()
      await writeJsonAtomic(this.metadataPath, this.metadata)
      this.metadataDirty = false
    }
    await this.indexManager.flush(this.name)
  }

  /** Flushes pending changes */
  async close (): Promise<void> {
    this._stopFlushTimer()
    await this.flush()
  }

  // ---------------------------------------------------------------------------
  // Internals: insert
  // ---------------------------------------------------------------------------

  /**
   * Validates a document and resolves its id
   * @param doc - Candidate document
   * @returns The validated document with an `_id`
   * @private
   */
  private async _prepareForInsert (doc: DocumentInput<T>): Promise<Document> {
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      throw new DocuDBError(
        'Document must be an object',
        MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
      )
    }

    let validated: DocumentStructure = doc
    if (this.schema != null) {
      validated = await this.schema.validateAsync({ ...doc })
    }

    const candidate = validated as Document
    if (candidate._id === undefined) {
      candidate._id = this._generateId()
    } else {
      this._assertId(candidate._id, this.schema)
    }

    if (candidate._seq === undefined) {
      candidate._seq = this.metadata.nextSeq++
    }

    if (this.options.timestamps === true) {
      const now = new Date().toISOString()
      candidate.createdAt ??= now
      candidate.updatedAt = now
    }

    return candidate
  }

  /**
   * Writes a validated document to disk and updates the indexes
   * @param document - Validated document
   * @returns The stored id and document
   * @private
   */
  private async _persistInsert (
    document: Document
  ): Promise<{ id: string, document: Document }> {
    const id = document._id

    if (this.cache.has(id) || await this.storage.hasDocument(this.name, id)) {
      throw new DocuDBError(
        `Duplicate document _id: ${id}`,
        MCO_ERROR.DOCUMENT.DUPLICATE_ID,
        { collectionName: this.name, id }
      )
    }

    await this._writeDocument(id, document)
    return { id, document }
  }

  /**
   * Writes a document, updating the indexes and rolling back on failure
   * @param id - Document id
   * @param document - Document to persist
   * @private
   */
  private async _writeDocument (id: string, document: Document): Promise<void> {
    const stored = await this.storage.writeDocument(this.name, id, document)

    try {
      await this.indexManager.updateIndex(this.name, id, document)
    } catch (error) {
      // Keep the collection consistent: the index rejected the document, so
      // the file must not stay behind.
      await this.storage.deleteDocument(this.name, id)
      await this.indexManager.removeFromIndices(this.name, id)
      throw error
    }

    this._cache(id, document, stored.paths)
    this.metadata.updated = new Date().toISOString()
    this._markMetadataDirty()

    if (this.db.flushInterval <= 0) await this.flush()
  }

  /**
   * Commits inserted documents: order log, counter and metadata
   * @param inserted - Documents inserted by the current operation
   * @private
   */
  private async _commit (
    inserted: Array<{ id: string, document: Document }>
  ): Promise<void> {
    if (inserted.length > 0) {
      await this._loadOrder()
      for (const entry of inserted) {
        this.order.push(entry.id)
        await this._appendOrderLog({ s: entry.document._seq as number, i: entry.id })
      }
      this.metadata.count += inserted.length
      this._markMetadataDirty()
    }

    if (this.db.flushInterval > 0) return
    await this.flush()
  }

  // ---------------------------------------------------------------------------
  // Internals: read
  // ---------------------------------------------------------------------------

  /**
   * Reads a document from the cache or from disk
   * @param id - Document id
   * @returns The document, or null
   * @private
   */
  private async _readDocument (id: string): Promise<Document | null> {
    const cached = this.cache.get(id)
    if (cached !== undefined) {
      // Refresh the LRU position.
      this.cache.delete(id)
      this.cache.set(id, cached)
      return cached.document
    }

    const document = await this.storage.readDocument(this.name, id)
    if (document === null) return null

    const paths = await this.storage.resolveDocumentPaths(this.name, id)
    this._cache(id, document, paths)
    return document
  }

  /**
   * Stores a document in the LRU cache
   * @param id - Document id
   * @param document - Document
   * @param paths - Files holding the document
   * @private
   */
  private _cache (id: string, document: Document, paths: string[]): void {
    this.cache.delete(id)
    this.cache.set(id, { document, paths })

    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) break
      this.cache.delete(oldest.value)
    }
  }

  /**
   * Loads every document of the collection, in insertion order
   * @returns Documents, using cache references
   * @private
   */
  private async _loadAllDocuments (): Promise<Document[]> {
    await this._loadOrder()

    const ids = await this.storage.listDocumentIds(this.name)
    const known = new Set(this.order)
    const documents: Document[] = []
    const seen = new Set<string>()

    for (const id of this.order) {
      if (seen.has(id)) continue
      const document = await this._readDocument(id)
      if (document === null) continue
      seen.add(id)
      documents.push(document)
    }

    // Documents written outside the order log (or by a migration) come last.
    for (const id of ids) {
      if (seen.has(id) || known.has(id)) continue
      const document = await this._readDocument(id)
      if (document === null) continue
      seen.add(id)
      documents.push(document)
    }

    return documents
  }

  /**
   * Answers a query through an index when possible
   * @param query - Compiled query
   * @param options - Find options
   * @param onStats - Receives the execution plan
   * @returns Documents, or null when the index cannot answer the query
   * @private
   */
  private async _findWithOptimization (
    query: Query,
    options: FindOptions<T>,
    onStats?: (stats: ExplainResult) => void
  ): Promise<Document[] | null> {
    const criteria = query.criteria as Record<string, unknown>
    const predicate = query.compile()

    for (const [field, condition] of Object.entries(criteria)) {
      if (field.startsWith('$')) continue

      const lookup = this.indexManager.lookup(this.name, field, condition)
      if (lookup === null) continue

      if (lookup.ids.length === 0) {
        onStats?.({
          usedIndex: true,
          index: lookup.indexKey,
          fields: [field],
          keysScanned: lookup.keysScanned,
          docsFetched: 0,
          docsExamined: 0,
          plan: `IXSCAN ${lookup.indexKey} (empty)`
        })
        return []
      }

      const candidates: Document[] = []
      for (const id of lookup.ids) {
        const document = await this._readDocument(id)
        if (document === null) continue
        if (!predicate(document)) continue
        candidates.push(document)
      }

      let results = candidates
      const sortOptions = options.sort ?? query.sortOptions
      if (sortOptions != null) results = sortDocuments(results, sortOptions)

      const skip = options.skip ?? query.skipValue
      if (skip > 0) results = results.slice(skip)

      const limit = options.limit ?? query.limitValue
      if (limit !== null && limit !== undefined) results = results.slice(0, limit)

      const projection = options.projection ?? query.selectFields
      if (projection != null) {
        results = projectDocuments(results, projection)
      }

      onStats?.({
        usedIndex: true,
        index: lookup.indexKey,
        fields: [field],
        keysScanned: lookup.keysScanned,
        docsFetched: candidates.length,
        docsExamined: lookup.ids.length,
        plan: `IXSCAN ${lookup.indexKey}`
      })

      return results
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Internals: update operators
  // ---------------------------------------------------------------------------

  /**
   * Applies update operators to a document
   * @param doc - Original document
   * @param update - Update operators or a replacement object
   * @returns The updated document
   * @private
   */
  private _applyUpdate (doc: Document, update: UpdateOperations): Document {
    if (typeof update !== 'object' || update === null) {
      throw new DocuDBError(
        'Update must be an object',
        MCO_ERROR.DOCUMENT.UPDATE_ERROR
      )
    }

    const result = deepCopy(doc)
    const operators = Object.keys(update).filter(key => key.startsWith('$'))

    for (const operator of operators) {
      if (!VALID_UPDATE_OPERATORS.has(operator)) {
        throw new DocuDBError(
          `Invalid update operator: ${operator}`,
          MCO_ERROR.DOCUMENT.UPDATE_ERROR,
          { operator }
        )
      }
    }

    if (operators.length === 0) {
      const id = result._id
      for (const key of Object.keys(update)) delete result[key]
      Object.assign(result, deepCopy(update as Record<string, unknown>))
      result._id = id
      return result
    }

    for (const operator of operators) {
      const payload = update[operator] as Record<string, unknown>
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new DocuDBError(
          `The ${operator} operator expects an object`,
          MCO_ERROR.DOCUMENT.UPDATE_ERROR,
          { operator }
        )
      }
      for (const [path, value] of Object.entries(payload)) {
        this._applyUpdateOperator(result, operator, path, value)
      }
    }

    if (this.options.timestamps === true) {
      result.updatedAt = new Date().toISOString()
    }

    return result
  }

  /**
   * Applies a single update operator to a single field
   * @param target - Document being updated
   * @param operator - Operator name
   * @param path - Field path
   * @param value - Operator operand
   * @private
   */
  private _applyUpdateOperator (
    target: Document,
    operator: string,
    path: string,
    value: unknown
  ): void {
    switch (operator) {
      case '$set':
        setNestedValue(target, path, deepCopy(value))
        return

      case '$unset':
        unsetNestedValue(target, path)
        return

      case '$inc': {
        const current = getNestedValue(target, path)
        const base = current === undefined || current === null ? 0 : current
        if (typeof base !== 'number' || typeof value !== 'number') {
          throw new DocuDBError(
            `Cannot increment a non-numeric value: ${path}`,
            MCO_ERROR.DOCUMENT.INVALID_TYPE,
            { field: path, value: current }
          )
        }
        setNestedValue(target, path, base + value)
        return
      }

      case '$mul': {
        const current = getNestedValue(target, path)
        const base = current === undefined || current === null ? 0 : current
        if (typeof base !== 'number' || typeof value !== 'number') {
          throw new DocuDBError(
            `Cannot multiply a non-numeric value: ${path}`,
            MCO_ERROR.DOCUMENT.INVALID_TYPE,
            { field: path, value: current }
          )
        }
        setNestedValue(target, path, base * value)
        return
      }

      case '$min': {
        const current = getNestedValue(target, path)
        if (current === undefined || compareValues(value, current) < 0) {
          setNestedValue(target, path, deepCopy(value))
        }
        return
      }

      case '$max': {
        const current = getNestedValue(target, path)
        if (current === undefined || compareValues(value, current) > 0) {
          setNestedValue(target, path, deepCopy(value))
        }
        return
      }

      case '$push': {
        const current = getNestedValue(target, path)
        const list = Array.isArray(current) ? [...current] : []
        const spec = value as { $each?: unknown[], $slice?: number, $position?: number }
        if (spec !== null && typeof spec === 'object' && !Array.isArray(spec) && '$each' in spec) {
          const items = (spec.$each as unknown[]).map(item => deepCopy(item))
          const position = spec.$position ?? list.length
          list.splice(position, 0, ...items)
          if (typeof spec.$slice === 'number') {
            const sliced = spec.$slice >= 0
              ? list.slice(0, spec.$slice)
              : list.slice(spec.$slice)
            list.length = 0
            list.push(...sliced)
          }
        } else {
          list.push(deepCopy(value))
        }
        setNestedValue(target, path, list)
        return
      }

      case '$addToSet': {
        const current = getNestedValue(target, path)
        const list = Array.isArray(current) ? [...current] : []
        const spec = value as { $each?: unknown[] }
        const items = spec !== null && typeof spec === 'object' && !Array.isArray(spec) && '$each' in spec
          ? (spec.$each as unknown[])
          : [value]
        for (const item of items) {
          const copy = deepCopy(item)
          if (!list.some(entry => deepEqual(entry, copy))) list.push(copy)
        }
        setNestedValue(target, path, list)
        return
      }

      case '$pull': {
        const current = getNestedValue(target, path)
        if (!Array.isArray(current)) return
        const predicate = compilePullPredicate(value)
        setNestedValue(target, path, current.filter(item => !predicate(item)))
        return
      }

      case '$pop': {
        const current = getNestedValue(target, path)
        if (!Array.isArray(current) || current.length === 0) return
        const list = [...current]
        if (value === -1) list.pop()
        else list.shift()
        setNestedValue(target, path, list)
        return
      }

      default:
        throw new DocuDBError(
          `Invalid update operator: ${operator}`,
          MCO_ERROR.DOCUMENT.UPDATE_ERROR,
          { operator }
        )
    }
  }

  // ---------------------------------------------------------------------------
  // Internals: metadata and ordering
  // ---------------------------------------------------------------------------

  /**
   * Loads the collection metadata, migrating a v1 metadata file when needed
   * @private
   */
  private async _loadMetadata (): Promise<void> {
    const stored = await readJson<Partial<CollectionMetadata> & { documentOrder?: string[] }>(
      this.metadataPath
    )

    if (stored === null) {
      this.metadata = {
        count: 0,
        nextSeq: 1,
        indices: [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        formatVersion: FORMAT_VERSION
      }
      await writeJsonAtomic(this.metadataPath, this.metadata)
      await writeJsonAtomic(
        path.join(this.db.rootDir, '_format.json'),
        { formatVersion: FORMAT_VERSION, updated: new Date().toISOString() }
      )
      return
    }

    const legacyOrder = Array.isArray(stored.documentOrder) ? stored.documentOrder : null

    this.metadata = {
      count: stored.count ?? 0,
      nextSeq: stored.nextSeq ?? 1,
      indices: Array.isArray(stored.indices) ? stored.indices : [],
      created: stored.created ?? new Date().toISOString(),
      updated: stored.updated ?? new Date().toISOString(),
      formatVersion: FORMAT_VERSION
    }

    // A v1 metadata file (with `documentOrder`) is only readable through the
    // migration path; keep the order so nothing is lost.
    if (legacyOrder !== null) {
      this.order = [...legacyOrder]
      this.orderLoaded = true
    }
  }

  /**
   * Marks the metadata as needing a write
   * @private
   */
  private _markMetadataDirty (): void {
    this.metadataDirty = true
  }

  /**
   * Replays the append-only order log
   * @private
   */
  private async _loadOrder (): Promise<void> {
    if (this.orderLoaded) return
    this.orderLoaded = true
    this.order = []

    const entries = await readLines<OrderLogEntry>(this.storage.orderLogPath(this.name))
    const deleted = new Set<string>()
    const reordered: string[][] = []

    for (const entry of entries) {
      if ('s' in entry) {
        if (typeof entry.i === 'string') this.order.push(entry.i)
      } else if ('d' in entry) {
        if (typeof entry.d === 'string') deleted.add(entry.d)
      } else if ('o' in entry && Array.isArray(entry.o)) {
        reordered.push(entry.o)
      }
    }

    if (reordered.length > 0) {
      this.order = [...reordered[reordered.length - 1]]
    } else {
      this.order = this.order.filter(id => !deleted.has(id))
    }
  }

  /**
   * Appends an entry to the order log
   * @param entry - Log entry
   * @private
   */
  private async _appendOrderLog (entry: OrderLogEntry): Promise<void> {
    await appendLine(this.storage.orderLogPath(this.name), JSON.stringify(entry))
  }

  /**
   * Rewrites the order log with a single snapshot entry
   * @private
   */
  private async _trimOrderLog (): Promise<void> {
    const logPath = this.storage.orderLogPath(this.name)
    await removePath(logPath)
    await this._appendOrderLog({ o: [...this.order] })
  }

  /**
   * Removes ids from the in-memory order and records the removal
   * @param ids - Ids to remove
   * @private
   */
  private async _removeFromOrder (ids: string[]): Promise<void> {
    if (this.order.length === 0 || ids.length === 0) return
    const removal = new Set(ids)
    this.order = this.order.filter(id => !removal.has(id))
    await this._appendOrderLog({ o: [...this.order] })
  }

  /**
   * Records an index in the metadata
   * @param field - Indexed field(s)
   * @param options - Index options
   * @private
   */
  private _registerIndex (field: IndexField, options: IndexOptions): void {
    if (this.metadata.indices.some(definition => sameField(definition.field, field))) {
      return
    }
    this.metadata.indices.push({
      field,
      options: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        name: options.name ?? `idx_${Array.isArray(field) ? field.join('_') : field}`,
        unique: options.unique === true,
        sparse: options.sparse === true
      }
    })
    this.metadata.updated = new Date().toISOString()
    this._markMetadataDirty()
  }

  /**
   * Starts the metadata flush timer
   * @private
   */
  private _ensureFlushTimer (): void {
    if (this.db.flushInterval <= 0 || this.flushTimer !== null) return
    this.flushTimer = setInterval(() => {
      void this.flush().catch(error => {
        this.db.logger?.warn?.(
          `Error flushing ${this.name}: ${(error as Error).message}`
        )
      })
    }, this.db.flushInterval)
    this.flushTimer.unref?.()
  }

  /** Stops the metadata flush timer */
  private _stopFlushTimer (): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  // ---------------------------------------------------------------------------
  // Internals: helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds a `Query` from a filter and a set of options
   * @param filter - Filter, criteria or `Query` instance
   * @param options - Find options
   * @returns The query
   * @private
   */
  private _toQuery (
    filter: Filter<T> | QueryCriteria | Query,
    options: FindOptions<T>
  ): Query {
    const query = filter instanceof Query ? filter : new Query(filter as QueryCriteria)

    if (options.sort !== undefined) query.sort(options.sort)
    if (options.skip !== undefined) query.skip(options.skip)
    if (options.limit !== undefined) query.limit(options.limit)
    if (options.projection !== undefined) query.select(options.projection as never)

    return query
  }

  /**
   * Validates a document id unless the schema defines its own format
   * @param id - Candidate id
   * @param schema - Schema owning a custom `_id` rule
   * @private
   */
  private _assertId (id: unknown, schema: SchemaType | null = this.schema): void {
    if (typeof id !== 'string') {
      throw new DocuDBError(
        'Invalid document ID format. Must be a valid MongoDB ID or UUID v4',
        MCO_ERROR.DOCUMENT.INVALID_ID,
        { id }
      )
    }

    const customPattern = schema?.definition?._id?.validate?.pattern
    if (customPattern !== undefined) return
    if (!isValidID(id)) {
      throw new DocuDBError(
        'Invalid document ID format. Must be a valid MongoDB ID or UUID v4',
        MCO_ERROR.DOCUMENT.INVALID_ID,
        { id }
      )
    }
  }

  /** Generates a new document id */
  private _generateId (): string {
    if (this.options.idType === 'uuid') return crypto.randomUUID()
    return crypto.randomBytes(12).toString('hex')
  }

  /** Lock key of a document, scoped to this database */
  private _lockKey (id: string): string {
    return `${this.db.name}:${this.name}:${id}`
  }

  /** Logger accessor */
  private get logger (): Logger | undefined {
    return this.db.logger
  }
}

/** Update operators accepted by `updateById` */
const VALID_UPDATE_OPERATORS = new Set([
  '$set', '$unset', '$inc', '$mul', '$min', '$max',
  '$push', '$addToSet', '$pull', '$pop', '$rename', '$setOnInsert'
])

/**
 * Tells whether two `field` definitions refer to the same index
 * @param a - First definition
 * @param b - Second definition
 * @returns true when they match
 */
function sameField (a: IndexField | undefined, b: IndexField): boolean {
  if (a === undefined) return false
  const left = Array.isArray(a) ? a.join('+') : a
  const right = Array.isArray(b) ? b.join('+') : b
  return left === right
}

/**
 * Normalizes the first field of an index definition
 * @param field - Field or fields
 * @returns First field
 */
function normalizeField (field: IndexField): string {
  return Array.isArray(field) ? field[0] : field
}

/**
 * Tells whether a filter matches everything
 * @param filter - Filter to inspect
 * @returns true when the filter is empty
 */
function isEmptyFilter (filter: unknown): boolean {
  if (filter == null) return true
  if (filter instanceof Query) {
    return Object.keys(filter.criteria).length === 0
  }
  if (typeof filter !== 'object') return false
  return Object.keys(filter as Record<string, unknown>).length === 0
}

/**
 * Structural equality used by `$addToSet`
 * @param a - First value
 * @param b - Second value
 * @returns true when both values are equivalent
 */
function deepEqual (a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (
    a !== null && b !== null &&
    typeof a === 'object' && typeof b === 'object'
  ) {
    const keysA = Object.keys(a as Record<string, unknown>)
    const keysB = Object.keys(b as Record<string, unknown>)
    return keysA.length === keysB.length &&
      keysA.every(key => deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      ))
  }
  return false
}

/**
 * Builds the predicate used by `$pull`
 * @param value - Operand
 * @returns Predicate
 */
function compilePullPredicate (value: unknown): (item: unknown) => boolean {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 0 && entries.every(([, operand]) => typeof operand === 'object' && operand !== null && !Array.isArray(operand))) {
      const fields = entries.map(([field]) => field)
      const expected = entries.map(([, operand]) =>
        (operand as Record<string, unknown>).$eq
      )
      return item => fields.every((field, position) =>
        deepEqual((item as Record<string, unknown>)?.[field], expected[position])
      )
    }
    return item => deepEqual(item, value)
  }
  return item => deepEqual(item, value)
}

/**
 * Size of a file, zero when missing
 * @param filePath - File to measure
 * @returns Size in bytes
 */
async function fileSize (filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath)
    return stats.size
  } catch {
    return 0
  }
}

export default Database
