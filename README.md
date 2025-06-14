# DocuDB

[![npm version](https://img.shields.io/npm/v/docudb.svg)](https://www.npmjs.com/package/docudb)

## Overview

DocuDB is a lightweight, document-based NoSQL database for Node.js applications. It provides a MongoDB-like interface with zero external dependencies, making it perfect for small to medium-sized projects or environments where a full database installation is not feasible.

## Features

- **Document-Based Storage**: Store and retrieve JSON documents with automatic ID generation
- **Schema Validation**: Define schemas to validate document structure and data types
- **Indexing**: Create and manage indexes for faster queries
- **Query System**: Powerful query capabilities with MongoDB-like syntax
- **Compression**: Optional gzip compression to reduce storage size
- **Chunking**: Efficient handling of large documents through chunking
- **UUID Support**: Choose between MongoDB-style IDs or UUID v4 format
- **Custom Default Functions**: Define dynamic default values using custom functions
- **TypeScript Support**: Full TypeScript definitions for enhanced developer experience
- **Zero Dependencies**: No external runtime dependencies

## Installation

```bash
npm install docudb
```

## Basic Usage

```typescript
import { Database, Schema } from 'docudb';

// Initialize database
const db = new Database({ 
  name: 'myDatabase',
  compression: true
});

await db.initialize();

// Create a collection with schema
const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number', default: 0 },
  createdAt: { type: 'date', default: () => new Date() }
});

const users = db.collection('users', { schema: userSchema });

// Insert a document
const user = await users.insertOne({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

console.log('Inserted user:', user);

// Query documents
const results = await users.find({ age: { $gt: 25 } });
console.log('Users over 25:', results);

// Update a document
const updated = await users.updateById(user._id, {
  $set: { age: 31 }
});

// Delete a document
await users.deleteById(user._id);
```

## Configuration Options

### Database Options

```typescript
const db = new Database({
  name: 'myDatabase',       // Database name (default: 'docudb')
  dataDir: './data',        // Data directory (default: './data')
  chunkSize: 2 * 1024 * 1024, // Chunk size in bytes (default: 1MB)
  compression: true,        // Enable compression (default: true)
  idType: 'uuid'            // ID generation type: 'mongo' or 'uuid' (default: 'mongo')
});
```

### Collection Options

```typescript
const collection = db.collection('myCollection', {
  schema: mySchema,         // Schema for validation
  idType: 'uuid',           // Override database ID type
  timestamps: true          // Add createdAt and updatedAt fields automatically
});
```

## Schema Validation

DocuDB supports schema validation to ensure data integrity:

```typescript
const productSchema = new Schema({
  name: { 
    type: 'string', 
    required: true,
    validate: { minLength: 3 }
  },
  price: { 
    type: 'number', 
    required: true,
    validate: { min: 0 }
  },
  tags: { 
    type: 'array', 
    default: [] 
  },
  inStock: { 
    type: 'boolean', 
    default: true 
  },
  metadata: { 
    type: 'object', 
    default: {} 
  }
});
```

### Pattern Validation

You can use regular expressions to validate string formats:

```typescript
const userSchema = new Schema({
  email: {
    type: 'string',
    required: true,
    validate: {
      pattern: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
      message: 'Invalid email format'
    }
  },
  phone: {
    type: 'string',
    validate: {
      pattern: /^\+?[1-9]\d{1,14}$/,  // E.164 format
      message: 'Phone number must be in international format'
    }
  },
  username: {
    type: 'string',
    required: true,
    validate: {
      pattern: /^[a-z0-9_-]{3,16}$/,
      message: 'Username must be 3-16 characters and contain only letters, numbers, underscores or hyphens'
    }
  },
  productCode: {
    type: 'string',
    validate: {
      // Custom product code format: ABC-12345
      pattern: /^[A-Z]{3}-\d{5}$/,
      message: 'Product code must be in format: ABC-12345'
    }
  }
});

// Combining pattern validation with other validations
const advancedSchema = new Schema({
  url: {
    type: 'string',
    validate: {
      pattern: /^https?:\/\/[\w\.-]+\.[a-z]{2,}\/?.*$/,
      minLength: 10,
      maxLength: 2048,
      message: 'Invalid URL format'
    }
  },
  zipCode: {
    type: 'string',
    validate: {
      // Support multiple country formats with conditional validation
      custom: (value, doc) => {
        if (doc.country === 'US') {
          return /^\d{5}(-\d{4})?$/.test(value) || 'Invalid US zip code';
        } else if (doc.country === 'CA') {
          return /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/.test(value) || 'Invalid Canadian postal code';
        }
        return true;
      }
    }
  }
});
```

## Custom Default Functions

You can define dynamic default values using custom functions:

```typescript
const schema = new Schema({
  createdAt: {
    type: 'date',
    default: () => new Date()
  },
  code: {
    type: 'string',
    // Generate a code based on the document
    default: (doc) => `PROD-${doc.name.substring(0, 3).toUpperCase()}-${Math.floor(Math.random() * 1000)}`
  }
});
```

## UUID Support

DocuDB supports both MongoDB-style IDs and UUID v4 format:

```typescript
// Collection with UUID IDs
const products = db.collection('products', { idType: 'uuid' });

// Insert a document (will have UUID v4 _id)
const product = await products.insertOne({
  name: 'Laptop',
  price: 999
});

// You can also provide your own UUID
const customProduct = await products.insertOne({
  _id: '123e4567-e89b-42d3-a456-556642440000', // Valid UUID v4
  name: 'Custom ID Product',
  price: 599
});
```

## Query Operations

DocuDB supports MongoDB-like query operations:

```typescript
// Find all documents
const allProducts = await products.find({});

// Find with conditions
const expensiveProducts = await products.find({ 
  price: { $gt: 500 },
  inStock: true
});

// Find one document
const laptop = await products.findOne({ name: 'Laptop' });

// Find by ID
const product = await products.findById('123e4567-e89b-42d3-a456-556642440000');

// Count documents
const count = await products.count({ price: { $lt: 100 } });
```

## Update Operations

```typescript
// Update by ID
const updated = await products.updateById(productId, {
  $set: { price: 899, inStock: false }
});

// Update one document
const result = await products.updateOne(
  { name: 'Laptop' },
  { $inc: { stock: -1 } }
);

// Update many documents
const result = await products.updateMany(
  { category: 'Electronics' },
  { $set: { discount: 10 } }
);
```

## Delete Operations

DocuDB provides several methods for deleting documents from your collections. This section covers all available delete operations with practical examples.

### Available Delete Methods

`deleteById(id)` `deleteOne(filter)` `deleteMany(filter)`

```typescript
// Insert a document first
const product = await products.insertOne({
  name: 'Headphones',
  price: 50,
  stock: 10
});

// Delete the document by its ID
const deleted = await products.deleteById(product._id);
console.log(deleted); // true

// Verify deletion
const found = await products.findById(product._id);
console.log(found); // null

await products.insertMany([
  { name: 'Mouse', price: 20, stock: 10 },
  { name: 'Keyboard', price: 50, stock: 8 },
  { name: 'Monitor', price: 150, stock: 3 }
]);

// Delete the first document matching the criteria
const deleted = await products.deleteOne({ name: 'Mouse' });
console.log(deleted); // true

// Check remaining count
const count = await products.count();
console.log(count); // 2 (only Mouse was deleted)

// Delete all products with price >= 50
const deletedCount = await products.deleteMany({ 
  price: { $gte: 50 } 
});
console.log(deletedCount); // 2 (Keyboard, Monitor)
```

## Indexing

Create indexes to improve query performance:

```typescript
// Create a simple index
await products.createIndex('name');

// Create a unique index
await products.createIndex('name', { unique: true });

// Create a compound index
await products.createIndex(['category', 'brand'], { 
  name: 'category_brand_idx'
});
```

## Error Handling

DocuDB provides detailed error information:

```typescript
try {
  await products.insertOne({
    name: 'Invalid Product',
    price: 'not-a-number' // Schema violation
  });
} catch (error) {
  if (error.code === 'SCHEMA_VALIDATION_ERROR') {
    console.error('Validation error:', error.details);
  } else {
    console.error('Database error:', error.message);
  }
}
```

## License

MIT