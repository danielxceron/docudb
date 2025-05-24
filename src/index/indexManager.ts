/**
 * Indexing Module
 * Handles the creation and use of indexes to optimize searches
 */

import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileExists } from '../utils/fileUtils.js'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'

import { IndexManagerOptions, IndexOptions, Metadata, DocumentWithId } from '../types/index.js'

const readFilePromise = promisify(fs.readFile)
const writeFilePromise = promisify(fs.writeFile)
const mkdirPromise = promisify(fs.mkdir)

interface Index {
  field: string | string[]
  isCompound: boolean
  unique: boolean
  sparse: boolean
  entries: {
    [key: string]: string[]
  }
  metadata: {
    created: Date
    updated: Date
    name: string
    [key: string]: any
  }
}
interface Indices {
  [key: string]: Index
}

class IndexManager {
  indices: Indices
  dataDir: string
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.dataDir - Directory to store data
   */
  constructor (options: IndexManagerOptions = { dataDir: './data' }) {
    this.dataDir = options.dataDir
    this.indices = {} // Stores indices in memory
  }

  /**
   * Initializes the index manager
   * @param {string} collectionName - Collection name
   */
  async initialize (collectionName: string): Promise<void> {
    try {
      const indexDir = this._getIndexDir(collectionName)
      const exists = await fileExists(indexDir)

      if (!exists) {
        await mkdirPromise(indexDir, { recursive: true })
      }

      // Load existing indices
      await this._loadIndices(collectionName)
    } catch (error: any) {
      throw new DocuDBError(`Error initializing indices: ${(error as Error).message}`, MCO_ERROR.INDEX.INIT_ERROR, {
        collectionName,
        originalError: error
      })
    }
  }

  /**
   * Creates an index for a specific field
   * @param {string} collectionName - Collection name
   * @param {string} field - Field to index
   * @param {IndexOptions} options - Index options
   * @returns {Promise<void>}
   */
  async createIndex (collectionName: string, field: string | string[], options: IndexOptions = {}): Promise<boolean> {
    try {
      // Handle compound indices (array of fields)
      const isCompound = Array.isArray(field)
      const indexKey = isCompound
        ? `${collectionName}:${field.join('+')}`
        : `${collectionName}:${field}`

      if (this.indices[indexKey] !== undefined) {
        return true // Index already exists
      }

      // Ensure index directory exists
      const indexDir = this._getIndexDir(collectionName)
      if (!(await fileExists(indexDir))) {
        await mkdirPromise(indexDir, { recursive: true })
      }

      // Create empty index structure
      this.indices[indexKey] = {
        field,
        isCompound,
        unique: options.unique === true,
        sparse: options.sparse === true,
        entries: {}, // Map of values to document IDs
        metadata: {
          created: new Date(),
          updated: new Date(),
          name:
            options.name ??
            (isCompound ? `idx_${field.join('_')}` : `idx_${field}`),
          ...options
        }
      }

      // Save index to disk
      await this._saveIndex(
        collectionName,
        isCompound ? field.join('+') : field
      )
      return true
    } catch (error: any) {
      throw new DocuDBError(`Error creating index: ${(error as Error).message}`, MCO_ERROR.INDEX.CREATE_ERROR, {
        collectionName,
        field,
        options,
        originalError: error
      })
    }
  }

  /**
   * Removes an index
   * @param {string} collectionName - Collection name
   * @param {string} field - Indexed field
   * @returns {Promise<void>}
   */
  async dropIndex (collectionName: string, field: string): Promise<void> {
    try {
      const indexKey = `${collectionName}:${field}`
      if (this.indices[indexKey] === undefined) {
        return // Index doesn't exist
      }

      // Remove from memory
      delete this.indices[indexKey]

      // Remove index file
      const indexPath = this._getIndexPath(collectionName, field)
      if (await fileExists(indexPath)) {
        await promisify(fs.unlink)(indexPath)
      }
    } catch (error: any) {
      throw new DocuDBError(`Error dropping index: ${(error as Error).message}`, MCO_ERROR.INDEX.DROP_ERROR, {
        collectionName,
        field,
        originalError: error
      })
    }
  }

