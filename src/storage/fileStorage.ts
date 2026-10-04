/**
 * File storage module.
 *
 * On-disk layout (format v2):
 *
 *   data/<db>/<collection>/docs/<id>.json[.gz]        single file documents
 *   data/<db>/<collection>/docs/<id>.part-0000.json.gz  chunked documents
 *   data/<db>/<collection>/_metadata.json              collection metadata
 *   data/<db>/<collection>/_order.log                  append-only order log
 *   data/<db>/<collection>/_indices/<field>.idx        index snapshots
 *
 * Format v1 (one directory per document holding `chunk_N.json[.gz]`) is
 * readable and convertible through `Database.migrate()`.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  Document,
  StorageOptions,
  StoredDocument,
  FORMAT_VERSION
} from '../types/index.js'
import {
  ensureDir,
  fileExists,
  readJson,
  removePath,
  writeFileAtomic
} from '../utils/fileUtils.js'
import gzip from '../compression/gzip.js'

/** Name of the directory holding the documents of a collection */
export const DOCS_DIR = 'docs'

/** Sub-directory holding index snapshots */
export const INDICES_DIR = '_indices'

/** Metadata file name */
export const METADATA_FILE = '_metadata.json'

/** Append-only order log file name */
export const ORDER_LOG_FILE = '_order.log'

/** Matches a chunked document file */
const CHUNK_PATTERN = /\.part-(\d{4,})\.json(\.gz)?$/

/** Matches a single file document */
const SINGLE_PATTERN = /^[^.]+(?:\.[^.]+)*\.json(\.gz)?$/

/** Candidate names of the first chunk of a chunked document */
const FIRST_CHUNK = '.part-0000'

/** Restores `Date` objects from their ISO representation */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

class FileStorage {
  /** Database directory */
  public readonly dataDir: string
  /** Maximum size in bytes of a single chunk */
  public readonly chunkSize: number
  /** Compression strategy */
  public readonly compression: boolean | 'auto'
  /** Minimum payload size compressed in `'auto'` mode */
  public readonly compressionThreshold: number
  /** gzip compression level */
  public readonly compressionLevel: number
  /** Format version written by this instance */
  public readonly formatVersion: number

  /**
   * Creates a new file storage instance
   * @param options - Configuration options
   */
  constructor (options: StorageOptions) {
    this.dataDir = path.resolve(options.dataDir)
    this.chunkSize = Math.max(1024, options.chunkSize ?? 1024 * 1024)
    this.compression = options.compression ?? true
    this.compressionThreshold = options.compressionThreshold ?? 4096
    this.compressionLevel = options.compressionLevel ?? gzip.DEFAULT_COMPRESSION_LEVEL
    this.formatVersion = FORMAT_VERSION
  }

  /**
   * Creates the database directory when missing
   */
  async initialize (): Promise<void> {
    try {
      await ensureDir(this.dataDir)
    } catch (error: any) {
      throw new DocuDBError(
        `Error initializing storage: ${(error as Error).message}`,
        MCO_ERROR.STORAGE.INIT_ERROR,
        { dataDir: this.dataDir, originalError: error },
        { cause: error }
      )
    }
  }

  /** Absolute path of a collection directory */
  collectionPath (collectionName: string): string {
    return path.join(this.dataDir, collectionName)
  }

  /** Absolute path of the directory holding the documents of a collection */
  docsPath (collectionName: string): string {
    return path.join(this.collectionPath(collectionName), DOCS_DIR)
  }

  /** Absolute path of the collection metadata file */
  metadataPath (collectionName: string): string {
    return path.join(this.collectionPath(collectionName), METADATA_FILE)
  }

  /** Absolute path of the append-only order log */
  orderLogPath (collectionName: string): string {
    return path.join(this.collectionPath(collectionName), ORDER_LOG_FILE)
  }

  /** Absolute path of the directory holding index snapshots */
  indexDir (collectionName: string): string {
    return path.join(this.collectionPath(collectionName), INDICES_DIR)
  }

  /**
   * Ensures the directories of a collection exist
   * @param collectionName - Collection name
   * @returns The documents directory
   */
  async ensureCollection (collectionName: string): Promise<string> {
    const docs = this.docsPath(collectionName)
    await ensureDir(docs)
    return docs
  }

