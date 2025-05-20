/**
* DocuDB - Document-based NoSQL database for NodeJS
* No external dependencies, with support for chunks, gz compression,
* schemas, filter queries, and indexing
* Now with UUID v4 support and custom default functions
*/

import Database from './src/core/database.js'
import Schema from './src/schema/schema.js'
import Query from './src/query/query.js'
import { MCO_ERROR, DocuDBError } from './src/errors/errors.js'
import { generateUUID, isValidUUID, isValidID } from './src/utils/uuidUtils.js'

export {
  Database,
  Schema,
  Query,
  MCO_ERROR,
  DocuDBError,
  // UUID utilities
  generateUUID,
  isValidUUID,
  isValidID
}
