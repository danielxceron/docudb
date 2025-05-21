/**
 * Main database module
 * Integrates all components and provides the CRUD interface
 */

import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import crypto from 'node:crypto'

import FileStorage from '../storage/fileStorage.js'
import IndexManager from '../index/indexManager.js'
import Query from '../query/query.js'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import { fileExists } from '../utils/fileUtils.js'
import deepCopy from '../utils/deepCopy.js'
import { isValidID } from '../utils/uuidUtils.js'
import {
  DatabaseOptions,
  StorageOptions,
  CollectionOptions,
  CollectionMetadata,
  Document,
  UpdateOperations,
  DocumentLocks,
  DocumentWithId,
  Schema,
  IndexOptions
} from '../types/index.js'

const mkdirPromise = promisify(fs.mkdir)
const readFilePromise = promisify(fs.readFile)
const writeFilePromise = promisify(fs.writeFile)

class Database {
  /** Database name */
  public name: string
  /** Directory to store data */
  public dataDir: string
  /** Collections in this database */
  public collections: Record<string, any>
  /** Storage options */
  public storageOptions: StorageOptions
  /** ID generation type */
  public idType: 'mongo' | 'uuid'
  /** File storage instance */
  public storage: FileStorage
  /** Index manager instance */
  public indexManager: IndexManager

  /**
   * Creates a new database instance
   * @param options - Configuration options
   */
  constructor (options: DatabaseOptions = {}) {
    this.name = options.name || 'docudb'
    this.dataDir = path.join(
      options.dataDir || process.cwd(),
      'data',
      this.name
    )
    this.collections = {}

    // Storage options
    this.storageOptions = {
      dataDir: this.dataDir,
      chunkSize: options.chunkSize || 1024 * 1024, // 1MB default
      compression: options.compression !== false
    }

    // ID generation options
    this.idType = options.idType || 'mongo' // 'mongo' or 'uuid'

    this.storage = new FileStorage(this.storageOptions)
    this.indexManager = new IndexManager({ dataDir: this.dataDir })
  }

  /**
   * Initializes the database
   * @returns {Promise<void>}
   */
  async initialize () {
    try {
      // Validate that database name is valid for a directory
      if (
        this.name.includes('/') ||
        this.name.includes('\\') ||
        this.name.includes(':')
      ) {
        throw new DocuDBError(
          'Invalid database name: contains characters not allowed for directories',
          MCO_ERROR.DATABASE.INIT_ERROR
        )
      }

      // Create data directory if it doesn't exist
      if (!(await fileExists(this.dataDir))) {
        try {
          await mkdirPromise(this.dataDir, { recursive: true })
        } catch (dirError: any) {
          throw new DocuDBError(
            `Error creating data directory: ${dirError.message}`,
            MCO_ERROR.DATABASE.INIT_ERROR,
            { originalError: dirError }
          )
        }
      }

      // Initialize storage
      await this.storage.initialize()

      // Load existing collections metadata
      await this._loadCollections()
    } catch (error: any) {
      throw new DocuDBError(
        `Error initializing database: ${error.message}`,
        MCO_ERROR.DATABASE.INIT_ERROR,
        { originalError: error }
      )
    }
  }

  /**
   * Gets a collection
   * @param {string} collectionName - Collection name
   * @param {Object} options - Collection options
   * @returns {Collection} - Collection instance
   */
  collection (
    collectionName: string,
    options: CollectionOptions = { idType: this.idType }
  ): Collection {
    if (!collectionName || typeof collectionName !== 'string') {
      throw new DocuDBError(
        'Collection name must be a valid string',
        MCO_ERROR.COLLECTION.INVALID_NAME
      )
    }

    // If collection doesn't exist, create it
    if (!this.collections[collectionName]) {
      // Pass database idType to collection if not specified in options
      const collectionOptions = {
        ...options,
        idType: options.idType
      }

      this.collections[collectionName] = new Collection(
        collectionName,
        this.storage,
        this.indexManager,
        collectionOptions
      )
    }

    return this.collections[collectionName]
  }