  /**
   * Tells whether a document exists on disk.
   *
   * Only the candidate file names are probed (never a directory listing), so
   * this stays O(1) no matter how many documents the collection holds.
   * @param collectionName - Collection name
   * @param docId - Document id
   * @returns true when the document exists
   */
  async hasDocument (collectionName: string, docId: string): Promise<boolean> {
    const docs = this.docsPath(collectionName)
    for (const suffix of ['.json', '.json.gz', `${FIRST_CHUNK}.json`, `${FIRST_CHUNK}.json.gz`]) {
      if (await fileExists(path.join(docs, `${docId}${suffix}`))) return true
    }
    return false
  }

  /**
   * Locates the files holding a document, supporting every known extension so
   * that data written with a different `compression` setting stays readable.
   * @param collectionName - Collection name
   * @param docId - Document id
   * @returns Absolute paths, empty when the document does not exist
   */
  async resolveDocumentPaths (
    collectionName: string,
    docId: string
  ): Promise<string[]> {
    const docs = this.docsPath(collectionName)

    for (const extension of ['.json', '.json.gz']) {
      const single = path.join(docs, `${docId}${extension}`)
      if (await fileExists(single)) return [single]
    }

    try {
      const entries = await fs.readdir(docs)
      const parts: Array<{ index: number, file: string }> = []
      for (const entry of entries) {
        if (!entry.startsWith(`${docId}.part-`)) continue
        const match = CHUNK_PATTERN.exec(entry)
        if (match == null) continue
        parts.push({ index: Number(match[1]), file: entry })
      }
      if (parts.length === 0) return []
      parts.sort((a, b) => a.index - b.index)
      return parts.map(part => path.join(docs, part.file))
    } catch {
      return []
    }
  }

  /**
   * Lists the ids of the documents stored in a collection
   * @param collectionName - Collection name
   * @returns Document ids in directory order
   */
  async listDocumentIds (collectionName: string): Promise<string[]> {
    const docs = this.docsPath(collectionName)
    let entries: string[]
    try {
      entries = await fs.readdir(docs)
    } catch (error: any) {
      if (error.code === 'ENOENT') return []
      throw error
    }

    const ids: string[] = []
    const seen = new Set<string>()

    for (const entry of entries) {
      if (entry.startsWith('.') || entry.endsWith('.tmp')) continue
      const chunkMatch = CHUNK_PATTERN.exec(entry)
      const id = chunkMatch != null
        ? entry.slice(0, entry.length - chunkMatch[0].length)
        : (SINGLE_PATTERN.test(entry) ? entry.replace(/\.json(\.gz)?$/, '') : null)
      if (id == null || id.length === 0 || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }

    return ids
  }

  /**
   * Serializes and writes a document, splitting it into chunks when needed.
   * @param collectionName - Collection name
   * @param docId - Document id
   * @param data - Document to persist
   * @returns Paths of the written files and the number of bytes written
   */
  async writeDocument (
    collectionName: string,
    docId: string,
    data: Document
  ): Promise<StoredDocument> {
    try {
      await this.ensureCollection(collectionName)
      const docs = this.docsPath(collectionName)
      const json = JSON.stringify(data)

      const chunkCount = Math.max(1, Math.ceil(json.length / this.chunkSize))
      const compress = this.shouldCompress(json.length)
      // Only look for leftovers when a previous revision can exist.
      const previous = await this.hasDocument(collectionName, docId)
        ? await this.resolveDocumentPaths(collectionName, docId)
        : []

      if (chunkCount === 1) {
        const target = path.join(docs, `${docId}${compress ? '.json.gz' : '.json'}`)
        const payload = compress
          ? await gzip.compress(json, this.compressionLevel)
          : Buffer.from(json, 'utf8')
        await writeFileAtomic(target, payload)
        const stored: StoredDocument = { paths: [target], bytes: payload.byteLength }
        await this._removeObsolete(previous, stored.paths)
        return stored
      }

      const paths: string[] = []
      let bytes = 0
      for (let index = 0; index < chunkCount; index++) {
        const slice = json.slice(index * this.chunkSize, (index + 1) * this.chunkSize)
        const payload = compress
          ? await gzip.compress(slice, this.compressionLevel)
          : Buffer.from(slice, 'utf8')
        const target = path.join(docs, `${docId}.part-${String(index).padStart(4, '0')}${compress ? '.json.gz' : '.json'}`)
        await writeFileAtomic(target, payload)
        paths.push(target)
        bytes += payload.byteLength
      }

      const stored: StoredDocument = { paths, bytes }
      await this._removeObsolete(previous, paths)
      return stored
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.STORAGE.SAVE_ERROR, {
        collectionName,
        docId
      })
    }
  }

