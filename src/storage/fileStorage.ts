/**
 * File Storage Module
 * Handles file reading/writing and chunks for the database
 */

import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import gzip from '../compression/gzip.js'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import { fileExists } from '../utils/fileUtils.js'
import { DocumentWithId, StorageOptions } from '../types/index.js'

// Convert callback functions to promises
const readFilePromise = promisify(fs.readFile)
const writeFilePromise = promisify(fs.writeFile)
const mkdirPromise = promisify(fs.mkdir)
const rmPromise = promisify(fs.rm)

class FileStorage {
  /** Directory to store data */
  public dataDir: string
  /** Maximum size of each chunk in bytes */
  public chunkSize: number
  /** Indicates if compression should be used */
  public useCompression: boolean
  /** File extension for chunks */
  public chunkExt: string

  /**
   * Creates a new file storage instance
   * @param options - Configuration options
   */
  constructor (options: StorageOptions) {
    this.dataDir = options.dataDir ?? './data'
    this.chunkSize = options.chunkSize ?? 1024 * 1024 // 1MB default
    this.useCompression = options.compression
    this.chunkExt = this.useCompression ? '.gz' : '.json'
  }

  /**
   * Initializes storage by creating necessary directories
   */
  async initialize (): Promise<void> {
    try {
      const exists = await fileExists(this.dataDir)
      if (!exists) {
        await mkdirPromise(this.dataDir, { recursive: true })
      }
    } catch (error: any) {
      throw new DocuDBError(
        `Error initializing storage: ${(error as Error).message}`,
        MCO_ERROR.STORAGE.INIT_ERROR,
        { originalError: error }
      )
    }
  }

  /**
   * Splits data into appropriately sized chunks
   * @param {string} data - Data to split
   * @returns {string[]} - Array of chunks
   * @private
   */
  private _splitIntoChunks (data: string): string[] {
    const chunks = []
    let offset = 0

    while (offset < data.length) {
      chunks.push(data.slice(offset, offset + this.chunkSize))
      offset += this.chunkSize
    }

    return chunks
  }

  /**
   * Saves data to a file, possibly splitting it into chunks
   * @param {string} collectionName - Collection name
   * @param {Object} data - Data to save
   * @returns {Promise<string[]>} - List of created chunk paths
   */
  async saveData (collectionName: string, data: Object): Promise<string[]> {
    try {
      await this._ensureCollectionDir(collectionName)

      const jsonData = JSON.stringify(data)
      const chunks = this._splitIntoChunks(jsonData)
      const chunkPaths = []

      for (let i = 0; i < chunks.length; i++) {
        const chunkPath = this._getChunkPath(collectionName, i)
        let chunkData: Buffer | string = chunks[i]

        if (this.useCompression) {
          chunkData = await gzip.compress(chunkData)
        }

        await writeFilePromise(chunkPath, chunkData)
        chunkPaths.push(chunkPath)
      }

      return chunkPaths
    } catch (error: any) {
      throw new DocuDBError(
        `Error saving data: ${(error as Error).message}`,
        MCO_ERROR.STORAGE.SAVE_ERROR,
        { collectionName, originalError: error }
      )
    }
  }

  /**
   * Reads data from a set of chunks
   * @param {string[]} chunkPaths - Paths of chunks to read
   * @returns {Promise<DocumentWithId>} - Combined data
   */
  async readData (chunkPaths: string[]): Promise<DocumentWithId> {
    try {
      let combinedData = ''

      for (const chunkPath of chunkPaths) {
        let chunkData: Buffer = await readFilePromise(chunkPath)
        if (this.useCompression) {
          chunkData = await gzip.decompress(chunkData)
        }

        combinedData += chunkData.toString()
      }

      return JSON.parse(combinedData)
    } catch (error: any) {
      throw new DocuDBError(
        `Error reading data: ${(error as Error).message}`,
        MCO_ERROR.STORAGE.READ_ERROR,
        { chunkPaths, originalError: error }
      )
    }
  }

  /**
   * Deletes a set of chunks
   * @param {string[]} chunkPaths - Paths of chunks to delete
   */
  async deleteChunks (chunkPaths: string[]): Promise<void> {
    try {
      for (const chunkPath of chunkPaths) {
        const exists = await fileExists(chunkPath)
        if (exists) {
          // Use rm for files and directories (fs.rm is recommended)
          await rmPromise(chunkPath, { recursive: true, force: true })
        }
      }
    } catch (error: any) {
      throw new DocuDBError(
        `Error deleting chunks: ${(error as Error).message}`,
        MCO_ERROR.STORAGE.DELETE_ERROR,
        { chunkPaths, originalError: error }
      )
    }
  }

  /**
   * Ensures that the collection directory exists
   * @param {string} collectionName - Collection name
   * @private
   */
  async _ensureCollectionDir (collectionName: string): Promise<string> {
    const collectionDir = path.join(this.dataDir, collectionName)
    const exists = await fileExists(collectionDir)
    if (!exists) {
      await mkdirPromise(collectionDir, { recursive: true })
    }
    // Always ensure metadata file exists
    const metadataPath = path.join(collectionDir, '_metadata.json')
    const metadataExists = await fileExists(metadataPath)
    if (!metadataExists) {
      await writeFilePromise(metadataPath, JSON.stringify({}))
    }
    return collectionDir
  }

  /**
   * Generates the path for a chunk
   * @param {string} collectionName - Collection name
   * @param {number} chunkIndex - Chunk index
   * @returns {string} - Chunk path
   * @private
   */
  private _getChunkPath (collectionName: string, chunkIndex: number): string {
    return path.join(
      this.dataDir,
      collectionName,
      `chunk_${chunkIndex}${this.chunkExt}`
    )
  }
}

export default FileStorage
