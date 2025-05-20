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

- Node.js >= 14.14.1

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
import { Database, Schema } from 'docudb';

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
- `default`: Default value if not provided. Can be a static value or a function
- `validate`: Validation rules (min, max, minLength, maxLength, pattern, enum, custom function)

**Format Validation with Regular Expressions:**

You can use the `pattern` property to validate string fields against regular expression patterns:

```javascript
const schema = new Schema({
  email: { 
    type: 'string', 
    required: true,
    validate: { 
      pattern: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/ // Email pattern validation
    }
  },
  customId: {
    type: 'string',
    validate: {
      pattern: /^PROD-\d{4}$/ // Validate ID pattern (e.g., PROD-1234)
    }
  }
});
```

**Custom Default Functions:**

You can use functions as default values, which will be executed when a document is created:

```javascript
const schema = new Schema({
  createdAt: { 
    type: 'date', 
    default: () => new Date() 
  },
  code: { 
    type: 'string',
    // The function receives the document being processed
    default: (doc) => `PROD-${doc.name.substring(0, 3).toUpperCase()}-${Math.floor(Math.random() * 1000)}` 
  },
  // You can even customize the _id field
  _id: {
    type: 'string',
    default: () => generateUUID(), // Or any custom ID generation logic
    validate: {
      pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/ // UUID v4 pattern
    }
  }
});
```

**Schema Options:**
- `strict`: Reject fields not in the schema (default: true)
- `timestamps`: Automatically add _createdAt and _updatedAt fields (default: false)

**Collection Options:**
- `schema`: Schema for document validation
- `idType`: ID format to use ('uuid' for UUID v4, default: MongoDB-style IDs)

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