  /**
   * Reads and deserializes a document
   * @param collectionName - Collection name
   * @param docId - Document id
   * @returns The document, or null when it does not exist
   */
  async readDocument (
    collectionName: string,
    docId: string
  ): Promise<Document | null> {
    const paths = await this.resolveDocumentPaths(collectionName, docId)
    if (paths.length === 0) return null

    try {
      let payload = ''
      for (const filePath of paths) {
        const raw = await fs.readFile(filePath)
        const isGzip = filePath.endsWith('.gz')
        payload += (isGzip ? await gzip.decompress(raw) : raw).toString('utf8')
      }

      return JSON.parse(payload, (_key, value) => {
        if (typeof value === 'string' && ISO_DATE.test(value)) {
          const parsed = new Date(value)
          return Number.isNaN(parsed.getTime()) ? value : parsed
        }
        return value
      }) as Document
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.STORAGE.READ_ERROR, {
        collectionName,
        docId,
        paths
      })
    }
  }

  /**
   * Removes a document and every file it owns
   * @param collectionName - Collection name
   * @param docId - Document id
   * @returns true when something was removed
   */
  async deleteDocument (collectionName: string, docId: string): Promise<boolean> {
    const paths = await this.resolveDocumentPaths(collectionName, docId)
    for (const filePath of paths) {
      await removePath(filePath)
    }
    return paths.length > 0
  }

  /**
   * Deletes a set of files (legacy helper)
   * @param chunkPaths - Paths to delete
   */
  async deleteChunks (chunkPaths: string[]): Promise<void> {
    for (const chunkPath of chunkPaths) {
      await removePath(chunkPath)
    }
  }

  /**
   * Deletes a whole collection directory
   * @param collectionName - Collection name
   */
  async dropCollection (collectionName: string): Promise<void> {
    await removePath(this.collectionPath(collectionName))
  }

  /** Total size in bytes of a collection */
  async collectionSize (collectionName: string): Promise<number> {
    let total = 0
    for (const relative of ['docs', INDICES_DIR]) {
      total += await directorySize(path.join(this.collectionPath(collectionName), relative))
    }
    total += await fileSize(this.metadataPath(collectionName))
    total += await fileSize(this.orderLogPath(collectionName))
    return total
  }

  /** Reads the collection metadata file */
  async readCollectionMetadata<T> (collectionName: string): Promise<T | null> {
    return readJson<T>(this.metadataPath(collectionName))
  }

  /**
   * Decides whether a payload must be compressed
   * @param length - Payload length in bytes
   * @returns true when gzip must be applied
   * @private
   */
  private shouldCompress (length: number): boolean {
    if (this.compression === true) return true
    if (this.compression === 'auto') return length >= this.compressionThreshold
    return false
  }

  /**
   * Deletes files that belonged to a previous revision of a document
   * @param previous - Files found before the write
   * @param current - Files holding the new revision
   * @private
   */
  private async _removeObsolete (
    previous: string[],
    current: string[]
  ): Promise<void> {
    if (previous.length === 0) return
    const keep = new Set(current)
    for (const filePath of previous) {
      if (!keep.has(filePath)) await removePath(filePath)
    }
  }
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

/**
 * Recursive size of a directory
 * @param dir - Directory to measure
 * @returns Size in bytes
 */
async function directorySize (dir: string): Promise<number> {
  let total = 0
  let entries: Array<{ name: string, isDirectory: () => boolean }>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    total += entry.isDirectory()
      ? await directorySize(target)
      : await fileSize(target)
  }
  return total
}

export default FileStorage
