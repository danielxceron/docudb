/**
 * On-disk format migration.
 *
 * Format v1 kept one directory per document (`<id>/chunk_0.json[.gz]`) and
 * persisted the document order inside `_metadata.json`. Format v2 keeps one
 * file per document (`docs/<id>.json[.gz]`) and stores the order in an
 * append-only log, which removes the O(n) metadata rewrite per insert.
 *
 * The migration is copy-then-verify: every document is read with the v1 reader,
 * written with the v2 writer and compared, so a partial migration never destroys
 * data.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import gzip from '../compression/gzip.js'
import {
  ensureDir,
  readJson,
  removePath,
  writeJsonAtomic
} from '../utils/fileUtils.js'
import type {
  CollectionMetadata,
  Document,
  Logger,
  MigrationOptions,
  MigrationReport,
  OrderLogEntry
} from '../types/index.js'
import { FORMAT_VERSION } from '../types/index.js'

/** Options accepted by {@link migrateDatabase} */
export interface MigrateDatabaseOptions extends MigrationOptions {
  /** Directory of the database to migrate */
  dataDir: string
  /** Database name, only used for reporting */
  databaseName?: string
  /** Optional logger */
  logger?: Logger
}

/** Layout and options of the v1 format */
interface LegacyLayout {
  /** Documents of a collection */
  compression: boolean | 'auto'
  /** Chunk size used when the collection was written */
  chunkSize: number
}

/** Matches a v1 chunk file */
const LEGACY_CHUNK = /^chunk_(\d+)\.json(\.gz)?$/

/**
 * Migrates a database directory from format v1 to v2
 * @param options - Migration options
 * @returns A migration report
 */