  /**
   * Updates an index with a document
   * @param {string} collectionName - Collection name
   * @param {string} docId - Document ID
   * @param {Object} doc - Document to index
   * @returns {Promise<void>}
   */
  async updateIndex (collectionName: string, docId: string, doc: DocumentWithId): Promise<void> {
    try {
      for (const indexKey in this.indices) {
        if (indexKey.startsWith(`${collectionName}:`)) {
          const index = this.indices[indexKey]
          const field = index.field

          // Get field value from document
          let value

          if (index.isCompound) {
            // For compound indices, create a composite key
            const values = []
            for (const f of field) {
              values.push(this._getNestedValue(doc, f))
            }
            value = values.join('|')
          } else {
            // For simple indices
            value = this._getNestedValue(doc, field as string)
          }

          // If value is undefined and index is sparse, skip
          if (value === undefined && index.sparse === undefined) {
            continue
          }

          // Check uniqueness if needed
          if (index.unique && value !== undefined) {
            const existingId = this._findDocIdByValue(index, value)
            if (existingId !== null && existingId !== docId) {
              throw new Error(`Unique Index Violation: Duplicate value for ${index.isCompound ? 'compound index' : String(field)}`)
            }
          }

          // Remove old entries for this docId
          this._removeDocFromIndex(index, docId)

          // Add new entry
          if (value !== undefined) {
            const valueKey = this._getValueKey(value)
            if (index.entries[valueKey] === undefined) {
              index.entries[valueKey] = []
            }
            index.entries[valueKey].push(docId)
          }

          // Update timestamp
          index.metadata.updated = new Date()
        }
      }

      // Save updated indices
      await this._saveAllIndices(collectionName)
    } catch (error: any) {
      if ((error as Error).message.includes('Unique Index Violation')) {
        throw new DocuDBError(
          'Duplicate value in field with unique index',
          MCO_ERROR.INDEX.UNIQUE_VIOLATION,
          {
            collectionName,
            docId,
            field: (error as Error).message.includes('compound index') ? 'compound index' : (error as Error).message.split('for ')[1],
            originalError: error
          }
        )
      }
      throw new DocuDBError(`Error updating index: ${(error as Error).message}`, MCO_ERROR.INDEX.UPDATE_ERROR, {
        collectionName,
        docId,
        originalError: error
      })
    }
  }

  /**
   * Removes a document from all indices
   * @param {string} collectionName - Collection name
   * @param {string} docId - Document ID
   * @returns {Promise<void>}
   */
  async removeFromIndices (collectionName: string, docId: string): Promise<void> {
    try {
      let updated = false

      for (const indexKey in this.indices) {
        if (indexKey.startsWith(`${collectionName}:`)) {
          const index = this.indices[indexKey]
          updated = this._removeDocFromIndex(index, docId) || updated

          if (updated) {
            index.metadata.updated = new Date()
          }
        }
      }

      if (updated) {
        await this._saveAllIndices(collectionName)
      }
    } catch (error: any) {
      throw new DocuDBError(
        `Error removing document from indices: ${(error as Error).message}`,
        MCO_ERROR.INDEX.UPDATE_ERROR,
        {
          collectionName,
          docId,
          originalError: error
        }
      )
    }
  }

  /**
   * Finds documents using an index
   * @param {string} collectionName - Collection name
   * @param {string} field - Indexed field
   * @param {*} value - Value to search for
   * @returns {string[]} - Matching document IDs
   */
  findByIndex (collectionName: string, field: string, value: any): string[] | null {
    const indexKey = `${collectionName}:${field}`
    const index = this.indices[indexKey]

    if (index !== undefined) {
      return null // No index for this field
    }

    const valueKey = this._getValueKey(value)
    return (index as Index).entries[valueKey] ?? []
  }

  /**
   * Checks if an index exists for a field
   * @param {string} collectionName - Collection name
   * @param {string} field - Field to check
   * @returns {boolean} - true if an index exists for the field
   */
  hasIndex (collectionName: string, field: string): boolean {
    const indexKey = `${collectionName}:${field}`
    return Boolean(this.indices[indexKey])
  }

  /**
   * Gets the index directory path
   * @param {string} collectionName - Collection name
   * @returns {string} - Directory path
   * @private
   */
  private _getIndexDir (collectionName: string): string {
    return path.join(this.dataDir, collectionName, '_indices')
  }

  /**
   * Gets the path for an index file
   * @param {string} collectionName - Collection name
   * @param {string} field - Indexed field
   * @returns {string} - File path
   * @private
   */
  private _getIndexPath (collectionName: string, field: string): string {
    return path.join(this._getIndexDir(collectionName), `${field}.idx`)
  }

  /**
   * Loads all indices for a collection
   * @param {string} collectionName - Collection name
   * @returns {Promise<void>}
   * @private
   */
  private async _loadIndices (collectionName: string): Promise<void> {
    try {
      const indexDir = this._getIndexDir(collectionName)
      const exists = await fileExists(indexDir)

      if (!exists) return

      const files = await promisify(fs.readdir)(indexDir)

      for (const file of files) {
        if (file.endsWith('.idx')) {
          const field = file.slice(0, -4) // Remove .idx extension
          const indexPath = path.join(indexDir, file)
          const data = await readFilePromise(indexPath, 'utf8')

          const indexKey = `${collectionName}:${field}`
          this.indices[indexKey] = JSON.parse(data)
        }
      }
    } catch (error: any) {
      throw new DocuDBError(`Error loading indices: ${(error as Error).message}`, MCO_ERROR.INDEX.LOAD_ERROR, {
        collectionName,
        originalError: error
      })
    }
  }

