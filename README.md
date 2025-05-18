# DocuDB

A lightweight, document-based NoSQL database for NodeJS with no external dependencies.

## Features

- **Document-based storage**: Store and retrieve JSON documents
- **Schema validation**: Define document structures with validation rules
- **Indexing**: Create single-field and composite indexes for faster queries
- **Unique constraints**: Enforce data integrity with unique field constraints
- **Query filtering**: Filter documents using MongoDB-like query syntax
- **Chunked storage**: Efficiently handle large datasets with data chunking
- **Compression**: Optional gzip compression to reduce storage size
- **Concurrency support**: Handle multiple concurrent operations
- **Data persistence**: Reliable data storage that persists across restarts
- **Error handling**: Comprehensive error handling and validation

## Requirements

- Node.js >= 12.0.0

## Installation

```bash
npm install docudb
```

Or add it to your project:

```bash
npm install --save docudb
```

## Quick Start

```javascript
const { Database, Schema } = require('docudb');

// Create and initialize a database
const db = new Database({
  name: 'myDatabase',
  compression: true // Enable compression
});

await db.initialize();

// Define a schema for your collection
const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number', validate: { min: 18 } },
  createdAt: { type: 'date', default: new Date() }
}, { strict: true });

// Create a collection with the schema
const users = db.collection('users', { schema: userSchema });

// Create a unique index on email field
await users.createIndex('email', { unique: true });

// Insert a document
const user = await users.insertOne({
  name: 'John Doe',
  email: 'john@example.com',
  age: 25
});

// Find documents
const allUsers = await users.find({});
const johnUser = await users.findOne({ name: 'John Doe' });
const adultUsers = await users.find({ age: { $gte: 21 } });

// Update a document
const updatedUser = await users.updateById(user._id, {
  $set: { age: 26 }
});

// Delete a document
await users.deleteById(user._id);
```

## API Reference

### Database

```javascript
const db = new Database(options);
```

**Options:**
- `name`: Database name (default: 'docudb')
- `dataDir`: Directory to store data (default: './data/{name}')
- `chunkSize`: Maximum chunk size in bytes (default: 1MB)
- `compression`: Enable/disable compression (default: true)

**Methods:**
- `initialize()`: Initialize the database
- `collection(name, options)`: Get or create a collection
- `dropCollection(name)`: Delete a collection
- `listCollections()`: List all collections

### Collection

**Methods:**
- `insertOne(document)`: Insert a single document
- `insertMany(documents)`: Insert multiple documents
- `find(query)`: Find documents matching the query
- `findOne(query)`: Find the first document matching the query
- `findById(id)`: Find a document by its ID
- `updateOne(query, update)`: Update the first document matching the query
- `updateMany(query, update)`: Update all documents matching the query
- `updateById(id, update)`: Update a document by its ID
- `deleteMany(query)`: Delete all documents matching the query
- `deleteById(id)`: Delete a document by its ID
- `count(query)`: Count documents matching the query

### Indexes

**Methods:**
- `createIndex(field, options)`: Create an index on a field or fields
- `dropIndex(field)`: Delete an index
- `listIndexes()`: List all indexes in the collection

**Index Options:**
- `unique`: Whether the index should enforce uniqueness (default: false)
- `name`: Custom name for the index

### Schema

```javascript
const schema = new Schema(definition, options);
```

**Field Definition Properties:**
- `type`: Data type ('string', 'number', 'boolean', 'date', 'object', 'array')
- `required`: Whether the field is required (default: false)
- `default`: Default value if not provided
- `validate`: Validation rules (min, max, pattern, etc.)

**Schema Options:**
- `strict`: Reject fields not in the schema (default: true)
- `timestamps`: Automatically add createdAt and updatedAt fields (default: false)

## Error Handling

DocuDB provides a comprehensive error handling system with specific error codes and messages:

```javascript
const { MCO_ERROR, DocuDBError } = require('docudb');

try {
  // Database operations
} catch (error) {
  if (error instanceof DocuDBError) {
    console.error(`Error code: ${error.code}, Message: ${error.message}`);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Testing

Run the test suite:

```bash
npm test
```

Run linting:

```bash
npm run lint
```

## License

MIT