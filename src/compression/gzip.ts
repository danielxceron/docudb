/**
 * Compression module based on Node.js zlib.
 * Provides gzip compression with a configurable level and no dependencies.
 */

import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'

const gzipPromise = promisify(zlib.gzip)
const gunzipPromise = promisify(zlib.gunzip)

/** Default gzip level (zlib default) */
export const DEFAULT_COMPRESSION_LEVEL = 6

/**
 * Compresses data with gzip
 * @param data - Data to compress
 * @param level - Compression level (0-9)
 * @returns The compressed payload
 */
export async function compress (
  data: Buffer | string,
  level: number = DEFAULT_COMPRESSION_LEVEL
): Promise<Buffer> {
  try {
    return await gzipPromise(data, { level })
  } catch (error: any) {
    throw new DocuDBError(
      `Error compressing data: ${(error as Error).message}`,
      MCO_ERROR.COMPRESSION.COMPRESS_ERROR,
      { originalError: error },
      { cause: error }
    )
  }
}

/**
 * Decompresses gzip data
 * @param compressedData - Compressed payload
 * @returns The original payload
 */
export async function decompress (compressedData: Buffer): Promise<Buffer> {
  try {
    return await gunzipPromise(compressedData)
  } catch (error: any) {
    throw new DocuDBError(
      `Error decompressing data: ${(compressedDataError(error)).message}`,
      MCO_ERROR.COMPRESSION.DECOMPRESS_ERROR,
      { originalError: error },
      { cause: error }
    )
  }
}

/**
 * Formats a decompression failure with a hint about a compression mismatch
 * @param error - Original error
 * @returns Error message
 * @private
 */
function compressedDataError (error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('incorrect header check')) {
    return new Error(
      `${message} (the chunk is not gzip data: check the "compression" option)`
    )
  }
  return error instanceof Error ? error : new Error(message)
}

export default {
  compress,
  decompress,
  DEFAULT_COMPRESSION_LEVEL
}