  /**
   * Saves an index to disk
   * @param {string} collectionName - Collection name
   * @param {string} field - Indexed field
   * @returns {Promise<void>}
   * @private
   */
  private async _saveIndex (collectionName: string, field: string): Promise<void> {
    try {
      const indexKey = `${collectionName}:${field}`
      const index = this.indices[indexKey]

      if (index === undefined) return

      // Ensure index directory exists
      const indexDir = this._getIndexDir(collectionName)
      if (!(await fileExists(indexDir))) {
        await mkdirPromise(indexDir, { recursive: true })
      }

      const indexPath = this._getIndexPath(collectionName, field)
      const data = JSON.stringify(index, null, 2)
      await writeFilePromise(indexPath, data, 'utf8')

      // Update collection metadata to register this index
      const metadataPath = path.join(
        this.dataDir,
        collectionName,
        '_metadata.json'
      )
      if (await fileExists(metadataPath)) {
        try {
          const metadataRaw = await readFilePromise(metadataPath, 'utf8')
          const metadata = JSON.parse(metadataRaw) as Metadata

          // Check if index is already registered
          const indexExists = metadata.indices?.some((idx) => idx.field === field)

          if (!indexExists) {
            if (metadata.indices === undefined) metadata.indices = []
            metadata.indices.push({
              field,
              options: index.metadata ?? {}
            })
            await writeFilePromise(
              metadataPath,
              JSON.stringify(metadata, null, 2),
              'utf8'
            )
          }
        } catch (metaError: any) {
          console.error(
            `Error updating metadata for index: ${(metaError as Error).message}`
          )
        }
      }
    } catch (error: any) {
      throw new DocuDBError(`Error saving index: ${(error as Error).message}`, MCO_ERROR.INDEX.SAVE_ERROR, {
        collectionName,
        field,
        originalError: error
      })
    }
  }

  /**
   * Saves all indices for a collection
   * @param {string} collectionName - Collection name
   * @returns {Promise<void>}
   * @private
   */
  private async _saveAllIndices (collectionName: string): Promise<void> {
    try {
      for (const indexKey in this.indices) {
        if (indexKey.startsWith(`${collectionName}:`)) {
          const field = indexKey.split(':')[1]
          await this._saveIndex(collectionName, field)
        }
      }
    } catch (error: any) {
      throw new DocuDBError(`Error saving indices: ${(error as Error).message}`, MCO_ERROR.INDEX.SAVE_ERROR, {
        collectionName,
        originalError: error
      })
    }
  }

  /**
   * Removes a document from an index
   * @param {Object} index - Index to modify
   * @param {string} docId - Document ID
   * @returns {boolean} - true if any entry was removed
   * @private
   */
  private _removeDocFromIndex (index: IndexOptions, docId: string): boolean {
    let updated = false

    for (const valueKey in index.entries) {
      const docIds = index.entries[valueKey]
      const initialLength = docIds.length

      // Filter out the docId
      index.entries[valueKey] = docIds.filter(id => id !== docId)

      // If any element was removed
      if (index.entries[valueKey].length < initialLength) {
        updated = true
      }

      // If no documents left for this value, remove the entry
      if (index.entries[valueKey].length === 0) {
        delete index.entries[valueKey]
      }
    }

    return updated
  }

  /**
   * Finds a document ID by value in an index
   * @param {Object} index - Index to search
   * @param {*} value - Value to search for
   * @returns {string|null} - Document ID or null if not found
   * @private
   */
  private _findDocIdByValue (index: any, value: any): string | null {
    const valueKey = this._getValueKey(value)
    const docIds = index.entries[valueKey]

    return docIds?.length > 0 ? docIds[0] : null
  }

  /**
   * Converts a value to a string key for the index
   * @param {*} value - Value to convert
   * @returns {string} - Key for the index
   * @private
   */
  private _getValueKey (value: any): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'

    if (value instanceof Date) {
      return `date:${value.getTime()}`
    }

    if (typeof value === 'object') {
      return `obj:${JSON.stringify(value)}`
    }

    return `${typeof value}:${String(value)}`
  }

  /**
   * Gets a nested value from an object using dot notation
   * @param {Object} obj - Object to get value from
   * @param {string} path - Path to value using dot notation
   * @returns {*} - Found value or undefined
   * @private
   */
  private _getNestedValue (obj: any, path: string): any {
    if (obj === undefined || path === undefined) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = current[part]
    }

    return current
  }
}

export default IndexManager