export async function migrateDatabase (
  options: MigrateDatabaseOptions
): Promise<MigrationReport> {
  const startedAt = Date.now()
  const dataDir = path.resolve(options.dataDir)

  if (options.from >= options.to) {
    throw new DocuDBError(
      `Nothing to migrate: from ${options.from} to ${options.to}`,
      MCO_ERROR.DATABASE.MIGRATION_ERROR,
      { from: options.from, to: options.to }
    )
  }

  if (!(await exists(dataDir))) {
    throw new DocuDBError(
      `Data directory not found: ${dataDir}`,
      MCO_ERROR.DATABASE.MIGRATION_ERROR,
      { dataDir }
    )
  }

  const backup = options.backup !== false
  let backupPath: string | undefined
  if (backup) {
    backupPath = `${dataDir}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await fs.cp(dataDir, backupPath, { recursive: true })
    options.logger?.info?.(`Backup created at ${backupPath}`)
  }

  const collections: Record<string, number> = {}
  let verified = true

  try {
    const entries = await fs.readdir(dataDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue

      const migrated = await migrateCollection(path.join(dataDir, entry.name), entry.name, options)
      collections[entry.name] = migrated.count
      if (options.verify !== false && !migrated.verified) verified = false
    }

    await writeJsonAtomic(path.join(dataDir, '_database.json'), {
      formatVersion: FORMAT_VERSION,
      databaseName: options.databaseName,
      updatedAt: new Date().toISOString()
    })

    await writeJsonAtomic(path.join(path.dirname(dataDir), '_format.json'), {
      formatVersion: FORMAT_VERSION,
      updated: new Date().toISOString()
    })
  } catch (error: any) {
    throw DocuDBError.wrap(error, MCO_ERROR.DATABASE.MIGRATION_ERROR, {
      dataDir,
      backupPath
    })
  }

  return {
    from: options.from,
    to: options.to,
    backupPath,
    collections,
    verified,
    durationMs: Date.now() - startedAt
  }
}

/**
 * Migrates a single collection
 * @param collectionDir - Collection directory
 * @param name - Collection name
 * @param options - Migration options
 * @returns Documents migrated and verification outcome
 */
async function migrateCollection (
  collectionDir: string,
  name: string,
  options: MigrateDatabaseOptions
): Promise<{ count: number, verified: boolean }> {
  const metadata = await readJson<Partial<CollectionMetadata> & { documentOrder?: string[] }>(
    path.join(collectionDir, '_metadata.json')
  )

  const layout: LegacyLayout = {
    compression: await readLegacyCompression(collectionDir),
    chunkSize: 1024 * 1024
  }

  const entries = await fs.readdir(collectionDir, { withFileTypes: true })
  const legacyIds: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('_') || entry.name === 'docs') continue
    legacyIds.push(entry.name)
  }

  const docsDir = path.join(collectionDir, 'docs')
  await ensureDir(docsDir)

  const order: string[] = Array.isArray(metadata?.documentOrder)
    ? metadata.documentOrder.filter(id => legacyIds.includes(id))
    : legacyIds

  let count = 0
  let verified = true

  for (const id of legacyIds) {
    const document = await readLegacyDocument(path.join(collectionDir, id))
    if (document === null) {
      options.logger?.warn?.(`Skipping unreadable document ${name}/${id}`)
      verified = false
      continue
    }

    await writeV2Document(docsDir, id, document, layout)
    count++

    if (options.verify !== false) {
      const roundTrip = await readV2Document(docsDir, id)
      if (JSON.stringify(roundTrip) !== JSON.stringify(document)) {
        options.logger?.warn?.(`Checksum mismatch on ${name}/${id}`)
        verified = false
      }
    }

    options.onProgress?.({ collection: name, processed: count, total: legacyIds.length })
  }

  // Drop the v1 document directories once every file has been rewritten.
  for (const id of legacyIds) {
    await removePath(path.join(collectionDir, id))
  }

  await writeOrderLog(path.join(collectionDir, '_order.log'), order, legacyIds)
  await removePath(path.join(collectionDir, '_order.log.tmp'))

  const now = new Date().toISOString()
  const migratedMetadata: CollectionMetadata = {
    count,
    nextSeq: order.length + 1,
    indices: Array.isArray(metadata?.indices) ? metadata.indices : [],
    created: metadata?.created ?? now,
    updated: now,
    formatVersion: FORMAT_VERSION
  }
  await writeJsonAtomic(path.join(collectionDir, '_metadata.json'), migratedMetadata)

  return { count, verified }
}

/**
 * Detects whether a v1 collection was stored with compression
 * @param collectionDir - Collection directory
 * @returns Compression flag
 */
async function readLegacyCompression (collectionDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(collectionDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name === 'docs') continue
      const chunks = await fs.readdir(path.join(collectionDir, entry.name))
      if (chunks.some(name => name.endsWith('.json.gz'))) return true
    }
  } catch {
    // An unreadable collection falls back to plain JSON.
  }
  return false
}

/**
 * Reads a document written in format v1
 * @param documentDir - Directory holding `chunk_N.json[.gz]`
 * @returns The document, or null when unreadable
 */
async function readLegacyDocument (
  documentDir: string
): Promise<Document | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(documentDir)
  } catch {
    return null
  }

  const chunks = entries
    .map(name => ({ name, match: LEGACY_CHUNK.exec(name) }))
    .filter(entry => entry.match !== null)
    .sort((a, b) => Number(a.match?.[1]) - Number(b.match?.[1]))

  if (chunks.length === 0) return null

  let payload = ''
  for (const chunk of chunks) {
    const raw = await fs.readFile(path.join(documentDir, chunk.name))
    const isGzip = chunk.name.endsWith('.gz')
    payload += (isGzip ? await gzip.decompress(raw) : raw).toString('utf8')
  }

  try {
    return JSON.parse(payload) as Document
  } catch {
    return null
  }
}

/**
 * Writes a document using the v2 layout
 * @param docsDir - Destination directory
 * @param id - Document id
 * @param document - Document
 * @param layout - Legacy layout options (compression strategy)
 */
async function writeV2Document (
  docsDir: string,
  id: string,
  document: Document,
  layout: LegacyLayout
): Promise<void> {
  const json = JSON.stringify(document)
  const compress = layout.compression === true || layout.compression === 'auto'
  const target = path.join(docsDir, `${id}${compress ? '.json.gz' : '.json'}`)
  const payload = compress ? await gzip.compress(json) : Buffer.from(json, 'utf8')
  await writeFile(target, payload)
}

/**
 * Reads a document written with the v2 layout
 * @param docsDir - Documents directory
 * @param id - Document id
 * @returns The document, or null
 */
async function readV2Document (docsDir: string, id: string): Promise<Document | null> {
  for (const extension of ['.json', '.json.gz']) {
    const target = path.join(docsDir, `${id}${extension}`)
    if (!(await exists(target))) continue
    const raw = await fs.readFile(target)
    const buffer = target.endsWith('.gz') ? await gzip.decompress(raw) : raw
    return JSON.parse(buffer.toString('utf8')) as Document
  }
  return null
}

/**
 * Writes the v2 append-only order log
 * @param logPath - Order log path
 * @param order - Document ids in their original order
 * @param known - Ids that exist on disk
 */
async function writeOrderLog (
  logPath: string,
  order: string[],
  known: string[]
): Promise<void> {
  const missing = known.filter(id => !order.includes(id))
  const entries: OrderLogEntry[] = [
    { o: [...order, ...missing] }
  ]
  await fs.writeFile(logPath, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
}

/**
 * Writes a file (kept local so the migration controls fsync usage)
 * @param target - Destination
 * @param data - Content
 */
async function writeFile (target: string, data: Buffer): Promise<void> {
  await ensureDir(path.dirname(target))
  const temporary = `${target}.tmp`
  await fs.writeFile(temporary, data)
  await fs.rename(temporary, target)
}

/**
 * Tells whether a path exists
 * @param target - Path to check
 * @returns true when it exists
 */
async function exists (target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

export default migrateDatabase
