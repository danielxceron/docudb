/**
* DocuDB - Document-based NoSQL database for NodeJS
* No external dependencies, with support for chunks, gz compression,
* schemas, filter queries, and indexing
* Now with UUID v4 support and custom default functions
* Full TypeScript support with detailed type definitions
*/

import Database from './src/core/database.js'
import Schema from './src/schema/schema.js'
import Query from './src/query/query.js'
import { MCO_ERROR, DocuDBError } from './src/errors/errors.js'
import { generateUUID, isValidUUID, isValidID } from './src/utils/uuidUtils.js'
import {
  // Core interfaces
  DatabaseOptions,
  StorageOptions,
  CollectionOptions,
  CollectionMetadata,
  Document,
  IndexDefinition,

  // Schema interfaces
  SchemaDefinition,
  SchemaOptions,
  SchemaFieldDefinition,
  ValidationRules,

  // Query interfaces
  QueryCriteria,
  SortOptions,
  SelectFields,

  // Operation interfaces
  UpdateOperations,
  FindOptions,

  // Result interfaces
  UpdateResult,
  DeleteResult,
  InsertResult
} from './src/types/index.js'

export {
  // Main classes
  Database,
  Schema,
  Query,

  // Error handling
  MCO_ERROR,
  DocuDBError,

  // UUID utilities
  generateUUID,
  isValidUUID,
  isValidID,

  // Type definitions
  DatabaseOptions,
  StorageOptions,
  CollectionOptions,
  CollectionMetadata,
  Document,
  IndexDefinition,
  SchemaDefinition,
  SchemaOptions,
  SchemaFieldDefinition,
  ValidationRules,
  QueryCriteria,
  SortOptions,
  SelectFields,
  UpdateOperations,
  FindOptions,
  UpdateResult,
  DeleteResult,
  InsertResult
}
