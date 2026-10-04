/**
 * Common file system helpers.
 *
 * All writes that must not leave a half written file behind go through
 * `writeFileAtomic` (temporary file + rename), which is safe on POSIX and on
 * Windows for existing targets.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import { KeyedMutex } from './mutex.js'

/** Counter making temporary file names unique inside a process */
let temporaryCounter = 0

/**
 * Serializes writes per destination path.
 *
 * Windows refuses to rename onto a file that another handle still holds open,
 * so concurrent writers to the same file must be queued instead of racing.
 */
const writeMutex = new KeyedMutex()

/** Number of rename attempts when the target is transiently locked */
const RENAME_ATTEMPTS = 8

/**
 * Checks if a file or directory exists
 * @param filePath - Path of the file or directory to check
 * @returns true when it exists
 */
export async function fileExists (filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath)
    return true
  } catch (error: any) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Creates a directory and all of its missing parents
 * @param dir - Directory to create
 */
export async function ensureDir (dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

/**
 * Writes a file atomically: unique temporary file, optional fsync, then rename.
 *
 * The temporary name is unique so that concurrent writers never fight over the
 * same staging file; the final rename is atomic, so readers only ever observe a
 * complete file.
 * @param filePath - Destination file
 * @param data - Content to write
 * @param options - `mode` for the file and `fsync` to force durability
 */
export async function writeFileAtomic (
  filePath: string,
  data: string | Buffer,
  options: { mode?: number, fsync?: boolean } = {}
): Promise<void> {
  return writeMutex.withLock(path.resolve(filePath), async () => {
    const tmpPath = `${filePath}.${process.pid}.${temporaryCounter++}.${crypto.randomBytes(4).toString('hex')}.tmp`

    let handle: fs.promises.FileHandle | undefined
    try {
      handle = await fs.promises.open(tmpPath, 'w', options.mode ?? 0o644)
      await handle.writeFile(data)
      if (options.fsync === true) {
        await handle.sync()
      }
      await handle.close()
      handle = undefined
      await renameWithRetry(tmpPath, filePath)
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined)
      }
      await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined)
      throw new DocuDBError(
        `Error writing file: ${filePath}`,
        MCO_ERROR.STORAGE.WRITE_ERROR,
        { filePath, originalError: error },
        { cause: error }
      )
    }
  })
}

/**
 * Renames a file retrying while the destination is transiently locked
 * @param from - Source path
 * @param to - Destination path
 */
async function renameWithRetry (from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(from, to)
      return
    } catch (error: any) {
      const transient = error.code === 'EPERM' ||
        error.code === 'EBUSY' ||
        error.code === 'EACCES'
      if (!transient || attempt >= RENAME_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)))
    }
  }
}

/**
 * Reads and parses a JSON file
 * @param filePath - File to read
 * @returns The parsed content, or null when the file does not exist
 */
export async function readJson<T> (filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error: any) {
    if (error.code === 'ENOENT') return null
    throw new DocuDBError(
      `Error reading JSON file: ${filePath}`,
      MCO_ERROR.STORAGE.READ_ERROR,
      { filePath, originalError: error },
      { cause: error }
    )
  }
}

/**
 * Writes a JSON file atomically and compactly (no pretty printing)
 * @param filePath - Destination file
 * @param value - Value to serialize
 */
export async function writeJsonAtomic (filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value))
}

/**
 * Appends a line to a file, creating it when missing
 * @param filePath - Destination file
 * @param line - Line to append (a newline is added automatically)
 */
export async function appendLine (filePath: string, line: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await fs.promises.appendFile(filePath, `${line}\n`, 'utf8')
}

/**
 * Reads a newline delimited JSON file
 * @param filePath - File to read
 * @returns Parsed entries, skipping malformed lines
 */
export async function readLines<T> (filePath: string): Promise<T[]> {
  let raw: string
  try {
    raw = await fs.promises.readFile(filePath, 'utf8')
  } catch (error: any) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const entries: T[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      entries.push(JSON.parse(trimmed) as T)
    } catch {
      // A partially written last line is expected after a crash: skip it.
    }
  }
  return entries
}

/**
 * Removes a path recursively, ignoring missing entries
 * @param target - File or directory to remove
 */
export async function removePath (target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true })
}

export default {
  fileExists,
  ensureDir,
  writeFileAtomic,
  writeJsonAtomic,
  readJson,
  appendLine,
  readLines,
  removePath
}
