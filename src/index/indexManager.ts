/**
 * Indexing module.
 *
 * Indexes are kept in memory as `value key -> Set<document id>` plus a reverse
 * map `document id -> Set<value key>`, so removing a document from an index is
 * O(number of its keys) instead of scanning every key. Snapshots are written
 * lazily (dirty flag) and coalesced per operation, instead of rewriting every
 * index file on every write.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  IndexManagerOptions,
  IndexOptions,
  Document,
  Indices,
  Index,
  IndexField
} from '../types/index.js'
import { getNestedValue, compareValues } from '../utils/paths.js'
import {
  ensureDir,
  fileExists,
  readJson,
  writeJsonAtomic
} from '../utils/fileUtils.js'

/** Runtime index, richer than its serialized form */
interface RuntimeIndex {
  /** Indexed fields */
  fields: string[]
  /** Whether the index spans several fields */
  isCompound: boolean
  /** Whether the index enforces uniqueness */
  unique: boolean
  /** Whether documents missing the field are skipped */
  sparse: boolean
  /** Custom index name */
  name: string
  /** Creation timestamp */
  created: Date
  /** Last modification timestamp */
  updated: Date
  /** value key -> document ids */
  entries: Map<string, Set<string>>
  /** value key -> raw indexed value (range queries and ordering) */
  values: Map<string, unknown>
  /** document id -> value keys referencing it */
  reverse: Map<string, Set<string>>
  /** Cached ascending order of the value keys */
  sortedKeys: string[] | null
  /** Whether the snapshot must be rewritten */
  dirty: boolean
}

/** Outcome of an index lookup */
export interface IndexLookup {
  /** Matching document ids */
  ids: string[]
  /** Number of value keys inspected */
  keysScanned: number
  /** Index key used */
  indexKey: string
}

/** Comparison operators an index can answer directly */
const RANGE_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'
])

/**
 * Builds the canonical index key
 * @param collectionName - Collection name
 * @param fields - Indexed fields
 * @returns Index key
 */
function indexKeyOf (collectionName: string, fields: string[]): string {
  return `${collectionName}:${fields.join('+')}`
}

/**
 * Parses a canonical index key
 * @param key - Index key
 * @returns Collection name and fields
 */
function parseIndexKey (key: string): { collection: string, fields: string[] } {
  const separator = key.indexOf(':')
  return {
    collection: key.slice(0, separator),
    fields: key.slice(separator + 1).split('+')
  }
}

/**
 * Normalizes the `field` argument of the public API into a field list
 * @param field - Field or fields
 * @returns Field list
 */
