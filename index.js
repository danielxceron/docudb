/**
* DocuDB - Document-based NoSQL database for NodeJS
* No external dependencies, with support for chunks, gz compression,
* schemas, filter queries, and indexing
*/

const Database = require('./src/core/database')
const Schema = require('./src/schema/schema')
const Query = require('./src/query/query')
const { MCO_ERROR, DocuDBError } = require('./src/errors/errors')

module.exports = {
  Database,
  Schema,
  Query,
  MCO_ERROR,
  DocuDBError
}