  /**
   * Drops a collection
   * @param {string} collectionName - Name of collection to drop
   * @returns {Promise<boolean>} - true if successfully dropped
   */
  async dropCollection (collectionName: string): Promise<boolean> {
    try {
      if (!this.collections[collectionName]) {
        return false
      }

      try {
        // Delete all documents and metadata
        await this.collections[collectionName].drop()
      } catch (dropError: any) {
        // Ignore errors if directory doesn't exist
        if (!dropError.message.includes('ENOENT')) {
          throw dropError
        }
      }

      // Delete collection directory
      const collectionDir = path.join(this.dataDir, collectionName)
      if (await fileExists(collectionDir)) {
        await fs.promises.rm(collectionDir, { recursive: true, force: true })
      }

      // Remove from collections list
      delete this.collections[collectionName]

      return true
    } catch (error: any) {
      throw new DocuDBError(
        `Error dropping collection: ${error.message}`,
        MCO_ERROR.COLLECTION.DROP_ERROR,
        { collectionName, originalError: error }
      )
    }
  }

  /**
   * Lists all collections
   * @returns {Promise<string[]>} - Collection names
   */
  async listCollections (): Promise<string[]> {
    try {
      return Object.keys(this.collections)
    } catch (error: any) {
      throw new DocuDBError(
        `Error listing collections: ${error.message}`,
        MCO_ERROR.DATABASE.COLLECTION_ERROR,
        { originalError: error }
      )
    }
  }

  /**
   * Loads existing collections
   * @private
   */
  async _loadCollections (): Promise<void> {
    try {
      // Read directories in data directory
      const items = await promisify(fs.readdir)(this.dataDir, {
        withFileTypes: true
      })

      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('_')) {
          const collectionName = item.name

          // Create collection instance
          this.collections[collectionName] = new Collection(
            collectionName,
            this.storage,
            this.indexManager
          )

          // Initialize collection
          await this.collections[collectionName].initialize()
        }
      }
    } catch (error: any) {
      throw new DocuDBError(
        `Error loading collections: ${error.message}`,
        MCO_ERROR.DATABASE.LOAD_ERROR,
        { originalError: error }
      )
    }
  }
}

export class Collection {
  name: string
  storage: FileStorage
  indexManager: IndexManager
  options: CollectionOptions
  schema: Schema | null
  documents: Record<string, Document>
  metadataPath: string
  metadata: CollectionMetadata
  /**
   * @param {string} name - Collection name
   * @param {FileStorage} storage - Storage instance
   * @param {IndexManager} indexManager - Index manager instance
   * @param {Object} options - Additional options
   */
  constructor (
    name: string,
    storage: FileStorage,
    indexManager: IndexManager,
    options: CollectionOptions = { idType: 'mongo' }
  ) {
    this.name = name
    this.storage = storage
    this.indexManager = indexManager
    this.options = options
    this.schema = options.schema != null ? options.schema : null
    this.documents = {} // Document cache
    this.metadataPath = path.join(storage.dataDir, name, '_metadata.json')
    this.metadata = {
      count: 0,
      indices: [],
      created: new Date(),
      updated: new Date(),
      documentOrder: []
    }
  }