function toFields (field: IndexField): string[] {
  const fields = Array.isArray(field) ? field : [field]
  if (
    fields.length === 0 ||
    fields.some(entry => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new DocuDBError(
      'Index fields must be a non-empty string or array of strings',
      MCO_ERROR.INDEX.INVALID_FIELD_TYPE,
      { field }
    )
  }
  return [...fields]
}

/**
 * Builds the canonical key of an indexed value
 * @param value - Indexed value
 * @returns Stable string key
 */
export function valueKeyOf (value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (value instanceof Date) return `date:${value.getTime()}`
  if (typeof value === 'object') return `obj:${JSON.stringify(value)}`
  return `${typeof value}:${String(value)}`
}

/**
 * Best effort reconstruction of the raw value behind a key, used when an index
 * is loaded from disk and the original value is not stored.
 * @param valueKey - Canonical key
 * @returns Reconstructed value
 */
function rawValueOf (valueKey: string): unknown {
  if (valueKey === 'null') return null
  if (valueKey === 'undefined') return undefined
  if (valueKey.startsWith('date:')) return new Date(Number(valueKey.slice(5)))
  if (valueKey.startsWith('obj:')) {
    try {
      return JSON.parse(valueKey.slice(4))
    } catch {
      return valueKey
    }
  }
  const separator = valueKey.indexOf(':')
  const type = valueKey.slice(0, separator)
  const raw = valueKey.slice(separator + 1)
  switch (type) {
    case 'number': return Number(raw)
    case 'boolean': return raw === 'true'
    default: return raw
  }
}

/**
 * Computes the value an index stores for a document
 * @param fields - Indexed fields
 * @param doc - Document
 * @returns The value, or undefined when the document should not be indexed
 */
function extractIndexValue (fields: string[], doc: Document): unknown {
  if (fields.length === 1) {
    const value = getNestedValue(doc, fields[0])
    if (Array.isArray(value)) return value.length === 0 ? undefined : value[0]
    return value
  }

  const parts: unknown[] = []
  for (const field of fields) {
    const value = getNestedValue(doc, field)
    if (value === undefined || value === null) return undefined
    parts.push(value instanceof Date ? value.getTime() : value)
  }
  return parts.join('|')
}

/**
 * Normalizes a field condition into an operator map that an index can answer.
 * @param condition - Value coming from the criteria
 * @returns Operator map, or null when the condition is not indexable
 */
function normalizeCondition (condition: unknown): Record<string, unknown> | null {
  if (condition === undefined) return null
  if (Array.isArray(condition)) return { $in: condition }
  if (condition === null || typeof condition !== 'object' || condition instanceof RegExp) {
    return { $eq: condition }
  }

  const operators = Object.keys(condition as Record<string, unknown>)
  if (operators.length === 0) return null
  if (!operators.every(operator => operator.startsWith('$'))) {
    return { $eq: condition }
  }

  const map: Record<string, unknown> = {}
  for (const operator of operators) {
    map[operator] = (condition as Record<string, unknown>)[operator]
  }
  return map
}

class IndexManager {
  /** Database directory */
  public readonly dataDir: string
  /** Flush interval in ms; 0 means flush on demand */
  public readonly flushInterval: number

  /** Runtime indexes keyed by `collection:field+field` */
  private readonly runtime: Map<string, RuntimeIndex>
  private readonly dirtyCollections: Set<string>
  private flushTimer: NodeJS.Timeout | null

  /**
   * @param options - Configuration options
   * @param options.dataDir - Directory storing the data
   * @param flushInterval - Background flush interval in ms
   */
  constructor (
    options: IndexManagerOptions = { dataDir: './data' },
    flushInterval = 0
  ) {
    this.dataDir = path.resolve(options.dataDir)
    this.flushInterval = flushInterval
    this.runtime = new Map()
    this.dirtyCollections = new Set()
    this.flushTimer = null
  }

  /**
   * Serialized view of the in-memory indexes (backwards compatible accessor)
   */
  get indices (): Indices {
    const view: Indices = {}
    for (const [key, index] of this.runtime) {
      view[key] = serializeIndex(index)
    }
    return view
  }

  /**
   * Creates the index directory of a collection
   * @param collectionName - Collection name
   */
  async initialize (collectionName: string): Promise<void> {
    try {
      await ensureDir(path.join(this.dataDir, collectionName, '_indices'))
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.INIT_ERROR, { collectionName })
    }
  }

  /**
   * Restores an index declared in the collection metadata, loading its snapshot
   * @param collectionName - Collection name
   * @param field - Indexed field(s)
   * @param options - Index options
   */
  async restore (
    collectionName: string,
    field: IndexField,
    options: IndexOptions = {}
  ): Promise<void> {
    const fields = toFields(field)
    await this._loadSnapshot(collectionName, fields)
    if (!this.runtime.has(indexKeyOf(collectionName, fields))) {
      await this.createIndex(collectionName, field, options)
    }
  }

  /**
   * Creates an index for one or several fields
   * @param collectionName - Collection name
   * @param field - Field or fields to index
   * @param options - Index options
   * @returns true when the index is available
   */
  async createIndex (
    collectionName: string,
    field: IndexField,
    options: IndexOptions = {}
  ): Promise<boolean> {
    const fields = toFields(field)
    const key = indexKeyOf(collectionName, fields)

    try {
      const existing = this.runtime.get(key)
      if (existing !== undefined) {
        if (options.unique === true) existing.unique = true
        if (options.sparse === true) existing.sparse = true
        if (options.name !== undefined) existing.name = options.name
        existing.dirty = true
        this.markDirty(collectionName)
        await this.flush(collectionName)
        return true
      }

      await ensureDir(path.join(this.dataDir, collectionName, '_indices'))

      const now = new Date()
      this.runtime.set(key, {
        fields,
        isCompound: fields.length > 1,
        unique: options.unique === true,
        sparse: options.sparse === true,
        name: options.name ?? `idx_${fields.join('_')}`,
        created: now,
        updated: now,
        entries: new Map(),
        values: new Map(),
        reverse: new Map(),
        sortedKeys: null,
        dirty: true
      })

      this.markDirty(collectionName)
      await this.flush(collectionName)
      return true
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.CREATE_ERROR, {
        collectionName,
        field
      })
    }
  }

  /**
   * Drops an index
   * @param collectionName - Collection name
   * @param field - Indexed field(s)
   * @returns true when an index was removed
   */
  async dropIndex (collectionName: string, field: IndexField): Promise<boolean> {
    const fields = toFields(field)
    const key = indexKeyOf(collectionName, fields)

    try {
      if (!this.runtime.delete(key)) return false
      this.dirtyCollections.delete(collectionName)

      const indexPath = this._indexPath(collectionName, fields)
      if (await fileExists(indexPath)) {
        await fs.unlink(indexPath)
      }
      return true
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.DROP_ERROR, {
        collectionName,
        field
      })
    }
  }

  /**
   * Removes every index of a collection from memory and disk
   * @param collectionName - Collection name
   */
  async dropAll (collectionName: string): Promise<void> {
    for (const key of [...this.runtime.keys()]) {
      if (parseIndexKey(key).collection === collectionName) this.runtime.delete(key)
    }
    this.dirtyCollections.delete(collectionName)
    await fs.rm(path.join(this.dataDir, collectionName, '_indices'), {
      recursive: true,
      force: true
    })
  }

  /**
   * Applies a document to every index of the collection
   * @param collectionName - Collection name
   * @param docId - Document id
   * @param doc - Document to index
   */
  async updateIndex (
    collectionName: string,
    docId: string,
    doc: Document
  ): Promise<void> {
    const indexes = this._indexesOf(collectionName)
    if (indexes.length === 0) return

    try {
      for (const [key, index] of indexes) {
        const value = extractIndexValue(index.fields, doc)

        if (value === undefined && !index.sparse) {
          this._removeFrom(index, docId)
          continue
        }

        if (index.unique && value !== undefined) {
          const bucket = index.entries.get(valueKeyOf(value))
          if (bucket !== undefined) {
            for (const candidate of bucket) {
              if (candidate !== docId) {
                throw new DocuDBError(
                  `Duplicate value in field with unique index: ${index.fields.join(', ')}`,
                  MCO_ERROR.INDEX.UNIQUE_VIOLATION,
                  { collectionName, docId, field: index.fields.join(', ') }
                )
              }
            }
          }
        }

        this._removeFrom(index, docId)

        if (value !== undefined) {
          const valueKey = valueKeyOf(value)
          let bucket = index.entries.get(valueKey)
          if (bucket === undefined) {
            bucket = new Set<string>()
            index.entries.set(valueKey, bucket)
            index.values.set(valueKey, value)
          }
          bucket.add(docId)

          let owned = index.reverse.get(docId)
          if (owned === undefined) {
            owned = new Set<string>()
            index.reverse.set(docId, owned)
          }
          owned.add(valueKey)
        }

        index.updated = new Date()
        index.sortedKeys = null
        index.dirty = true
        this.runtime.set(key, index)
      }

      this.markDirty(collectionName)
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.UPDATE_ERROR, {
        collectionName,
        docId
      })
    }
  }

  /**
   * Removes a document from every index of the collection
   * @param collectionName - Collection name
   * @param docId - Document id
   */
  async removeFromIndices (collectionName: string, docId: string): Promise<void> {
    const indexes = this._indexesOf(collectionName)
    if (indexes.length === 0) return

    try {
      for (const [key, index] of indexes) {
        if (this._removeFrom(index, docId)) {
          index.updated = new Date()
          index.sortedKeys = null
          index.dirty = true
          this.runtime.set(key, index)
        }
      }
      this.markDirty(collectionName)
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.UPDATE_ERROR, {
        collectionName,
        docId
      })
    }
  }

  /**
   * Exact match lookup
   * @param collectionName - Collection name
   * @param field - Indexed field
   * @param value - Value to look for
   * @returns Matching ids, or null when the index does not exist
   */
  findByIndex (
    collectionName: string,
    field: string,
    value: unknown
  ): string[] | null {
    const index = this.runtime.get(indexKeyOf(collectionName, [field]))
    if (index === undefined) return null

    const bucket = index.entries.get(valueKeyOf(value))
    return bucket === undefined ? [] : [...bucket]
  }

  /**
   * Answers a field condition with an index when possible.
   *
   * Supports `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in` and `$nin`, and
   * uses prefix lookups on compound indexes.
   * @param collectionName - Collection name
   * @param field - Indexed field
   * @param condition - Field condition coming from the criteria
   * @returns Lookup result, or null when the index cannot answer it
   */
  lookup (
    collectionName: string,
    field: string,
    condition: unknown
  ): IndexLookup | null {
    let bestKey: string | undefined
    for (const key of this._indexesOf(collectionName).map(([key]) => key)) {
      const fields = parseIndexKey(key).fields
      if (fields[0] !== field) continue
      if (bestKey === undefined || fields.length < parseIndexKey(bestKey).fields.length) {
        bestKey = key
      }
    }
    if (bestKey === undefined) return null

    const normalized = normalizeCondition(condition)
    if (normalized === null) return null

    const operators = Object.keys(normalized)
    if (!operators.every(operator => RANGE_OPERATORS.has(operator))) return null

    const index = this.runtime.get(bestKey) as RuntimeIndex
    const ids = new Set<string>()
    let keysScanned = 0

    for (const operator of operators) {
      const found = this._rangeLookup(index, operator, normalized[operator])
      if (found === null) return null
      keysScanned += found.keysScanned
      for (const id of found.ids) ids.add(id)
    }

    return { ids: [...ids], keysScanned, indexKey: bestKey }
  }

  /**
   * Checks whether a field is indexed
   * @param collectionName - Collection name
   * @param field - Field to check
   * @returns true when the field is indexed
   */
  hasIndex (collectionName: string, field: string): boolean {
    return this._indexesOf(collectionName)
      .some(([, index]) => index.fields[0] === field)
  }

  /** Lists the fields of every index of a collection */
  listIndexedFields (collectionName: string): string[][] {
    return this._indexesOf(collectionName).map(([, index]) => [...index.fields])
  }

  /** Number of indexes of a collection */
  countIndexes (collectionName: string): number {
    return this._indexesOf(collectionName).length
  }

  /** Marks the indexes of a collection as needing a snapshot */
  markDirty (collectionName: string): void {
    this.dirtyCollections.add(collectionName)
    if (this.flushInterval > 0) this._ensureTimer()
  }

  /** Number of collections with pending index writes */
  get pending (): number {
    return this.dirtyCollections.size
  }

  /**
   * Writes the pending snapshots
   * @param collectionName - Collection name, or every dirty collection
   */
  async flush (collectionName?: string): Promise<void> {
    const targets = collectionName === undefined
      ? [...this.dirtyCollections]
      : (this.dirtyCollections.has(collectionName) ? [collectionName] : [])

    for (const collection of targets) {
      this.dirtyCollections.delete(collection)
      const indexes = this._indexesOf(collection)
      const dirty = indexes.filter(([, index]) => index.dirty)
      if (dirty.length === 0) continue

      try {
        await ensureDir(path.join(this.dataDir, collection, '_indices'))
        for (const [, index] of dirty) {
          index.dirty = false
          await writeJsonAtomic(
            this._indexPath(collection, index.fields),
            serializeIndex(index)
          )
        }
      } catch (error: any) {
        throw DocuDBError.wrap(error, MCO_ERROR.INDEX.SAVE_ERROR, {
          collectionName: collection
        })
      }
    }
  }

  /** Flushes everything and stops the background timer */
  async close (): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }

  /**
   * Rebuilds an index from a list of documents
   * @param collectionName - Collection name
   * @param field - Indexed field(s)
   * @param docs - Documents to index
   */
  async rebuild (
    collectionName: string,
    field: IndexField,
    docs: Document[]
  ): Promise<void> {
    const fields = toFields(field)
    const key = indexKeyOf(collectionName, fields)
    const previous = this.runtime.get(key)

    try {
      const now = new Date()
      this.runtime.set(key, {
        fields,
        isCompound: fields.length > 1,
        unique: previous?.unique === true,
        sparse: previous?.sparse === true,
        name: previous?.name ?? `idx_${fields.join('_')}`,
        created: previous?.created ?? now,
        updated: now,
        entries: new Map(),
        values: new Map(),
        reverse: new Map(),
        sortedKeys: null,
        dirty: true
      })

      for (const doc of docs) {
        if (typeof doc._id !== 'string') continue
        await this.updateIndex(collectionName, doc._id, doc)
      }

      await this.flush(collectionName)
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.CREATE_ERROR, {
        collectionName,
        field
      })
    }
  }

  /**
   * Every index belonging to a collection
   * @param collectionName - Collection name
   * @returns Key/index pairs
   * @private
   */
  private _indexesOf (collectionName: string): Array<[string, RuntimeIndex]> {
    const result: Array<[string, RuntimeIndex]> = []
    for (const [key, index] of this.runtime) {
      if (parseIndexKey(key).collection === collectionName) result.push([key, index])
    }
    return result
  }

  /**
   * Answers a single range operator
   * @param index - Runtime index
   * @param operator - Comparison operator
   * @param operand - Operand
   * @returns Matching ids and the number of keys inspected
   * @private
   */
  private _rangeLookup (
    index: RuntimeIndex,
    operator: string,
    operand: unknown
  ): { ids: string[], keysScanned: number } | null {
    switch (operator) {
      case '$eq': {
        const bucket = index.entries.get(valueKeyOf(operand))
        return {
          ids: bucket === undefined ? [] : [...bucket],
          keysScanned: 1
        }
      }

      case '$in': {
        if (!Array.isArray(operand)) return null
        const ids: string[] = []
        for (const value of operand) {
          const bucket = index.entries.get(valueKeyOf(value))
          if (bucket !== undefined) ids.push(...bucket)
        }
        return { ids, keysScanned: operand.length }
      }

      case '$ne': {
        const bucket = index.entries.get(valueKeyOf(operand))
        const excluded = new Set(bucket ?? [])
        return { ids: allExcept(index, excluded), keysScanned: index.entries.size }
      }

      case '$nin': {
        if (!Array.isArray(operand)) return null
        const excluded = new Set<string>()
        for (const value of operand) {
          const bucket = index.entries.get(valueKeyOf(value))
          if (bucket !== undefined) for (const id of bucket) excluded.add(id)
        }
        return { ids: allExcept(index, excluded), keysScanned: operand.length }
      }

      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        const hasLower = operator === '$gt' || operator === '$gte'
        const hasUpper = operator === '$lt' || operator === '$lte'
        const sorted = this._sortedKeys(index)
        const ids: string[] = []
        let keysScanned = 0

        for (const valueKey of sorted) {
          const raw = index.values.get(valueKey)
          keysScanned++

          if (hasLower) {
            const comparison = compareValues(raw, operand)
            if (operator === '$gt' ? comparison <= 0 : comparison < 0) continue
          }
          if (hasUpper) {
            const comparison = compareValues(raw, operand)
            if (operator === '$lt' ? comparison >= 0 : comparison > 0) continue
          }

          const bucket = index.entries.get(valueKey)
          if (bucket !== undefined) ids.push(...bucket)
        }

        return { ids, keysScanned }
      }

      /* istanbul ignore next - guarded by RANGE_OPERATORS */
      default:
        return null
    }
  }

  /**
   * Ascending value keys, sorted lazily and cached until the index changes
   * @param index - Runtime index
   * @returns Sorted value keys
   * @private
   */
  private _sortedKeys (index: RuntimeIndex): string[] {
    if (index.sortedKeys !== null) return index.sortedKeys
    const keys = [...index.values.keys()]
    keys.sort((a, b) => {
      const result = compareValues(index.values.get(a), index.values.get(b))
      return result !== 0 ? result : (a < b ? -1 : a > b ? 1 : 0)
    })
    index.sortedKeys = keys
    return keys
  }

  /**
   * Removes a document from an index in O(number of its keys)
   * @param index - Runtime index (mutated)
   * @param docId - Document id
   * @returns true when something was removed
   * @private
   */
  private _removeFrom (index: RuntimeIndex, docId: string): boolean {
    const owned = index.reverse.get(docId)
    if (owned === undefined || owned.size === 0) return false

    for (const valueKey of owned) {
      const bucket = index.entries.get(valueKey)
      if (bucket === undefined) continue
      bucket.delete(docId)
      if (bucket.size === 0) {
        index.entries.delete(valueKey)
        index.values.delete(valueKey)
      }
    }

    index.reverse.delete(docId)
    index.sortedKeys = null
    index.dirty = true
    return true
  }

  /**
   * Loads a snapshot from disk into memory
   * @param collectionName - Collection name
   * @param fields - Indexed fields
   * @private
   */
  private async _loadSnapshot (collectionName: string, fields: string[]): Promise<void> {
    const key = indexKeyOf(collectionName, fields)
    if (this.runtime.has(key)) return

    try {
      const snapshot = await readJson<Index>(this._indexPath(collectionName, fields))
      if (snapshot === null) return

      const indexFields = Array.isArray(snapshot.fields) && snapshot.fields.length > 0
        ? snapshot.fields
        : fields

      const index: RuntimeIndex = {
        fields: indexFields,
        isCompound: indexFields.length > 1,
        unique: snapshot.unique,
        sparse: snapshot.sparse,
        name: snapshot.metadata?.name ?? `idx_${fields.join('_')}`,
        created: new Date(snapshot.metadata?.created ?? Date.now()),
        updated: new Date(snapshot.metadata?.updated ?? Date.now()),
        entries: new Map(),
        values: new Map(),
        reverse: new Map(),
        sortedKeys: null,
        dirty: false
      }

      for (const [valueKey, ids] of Object.entries(snapshot.entries ?? {})) {
        index.entries.set(valueKey, new Set(ids))
        index.values.set(valueKey, rawValueOf(valueKey))
        for (const id of ids) {
          let owned = index.reverse.get(id)
          if (owned === undefined) {
            owned = new Set<string>()
            index.reverse.set(id, owned)
          }
          owned.add(valueKey)
        }
      }

      this.runtime.set(key, index)
    } catch (error: any) {
      throw DocuDBError.wrap(error, MCO_ERROR.INDEX.LOAD_ERROR, { collectionName })
    }
  }

  /**
   * Path of an index snapshot
   * @param collectionName - Collection name
   * @param fields - Indexed fields
   * @returns Absolute path
   * @private
   */
  private _indexPath (collectionName: string, fields: string[]): string {
    return path.join(
      this.dataDir,
      collectionName,
      '_indices',
      `${fields.join('+')}.idx`
    )
  }

  /**
   * Starts the background flush timer
   * @private
   */
  private _ensureTimer (): void {
    if (this.flushTimer !== null) return
    this.flushTimer = setInterval(() => {
      void this.flush().catch(() => undefined)
    }, this.flushInterval)
    this.flushTimer.unref?.()
  }
}

/**
 * Serializes a runtime index into the on-disk shape
 * @param index - Runtime index
 * @returns Serialized index
 */
function serializeIndex (index: RuntimeIndex): Index {
  const entries: Record<string, string[]> = {}
  for (const [valueKey, ids] of index.entries) {
    entries[valueKey] = [...ids]
  }

  return {
    fields: [...index.fields],
    field: index.isCompound ? [...index.fields] : index.fields[0],
    isCompound: index.isCompound,
    unique: index.unique,
    sparse: index.sparse,
    entries,
    metadata: {
      created: index.created.toISOString(),
      updated: index.updated.toISOString(),
      name: index.name
    }
  }
}

/**
 * Every document id of an index except the excluded ones
 * @param index - Runtime index
 * @param excluded - Ids to skip
 * @returns Remaining ids
 */
function allExcept (index: RuntimeIndex, excluded: Set<string>): string[] {
  const ids: string[] = []
  for (const bucket of index.entries.values()) {
    for (const id of bucket) {
      if (!excluded.has(id)) ids.push(id)
    }
  }
  return ids
}

export default IndexManager
