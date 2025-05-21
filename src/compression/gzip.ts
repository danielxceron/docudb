/**
 * Compression/decompression module using Node.js zlib
 * Provides functions to compress and decompress data
 */

import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { MCO_ERROR, DocuDBError } from '../errors/errors.js'

// Convert callback functions to promises
const gzipPromise = promisify(zlib.gzip)
const gunzipPromise = promisify(zlib.gunzip)

/**
 * Compresses data using gzip
 * @param {Buffer|string} data - Data to compress
 * @returns {Promise<Buffer>} - Compressed data
 */
async function compress (data: Buffer | string): Promise<Buffer> {
  try {
    return await gzipPromise(data)
  } catch (error: any) {
    throw new DocuDBError(`Error compressing data: ${error.message}`, MCO_ERROR.COMPRESSION.COMPRESS_ERROR, { originalError: error })
  }
}

/**
 * Decompresses gzip compressed data
 * @param {Buffer} compressedData - Compressed data
 * @returns {Promise<Buffer>} - Decompressed data
 */
async function decompress (compressedData: Buffer): Promise<Buffer> {
  try {
    return await gunzipPromise(compressedData)
  } catch (error: any) {
    throw new DocuDBError(`Error decompressing data: ${error.message}`, MCO_ERROR.COMPRESSION.COMPRESS_ERROR, { originalError: error })
  }
}

export default {
  compress,
  decompress
}