  /**
   * Initializes the collection
   * @returns {Promise<void>}
   */
  async initialize () {
    try {
      // Create collection directory if it doesn't exist
      await this.storage._ensureCollectionDir(this.name)

      // Load metadata if exists
      await this._loadMetadata()

      // Initialize index manager
      await this.indexManager.initialize(this.name)

      // Create indices defined in metadata
      for (const indexDef of this.metadata.indices) {
        await this.indexManager.createIndex(
          this.name,
          indexDef.field || '',
          indexDef.options
        )
      }
    } catch (error: any) {
      throw new DocuDBError(
        `Error initializing collection: ${error.message}`,
        MCO_ERROR.COLLECTION.METADATA_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Inserts a document into the collection
   * @param {Document} doc - Document to insert
   * @returns {Promise<DocumentWithId>} - Inserted document with ID
   */
  async insertOne (doc: Document): Promise<DocumentWithId> {
    try {
      if (!doc || typeof doc !== 'object') {
        throw new DocuDBError(
          'Document must be an object',
          MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
        )
      }

      // Validate schema if exists
      let validatedDoc = doc
      if (this.schema != null) {
        validatedDoc = this.schema.validate(doc)
      }

      // Generate ID if it doesn't exist
      if (!validatedDoc._id) {
        validatedDoc._id = this._generateId()
      } else {
        // Check if we have a schema with custom ID validation
        let skipDefaultIdValidation = false
        if (
          (this.schema != null) &&
          this.schema.definition._id &&
          (this.schema.definition._id.validate != null) &&
          (this.schema.definition._id.validate.pattern != null)
        ) {
          // If we have a schema with pattern validation for _id, we'll let the schema handle it
          // The schema validation has already run at this point
          skipDefaultIdValidation = true
        }

        // Validate ID format if provided and not using custom schema validation
        if (!skipDefaultIdValidation) {
          if (!isValidID(validatedDoc._id)) {
            throw new DocuDBError(
              'Invalid document ID format. Must be a valid MongoDB ID or UUID v4',
              MCO_ERROR.DOCUMENT.INVALID_ID,
              { id: validatedDoc._id }
            )
          }
        }
      }

      // Save document
      const docId = validatedDoc._id
      const chunkPaths = await this.storage.saveData(
        path.join(this.name, docId),
        validatedDoc
      )

      // Update metadata
      this.documents[docId] = {
        _id: docId,
        data: validatedDoc,
        chunkPaths
      }

      this.metadata.count++
      this.metadata.updated = new Date()

      // Add document ID to the order array
      if (!this.metadata.documentOrder) {
        this.metadata.documentOrder = []
      }
      this.metadata.documentOrder.push(docId)

      await this._saveMetadata()

      // Update indices
      await this.indexManager.updateIndex(
        this.name,
        docId,
        validatedDoc as DocumentWithId
      )

      return validatedDoc as DocumentWithId
    } catch (error: any) {
      throw new DocuDBError(
        `Error inserting document: ${error.message}`,
        MCO_ERROR.DOCUMENT.INSERT_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Inserts multiple documents into the collection
   * @param {Object[]} docs - Documents to insert
   * @returns {Promise<Object[]>} - Inserted documents with IDs
   */
  async insertMany (docs: Document[]): Promise<DocumentWithId[]> {
    try {
      if (!Array.isArray(docs)) {
        throw new DocuDBError(
          'Expected an array of documents',
          MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
        )
      }

      const results = []

      for (const doc of docs) {
        const result = await this.insertOne(doc)
        results.push(result)
      }

      return results
    } catch (error: any) {
      throw new DocuDBError(
        `Error inserting documents: ${error.message}`,
        MCO_ERROR.DOCUMENT.INSERT_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Finds a document by its ID
   * @param {string} id - Document ID
   * @returns {Promise<Object|null>} - Found document or null
   */
  async findById (id: string): Promise<DocumentWithId | null> {
    try {
      // Check if we have a schema with custom ID validation
      let skipDefaultIdValidation = false
      if (
        (this.schema != null) &&
        this.schema.definition._id &&
        (this.schema.definition._id.validate != null) &&
        (this.schema.definition._id.validate.pattern != null)
      ) {
        // If we have a schema with pattern validation for _id, we'll skip the default validation
        skipDefaultIdValidation = true
      }

      // Validate ID format if not using custom schema validation
      if (!skipDefaultIdValidation) {
        if (!id || typeof id !== 'string' || !isValidID(id)) {
          throw new DocuDBError(
            'Invalid document ID format. Must be a valid MongoDB ID or UUID v4',
            MCO_ERROR.DOCUMENT.INVALID_ID,
            { id }
          )
        }
      } else if (!id || typeof id !== 'string') {
        throw new DocuDBError(
          'Invalid document ID format',
          MCO_ERROR.DOCUMENT.INVALID_ID,
          { id }
        )
      }

      // Check if in cache
      if (this.documents[id] && this.documents[id].data) {
        return this.documents[id].data
      }

      // Build chunks path
      const docDir = path.join(this.name, id)
      const docDirPath = path.join(this.storage.dataDir, docDir)

      // Check if exists
      if (!(await fileExists(docDirPath))) {
        return null
      }

      // Read chunk files
      const files = await promisify(fs.readdir)(docDirPath)
      const chunkPaths = files
        .filter(f => f.startsWith('chunk_'))
        .map(f => path.join(docDirPath, f))
        .sort((a, b) => {
          const numA = parseInt(a.match(/chunk_(\d+)/)?.[1] ?? '0')
          const numB = parseInt(b.match(/chunk_(\d+)/)?.[1] ?? '0')
          return numA - numB
        })

      if (chunkPaths.length === 0) {
        return null
      }

      // Read data
      const doc = await this.storage.readData(chunkPaths)

      // Update cache
      this.documents[id] = {
        _id: id,
        data: doc,
        chunkPaths
      }

      return doc
    } catch (error: any) {
      throw new DocuDBError(
        `Error finding document: ${error.message}`,
        MCO_ERROR.DOCUMENT.NOT_FOUND,
        { collectionName: this.name, id, originalError: error }
      )
    }
  }

  /**
   * Finds documents matching criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Document[]>} - Found documents
   */
  async find (criteria = {}): Promise<DocumentWithId[]> {
    try {
      const query = criteria instanceof Query ? criteria : new Query(criteria)
      // Try to use indices to optimize search
      const results = await this._findWithOptimization(query)

      if (results !== null) {
        return results
      }

      // If optimization not possible, load all documents and filter
      const allDocs = await this._loadAllDocuments()
      return query.execute(allDocs)
    } catch (error: any) {
      throw new DocuDBError(
        `Error in query: ${error.message}`,
        MCO_ERROR.DOCUMENT.QUERY_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Finds one document matching criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object|null>} - Found document or null
   */
  async findOne (criteria = {}): Promise<DocumentWithId | null> {
    try {
      const results = await this.find(criteria)
      return results.length > 0 ? results[0] : null
    } catch (error: any) {
      throw new DocuDBError(
        `Error in query: ${error.message}`,
        MCO_ERROR.DOCUMENT.QUERY_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Updates a document by its ID
   * @param {string} id - Document ID
   * @param {Object} update - Changes to apply
   * @returns {Promise<DocumentWithId|null>} - Updated document or null
   */
  async updateById (
    id: string,
    update: UpdateOperations
  ): Promise<DocumentWithId | null> {
    try {
      // Check if we have a schema with custom ID validation
      let skipDefaultIdValidation = false
      if (
        (this.schema != null) &&
        this.schema.definition._id &&
        (this.schema.definition._id.validate != null) &&
        (this.schema.definition._id.validate.pattern != null)
      ) {
        // If we have a schema with pattern validation for _id, we'll skip the default validation
        skipDefaultIdValidation = true
      }

      // Validate ID format if not using custom schema validation
      if (!skipDefaultIdValidation) {
        if (!id || typeof id !== 'string' || !isValidID(id)) {
          throw new DocuDBError(
            'Invalid document ID format. Must be a valid MongoDB ID or UUID v4',
            MCO_ERROR.DOCUMENT.INVALID_ID,
            { id }
          )
        }
      } else if (!id || typeof id !== 'string') {
        throw new DocuDBError(
          'Invalid document ID format',
          MCO_ERROR.DOCUMENT.INVALID_ID,
          { id }
        )
      }

      // Find document
      const doc = await this.findById(id)
      if (doc == null) {
        return null
      }

      // Validate update operators
      if (update && typeof update === 'object') {
        const validOperators = [
          '$set',
          '$unset',
          '$inc',
          '$push',
          '$pull',
          '$addToSet'
        ]
        const operators = Object.keys(update).filter(key => key.startsWith('$'))

        for (const op of operators) {
          if (!validOperators.includes(op)) {
            throw new DocuDBError(
              `Invalid update operator: ${op}`,
              MCO_ERROR.DOCUMENT.UPDATE_ERROR
            )
          }
        }
      }

      // Apply updates
      const updatedDoc = this._applyUpdate(doc, update)

      // Validate schema if exists
      if (this.schema != null) {
        this.schema.validate(updatedDoc)
      }

      // Implement locking mechanism for concurrent operations
      const lockKey = `${this.name}:${id}:lock`
      // Create global object for locks if it doesn't exist
      if (!('_documentLocks' in global)) {
        ;(global as any)._documentLocks = {} as DocumentLocks
      }

      // Wait if document is locked (with retry)
      let retries = 0
      const maxRetries = 10
      const retryDelay = 50 // ms

      while ((global as any)._documentLocks[lockKey] && retries < maxRetries) {
        await new Promise(resolve =>
          setTimeout(resolve, retryDelay * (1 + Math.random()))
        )
        retries++
      }

      // If still locked after several attempts, throw error
      if ((global as any)._documentLocks[lockKey]) {
        throw new DocuDBError(
          `Document locked after ${maxRetries} attempts: ${id}`,
          MCO_ERROR.DOCUMENT.LOCK_ERROR
        )
      }

      // Set lock
      ;(global as any)._documentLocks[lockKey] = true

      try {
        // Save updated document
        const chunkPaths = await this.storage.saveData(
          path.join(this.name, id),
          updatedDoc
        )

        // Delete old chunks if different
        if (
          this.documents[id] &&
          JSON.stringify(this.documents[id].chunkPaths) !==
            JSON.stringify(chunkPaths)
        ) {
          await this.storage.deleteChunks(this.documents[id].chunkPaths)
        }

        // Update cache
        this.documents[id] = {
          _id: id,
          data: updatedDoc,
          chunkPaths
        }

        // Update metadata
        this.metadata.updated = new Date()
        await this._saveMetadata()

        // Update indices
        await this.indexManager.updateIndex(this.name, id, updatedDoc)
      } finally {
        // Release lock
        delete (global as any)._documentLocks[lockKey]
      }

      return updatedDoc
    } catch (error: any) {
      throw new DocuDBError(
        `Error updating document: ${error.message}`,
        MCO_ERROR.DOCUMENT.UPDATE_ERROR,
        { collectionName: this.name, id, originalError: error }
      )
    }
  }

  /**
   * Updates documents matching criteria
   * @param {Object} criteria - Search criteria
   * @param {Object} update - Changes to apply
   * @returns {Promise<number>} - Number of documents updated
   */
  async updateMany (
    criteria: object,
    update: UpdateOperations
  ): Promise<number> {
    try {
      // Find matching documents
      const docs = await this.find(criteria)
      let count = 0

      // Update each document
      for (const doc of docs) {
        const result = await this.updateById(doc._id, update)
        if (result != null) count++
      }

      return count
    } catch (error: any) {
      throw new DocuDBError(
        `Error updating documents: ${error.message}`,
        MCO_ERROR.DOCUMENT.UPDATE_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Deletes a document by its ID
   * @param {string} id - Document ID
   * @returns {Promise<boolean>} - true if successfully deleted
   */
  async deleteById (id: string): Promise<boolean> {
    try {
      // Check if we have a schema with custom ID validation
      let skipDefaultIdValidation = false
      if (
        (this.schema != null) &&
        this.schema.definition._id &&
        (this.schema.definition._id.validate != null) &&
        (this.schema.definition._id.validate.pattern != null)
      ) {
        // If we have a schema with pattern validation for _id, we'll skip the default validation
        skipDefaultIdValidation = true
      }

      // Validate ID format if not using custom schema validation
      if (!skipDefaultIdValidation) {
        if (!id || typeof id !== 'string' || !isValidID(id)) {
          throw new DocuDBError(
            'Invalid document ID format. Must be a valid MongoDB ID or UUID v4',
            MCO_ERROR.DOCUMENT.INVALID_ID,
            { id }
          )
        }
      } else if (!id || typeof id !== 'string') {
        throw new DocuDBError(
          'Invalid document ID format',
          MCO_ERROR.DOCUMENT.INVALID_ID,
          { id }
        )
      }

      // Check if exists
      if ((await this.findById(id)) == null) {
        return false
      }

      // Delete chunks
      if (this.documents[id] && this.documents[id].chunkPaths) {
        await this.storage.deleteChunks(this.documents[id].chunkPaths)
      }

      // Delete document directory
      const docDir = path.join(this.storage.dataDir, this.name, id)
      if (await fileExists(docDir)) {
        await promisify(fs.rm)(docDir, { recursive: true })
      }

      // Remove from indices
      await this.indexManager.removeFromIndices(this.name, id)

      // Remove from cache
      delete this.documents[id]

      // Update metadata
      this.metadata.count = Math.max(0, this.metadata.count - 1)
      this.metadata.updated = new Date()

      // Remove document ID from the order array
      if (
        this.metadata.documentOrder &&
        Array.isArray(this.metadata.documentOrder)
      ) {
        this.metadata.documentOrder = this.metadata.documentOrder.filter(
          docId => docId !== id
        )
      }

      await this._saveMetadata()

      return true
    } catch (error: any) {
      throw new DocuDBError(
        `Error deleting document: ${error.message}`,
        MCO_ERROR.DOCUMENT.DELETE_ERROR,
        { collectionName: this.name, id, originalError: error }
      )
    }
  }

  /**
   * Deletes documents matching criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<number>} - Number of documents deleted
   */
  async deleteMany (criteria: object): Promise<number> {
    try {
      // Find matching documents
      const docs = await this.find(criteria)
      let count = 0

      // Delete each document
      for (const doc of docs) {
        const result = await this.deleteById(doc._id)
        if (result) count++
      }

      return count
    } catch (error: any) {
      throw new DocuDBError(
        `Error deleting documents: ${error.message}`,
        MCO_ERROR.DOCUMENT.DELETE_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Counts documents matching criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<number>} - Number of documents
   */
  async count (criteria = {}): Promise<number> {
    try {
      if (Object.keys(criteria).length === 0) {
        // If no criteria, return metadata counter
        return this.metadata.count
      }

      // If criteria exists, count matching documents
      const docs = await this.find(criteria)
      return docs.length
    } catch (error: any) {
      throw new DocuDBError(
        `Error counting documents: ${error.message}`,
        MCO_ERROR.DOCUMENT.QUERY_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Creates an index for a field
   * @param {string} field - Field to index
   * @param {Object} options - Index options
   * @returns {Promise<boolean>} - true if successfully created
   */
  async createIndex (
    field: string | string[],
    options: object = {}
  ): Promise<boolean> {
    try {
      // Create index
      await this.indexManager.createIndex(this.name, field, options)

      // Update metadata
      if (!this.metadata.indices.some(idx => idx.field === field)) {
        this.metadata.indices.push({ field, options })
        this.metadata.updated = new Date()
        await this._saveMetadata()
      }

      // Index existing documents
      const allDocs = await this._loadAllDocuments()
      for (const doc of allDocs) {
        await this.indexManager.updateIndex(this.name, doc._id, doc)
      }

      return true
    } catch (error: any) {
      throw new DocuDBError(
        `Error creating index: ${error.message}`,
        MCO_ERROR.INDEX.CREATE_ERROR,
        { collectionName: this.name, field, originalError: error }
      )
    }
  }

  /**
   * List all the indices in the collection
   * @returns {Promise<IndexOptions[]>} - List of indices
   */
  async listIndexes (): Promise<IndexOptions[]> {
    try {
      const indices = []
      for (const key in this.indexManager.indices) {
        if (key.startsWith(`${this.name}:`)) {
          const field = key.split(':')[1]
          const index = this.indexManager.indices[key]
          indices.push({
            field,
            unique: index.unique || false,
            sparse: index.sparse || false,
            ...index.metadata
          })
        }
      }
      return indices
    } catch (error: any) {
      throw new DocuDBError(
        `Error listing indexes: ${error.message}`,
        MCO_ERROR.INDEX.CREATE_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Drops an index
   * @param {string} field - Indexed field
   * @returns {Promise<boolean>} - true if successfully dropped
   */
  async dropIndex (field: string): Promise<boolean> {
    try {
      await this.indexManager.dropIndex(this.name, field)

      this.metadata.indices = this.metadata.indices.filter(
        idx => idx.field !== field
      )
      this.metadata.updated = new Date()
      await this._saveMetadata()

      return true
    } catch (error: any) {
      throw new DocuDBError(
        `Error deleting index: ${error.message}`,
        MCO_ERROR.INDEX.DROP_ERROR,
        { collectionName: this.name, field, originalError: error }
      )
    }
  }

  /**
   * Gets the index of a document by its ID in the collection
   * @param {string} id - Document ID
   * @returns {Promise<number>} - Index of the document or -1 if not found
   */
  async getPosition (id: string): Promise<number> {
    try {
      if (!id || typeof id !== 'string') {
        throw new DocuDBError('Invalid ID', MCO_ERROR.DOCUMENT.INVALID_DOCUMENT)
      }

      // Validate that ID has correct format (24 hexadecimal characters)
      const hexPattern = /^[0-9a-f]{24}$/
      if (!hexPattern.test(id)) {
        throw new DocuDBError(
          'Invalid ID: must be a 24-character hexadecimal string',
          MCO_ERROR.DOCUMENT.INVALID_ID
        )
      }

      // Check if document exists
      const doc = await this.findById(id)
      if (doc == null) {
        return -1
      }

      // Load all documents to get their order
      const allDocs = await this._loadAllDocuments()

      // Find the index of the document with the given ID
      const index = allDocs.findIndex(doc => doc._id === id)

      return index
    } catch (error: any) {
      throw new DocuDBError(
        `Error finding document index: ${error.message}`,
        MCO_ERROR.DOCUMENT.QUERY_ERROR,
        { collectionName: this.name, id, originalError: error }
      )
    }
  }

  /**
   * Finds a document by its index in the collection
   * @param {number} position - Index of the document in the collection
   * @returns {Promise<Object|null>} - Document at the specified index or null if not found
   */
  async findByPosition (position: number): Promise<DocumentWithId | null> {
    try {
      if (typeof position !== 'number' || position < 0) {
        throw new DocuDBError(
          'Invalid Position: must be a non-negative number',
          MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
        )
      }

      // Load all documents to get their order
      const allDocs = await this._loadAllDocuments()

      // Check if index is within bounds
      if (position >= allDocs.length) {
        return null
      }

      // Return the document at the specified index
      return allDocs[position]
    } catch (error: any) {
      throw new DocuDBError(
        `Error finding document by index: ${error.message}`,
        MCO_ERROR.DOCUMENT.QUERY_ERROR,
        { collectionName: this.name, index: position, originalError: error }
      )
    }
  }

  /**
   * Updates the position of a document in the collection
   * @param {string} id - Document ID
   * @param {number} newIndex - New index position for the document
   * @returns {Promise<boolean>} - true if successfully updated, false if document not found
   */
  async updatePosition (id: string, newIndex: number): Promise<boolean> {
    try {
      if (!id || typeof id !== 'string') {
        throw new DocuDBError('Invalid ID', MCO_ERROR.DOCUMENT.INVALID_DOCUMENT)
      }

      if (typeof newIndex !== 'number' || newIndex < 0) {
        throw new DocuDBError(
          'Invalid index: must be a non-negative number',
          MCO_ERROR.DOCUMENT.INVALID_DOCUMENT
        )
      }

      // Find the document
      const doc = await this.findById(id)
      if (doc == null) {
        return false
      }

      // Load all documents to get their order
      const allDocs = await this._loadAllDocuments()

      // Find current index
      const currentIndex = allDocs.findIndex(doc => doc._id === id)
      if (currentIndex === -1) {
        return false
      }

      // If new index is out of bounds, adjust it to the last position
      const adjustedNewIndex = Math.min(newIndex, allDocs.length - 1)

      // If the index is the same, no need to update
      if (currentIndex === adjustedNewIndex) {
        return true
      }

      // Remove the document from its current position
      const docToMove = allDocs.splice(currentIndex, 1)[0]

      // Insert it at the new position
      allDocs.splice(adjustedNewIndex, 0, docToMove)

      // Save the order of the IDs in the metadata
      this.metadata.documentOrder = allDocs.map(doc => doc._id)
      await this._saveMetadata()

      // Update the document cache to reflect the new order
      this.documents = {}
      for (const doc of allDocs) {
        // Reload documents in the cache to maintain consistency
        await this.findById(doc._id)
      }

      return true
    } catch (error: any) {
      throw new DocuDBError(
        `Error updating document index: ${error.message}`,
        MCO_ERROR.DOCUMENT.UPDATE_ERROR,
        { collectionName: this.name, id, newIndex, originalError: error }
      )
    }
  }

  /**
   * Removes the collection
   * @returns {Promise<void>}
   */
  async drop () {
    try {
      const allDocs = await this._loadAllDocuments()

      for (const doc of allDocs) {
        await this.deleteById(doc._id)
      }

      const collectionDir = path.join(this.storage.dataDir, this.name)
      if (await fileExists(collectionDir)) {
        await promisify(fs.rm)(collectionDir, { recursive: true })
      }

      this.documents = {}
      this.metadata.count = 0
    } catch (error: any) {
      throw new DocuDBError(
        `Error deleting collection: ${error.message}`,
        MCO_ERROR.COLLECTION.DROP_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Loads the collection metadata
   * @private
   */
  async _loadMetadata () {
    try {
      if (await fileExists(this.metadataPath)) {
        const data = await readFilePromise(this.metadataPath, 'utf8')
        this.metadata = JSON.parse(data)
      } else {
        await this._saveMetadata()
      }
    } catch (error: any) {
      throw new DocuDBError(
        `Error loading metadata: ${error.message}`,
        MCO_ERROR.COLLECTION.METADATA_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Stores the collection's metadata
   * @private
   */
  async _saveMetadata () {
    try {
      await writeFilePromise(
        this.metadataPath,
        JSON.stringify(this.metadata, null, 2)
      )
    } catch (error: any) {
      throw new DocuDBError(
        `Error saving metadata: ${error.message}`,
        MCO_ERROR.COLLECTION.METADATA_ERROR,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Generates a unique ID
   * @returns {string} - Generated ID
   * @private
   */
  _generateId (): string {
    // Check if UUID format is specified in options
    if (this.options.idType === 'uuid') {
      // Use crypto.randomUUID() for UUID v4 generation
      return crypto.randomUUID()
    }
    // Default to MongoDB-style ID (12 bytes hex)
    return crypto.randomBytes(12).toString('hex')
  }

  /**
   * Applies an update to a document
   * @param {Object} doc - Original document
   * @param {Object} update - Changes to apply
   * @returns {Object} - Updated document
   * @private
   */
  _applyUpdate (doc: DocumentWithId, update: UpdateOperations): DocumentWithId {
    const result = deepCopy(doc)

    if (update.$set == null && update.$unset == null && update.$inc == null) {
      const id = result._id
      Object.assign(result, update)
      result._id = id
      return result
    }

    if (update.$set != null) {
      for (const [key, value] of Object.entries(update.$set)) {
        this._setNestedValue(result, key, value)
      }
    }

    if (update.$unset != null) {
      for (const key of Object.keys(update.$unset)) {
        this._unsetNestedValue(result, key)
      }
    }

    if (update.$inc != null) {
      for (const [key, value] of Object.entries(update.$inc)) {
        const currentValue = this._getNestedValue(result, key) || 0
        if (typeof currentValue !== 'number') {
          throw new DocuDBError(
            `Cannot increment a non-numeric value: ${key}`,
            MCO_ERROR.DOCUMENT.INVALID_TYPE,
            { field: key, value: currentValue }
          )
        }
        this._setNestedValue(result, key, currentValue + value)
      }
    }

    return result
  }

  /**
   * Sets a nested value in an object
   * @param {Object} obj - Object to modify
   * @param {string} path - Path to the value using dot notation
   * @param {*} value - Value to set
   * @private
   */
  _setNestedValue (obj: any, path: string, value: any) {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined) {
        current[part] = {}
      } else if (typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part]
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Removes a nested value from an object
   * @param {Object} obj - Object to modify
   * @param {string} path - Path to the value using dot notation
   * @private
   */
  _unsetNestedValue (obj: any, path: string) {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined || typeof current[part] !== 'object') {
        return
      }
      current = current[part]
    }

    delete current[parts[parts.length - 1]]
  }

  /**
   * Gets a nested value from an object
   * @param {Object} obj - Object to get the value from
   * @param {string} path - Path to the value using dot notation
   * @returns {*} - Found or undefined value
   * @private
   */
  _getNestedValue (obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== 'object'
      ) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  /**
   * Loads all documents in the collection
   * @returns {Promise<DocumentWithId[]>} - All documents
   * @private
   */
  async _loadAllDocuments (): Promise<DocumentWithId[]> {
    try {
      const collectionDir = path.join(this.storage.dataDir, this.name)
      const items = await promisify(fs.readdir)(collectionDir, {
        withFileTypes: true
      })
      const docs: DocumentWithId[] = []
      const documentMap: Record<string, DocumentWithId> = {}

      // First load all documents into a map
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('_')) {
          const docId = item.name
          const doc: DocumentWithId | null = await this.findById(docId)
          if (doc != null) {
            documentMap[docId] = doc
          }
        }
      }

      // If there's a defined order in metadata, use it to order the documents
      if (
        this.metadata.documentOrder &&
        Array.isArray(this.metadata.documentOrder)
      ) {
        // Add documents in the specified order
        for (const docId of this.metadata.documentOrder) {
          if (documentMap[docId]) {
            docs.push(documentMap[docId])
            delete documentMap[docId] // Remove to avoid duplication
          }
        }

        // Add any document that's not in the order (new documents)
        for (const docId in documentMap) {
          docs.push(documentMap[docId])
        }
      } else {
        // If there's no defined order, use the default order
        for (const docId in documentMap) {
          docs.push(documentMap[docId])
        }
      }

      return docs
    } catch (error: any) {
      throw new DocuDBError(
        `Error uploading documents: ${error.message}`,
        MCO_ERROR.DOCUMENT.NOT_FOUND,
        { collectionName: this.name, originalError: error }
      )
    }
  }

  /**
   * Attempts to optimize a query using indexes
   * @param {Query} query - Query to optimize
   * @returns {Promise<DocumentWithId[]|null>} - Results or null if the optimization failed
   * @private
   */
  async _findWithOptimization (query: Query): Promise<DocumentWithId[] | null> {
    for (const field in query.criteria) {
      if (this.indexManager.hasIndex(this.name, field)) {
        const value = query.criteria[field]

        if (typeof value !== 'object' || value === null) {
          const docIds = this.indexManager.findByIndex(this.name, field, value)
          if (docIds != null && docIds.length > 0) {
            const docs = []
            for (const id of docIds) {
              const doc = await this.findById(id)
              if (doc != null && query.matches(doc)) {
                docs.push(doc)
              }
            }
            return query.execute(docs)
          }
        }
      }
    }

    return null
  }
}

export default Database
