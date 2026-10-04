# DocuDB

> 🇬🇧 **English** · 🇪🇸 [Español](README.es.md)

[![npm version](https://img.shields.io/npm/v/docudb.svg)](https://www.npmjs.com/package/docudb)
[![CI](https://img.shields.io/actions/workflow/status/danielxceron/DocuDB/ci.yml?label=CI&style=flat-square)](https://github.com/danielxceron/DocuDB/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE.txt)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-success)](#features)
[![node](https://img.shields.io/badge/node-%3E%3D22.15-5FA04E)](https://nodejs.org)

**Embedded** NoSQL document database for Node.js. MongoDB-like API, **zero runtime dependencies**, local file storage, atomic writes and a versioned on-disk format.

> **TL;DR** — `npm install docudb`, define a schema, insert JSON documents and query them with syntax you already know. No server, no `docker-compose`, no configuration.

---

## When to use DocuDB

| Use it when… | Don't use it when… |
|---|---|
| You need persistence **without infrastructure** | You need several processes or servers writing at once |
| You work in **a single Node.js process** | You need replicas, partitioning or high write concurrency |
| The dataset fits in tens or hundreds of thousands of documents | The dataset weighs several GB or needs analytical queries |
| You want **static typing** for your documents | You need distributed transactions or high availability |
| You are building a prototype, a CLI or a desktop app | You need full-text search |

DocuDB is a **single-process** database. Read [Limits and performance](#limits-and-performance) before deciding.

---

## Use cases

### 1. Desktop apps and CLIs (offline by design)
Electron, Tauri, VS Code extensions or any CLI need to store preferences, cache or state without depending on a server. DocuDB writes to the user's data directory and works without a network.

```typescript
const db = new Database({ name: 'app', dataDir: userDataDir })
const settings = db.collection('settings', { schema: settingsSchema })
await settings.updateById('theme', { $set: { value: 'dark' } })
```

### 2. Prototypes and MVPs in minutes
Replace SQLite or a docker-compose MongoDB while you validate the idea. Migrating later means rewriting the access layer.

### 3. Automated tests without mocks or containers
Every suite spins up its own database in a temporary directory: no Docker, no shared databases, no leftover state.

```typescript
beforeEach(async () => {
  const db = new Database({ name: 'test', dataDir: await mkdtemp(join(tmpdir(), 'db-')) })
  await db.initialize()
  users = db.collection<User>('users', { schema: userSchema })
})
afterEach(async () => db.close())
```

### 4. Outbox pattern: local buffering before sending
Events, telemetry or notifications are written to disk first and a later worker drains them to your backend. If the remote service goes down, nothing is lost.

```typescript
const outbox = db.collection('outbox')
await outbox.insertMany(events)                 // fast, no network
setInterval(() => flushToRemote(outbox), 5_000)
```

### 5. Local caches and job queues
Pending jobs, computation results, feature flags or memoized responses: all with indexed queries instead of an in-memory `Map` that is lost on restart.

### 6. IoT, kiosks and Raspberry Pi
No database server in the field, no system dependencies, and a file format you can back up with `tar` or `rsync`.

### 7. Education: building a database from scratch
Chunking, indexes, compression, validation schemas, concurrency control and a MongoDB-like query engine in roughly 4 000 lines of readable TypeScript.

### 8. Versionable configuration
Keep settings, feature flags or reference data in files you can commit to Git and diff meaningfully.

### 9. Personal apps
Notes, recipes, finances, a library or habit trackers: structured data with validation, no administration, no account, no cloud.

### 10. Offline-first and edge
On devices with intermittent connectivity, DocuDB is the local layer; synchronizing with the server is up to you.

### 11. ETL staging
Drain transformations into an intermediate collection before loading them into the destination, with schema validation and control queries.

### 12. Server sidecars and teaching storage
Show chunking, compression, indexes and concurrency without configuring anything external.

---

## Features

- **JSON documents** with an automatic Mongo-style `_id` (12 bytes) or **UUID v4**
- **Schemas** with types, required fields, default values (including functions and async validators), `transform`, `enum`, `pattern`, `min`/`max`, `minLength`/`maxLength` and custom validators
- **MongoDB-like queries**: `$eq $ne $gt $gte $lt $lte $in $nin $exists $regex $size $all $elemMatch $type` + `$and $or $nor $not`, with dot notation
- **Sorting, skipping, limiting and projection** of results
- **Indexes**: simple, compound, unique and sparse, covering equality, ranges and sets, plus `explain()`
- **Batch operations**: `insertMany`, `bulkWrite`, `updateMany`, `deleteMany`
- **Aggregation** with `$match $project $group $sort $skip $limit $count $unwind`
- **gzip compression** (`true` / `false` / `'auto'`) and automatic **chunking**
- **Atomic writes** (temporary file + `rename`) and verified **format migration**
- **TypeScript** end to end, with generics per collection
- **ESM and CommonJS**, with zero runtime dependencies

---

## Installation

```bash
npm install docudb
```

Requires **Node.js ≥ 18**. Works with both `import` and `require`.

```typescript
import { Database } from 'docudb'   // ESM
const { Database } = require('docudb') // CommonJS
```

---

## Quick start

```typescript
import { Database, Schema } from 'docudb'

const db = new Database({ name: 'myDatabase', compression: true })
await db.initialize()

const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true, validate: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ } },
  age: { type: 'number', default: 0, validate: { min: 0, max: 130 } },
  createdAt: { type: 'date', default: () => new Date() }
})

const users = db.collection('users', { schema: userSchema })

const user = await users.insertOne({ name: 'Ada Lovelace', email: 'ada@example.com', age: 36 })
const adults = await users.find({ age: { $gte: 18 } }, { sort: { age: -1 }, limit: 10 })

await users.updateById(user._id, { $set: { age: 37 } })
await users.deleteById(user._id)

await db.close()   // flushes buffers and releases the database
```

### Typed collections

```typescript
interface User { name: string; email: string; age: number }

const users = db.collection<User>('users')
await users.insertOne({ name: 'Ada', email: 'ada@example.com', age: 36 })
const adults = await users.find({ age: { $gte: 18 } })
```

You can also derive the type from a schema with `InferSchema<typeof definition>`.

---

## Configuration

### Database

```typescript
const db = new Database({
  name: 'myDatabase',        // logical name (validated against an allowlist)
  dataDir: './data',         // root directory; the database lives in <dataDir>/<name>
  chunkSize: 1024 * 1024,    // 1 MiB: maximum size per chunk
  compression: true,         // true | false | 'auto'
  idType: 'mongo',           // 'mongo' | 'uuid'
  cacheSize: 1000,           // documents in the LRU cache
  flushInterval: 0,          // >0 groups metadata writes every N ms
  fileLock: false,           // true prevents another process from opening the directory
  logger: undefined          // the library never writes to the console on its own
})
await db.initialize()
```

### Collection

```typescript
const orders = db.collection('orders', {
  schema: orderSchema,
  idType: 'uuid',
  timestamps: true   // adds createdAt / updatedAt
})
```

### Orderly shutdown

```typescript
await db.flush()   // writes pending changes without closing
await db.close()   // flush + releases timers and the lock file
```

`flushInterval: 0` (the default) writes every change: maximum durability. A higher value batches metadata writes, which speeds up bulk inserts considerably; in that case **always call `close()`** when you are done.

---

## Schemas and validation

```typescript
const productSchema = new Schema({
  name:   { type: 'string', required: true, validate: { minLength: 3, maxLength: 120 } },
  sku:    { type: 'string', required: true, validate: { pattern: /^[A-Z]{3}-\d{5}$/ } },
  price:  { type: 'number', required: true, validate: { min: 0 } },
  status: { type: 'string', default: 'draft', validate: { enum: ['draft', 'active'] } },
  tags:   { type: 'array', default: [] },
  meta:   { type: 'object', default: {} },
  email: {
    type: 'string',
    validate: {
      custom: async (value, doc) => isKnownEmail(value) || `Invalid email in ${doc.name}`
    }
  }
})
```

- `strict: true` (`false` by default) rejects fields that are not declared.
- `default` values can be functions that receive the document: `default: (doc) => ...`.
- Mutable default values (`[]`, `{}`) are cloned per document.
- `validate()` is synchronous; `validateAsync()` awaits async validators. `Collection` always uses the async version.

### Supported types

`string`, `number`, `int`, `boolean`, `date`, `object`, `array`, `null`.

---

## Queries

```typescript
await users.find({})                                  // everything
await users.find({ age: { $gt: 25 } })                // comparators
await users.find({ tags: 'premium' })                  // one element of an array
await users.find({ 'address.city': 'Lima' })           // nested fields
await users.find({ $or: [{ age: { $lt: 18 } }, { vip: true }] })
await users.find({ name: { $regex: '^ada', $options: 'i' } })
await users.find({ 'items': { $elemMatch: { qty: { $gte: 5 } } } })

await users.find({ age: { $gte: 18 } }, {
  sort: { age: -1 },
  skip: 0,
  limit: 20,
  projection: { name: 1, email: 1 }    // only those fields (+ _id)
})

await users.findOne({ email: 'ada@example.com' })
await users.findById(id)
await users.countDocuments({ vip: true })
await users.distinct('city')
```

You can also build a `Query` by hand and pass it to `find()`:

```typescript
import { Query } from 'docudb'

const query = new Query({ age: { $gte: 18 } }).sort({ age: -1 }).limit(10).select(['name'])
await users.find(query)
```

---

## Indexes

```typescript
await users.createIndex('email', { unique: true })
await users.createIndex(['lastName', 'firstName'])   // compound index
await users.createIndex('age', { sparse: true })
await users.createIndexes([{ field: 'email' }, { field: 'city' }])

await users.listIndexes()
await users.dropIndex('email')
await users.dropIndexes()
```

An index answers equality (`$eq`), sets (`$in`, `$nin`), ranges (`$gt`, `$gte`, `$lt`, `$lte`), negations (`$ne`, `$nin`) and prefixes of compound indexes. You can verify this with `explain()`:

```typescript
await users.explain({ email: 'ada@example.com' })
// {
//   usedIndex: true,
//   index: 'users:email',
//   keysScanned: 1,
//   docsFetched: 1,
//   docsExamined: 1,
//   plan: 'IXSCAN users:email'
// }
```

A `unique` index throws `MCO_ERROR.INDEX.UNIQUE_VIOLATION` and does **not** leave the document on disk.

---

## Updates

```typescript
await users.updateById(id, { $set: { age: 31 } })
await users.updateOne({ email: 'a@b.com' }, { $inc: { logins: 1 } })
await users.updateMany({ status: 'draft' }, { $set: { status: 'active' } })
await users.replaceOne({ email: 'a@b.com' }, { email: 'a@b.com', name: 'Ada' })
await users.findOneAndUpdate({ email: 'a@b.com' }, { $inc: { logins: 1 } })
await users.updateOne({ email: 'new@b.com' }, { $set: { name: 'New' } }, { upsert: true })
```

Supported operators: `$set`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$push` (with `$each`, `$position` and `$slice`), `$addToSet`, `$pull`, `$pop` and `$rename`. Any other operator throws an explicit error instead of being silently ignored.

## Deletes

```typescript
await users.deleteById(id)                     // true | false
await users.deleteOne({ status: 'archived' })  // true | false
const n = await users.deleteMany({ vip: false })
const gone = await users.findOneAndDelete({ status: 'archived' })
```

---

## Aggregation

```typescript
const result = await orders.aggregate([
  { $match: { status: 'paid' } },
  { $group: { _id: '$customerId', total: { $sum: '$amount' }, orders: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 10 }
])
```

Stages: `$match`, `$project`, `$group`, `$sort`, `$skip`, `$limit`, `$count`, `$unwind`.
Accumulators: `$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`, `$count`.

---

## Bulk operations

```typescript
await products.insertMany([...], { ordered: false })   // continues after a failure

await products.bulkWrite([
  { insertOne: { name: 'Lamp' } },
  { updateOne: { filter: { name: 'Lamp' }, update: { $set: { price: 60 } } } },
  { updateMany: { filter: { category: 'home' }, update: { $set: { active: true } } } },
  { deleteMany: { filter: { discontinued: true } } }
])
```

---

## Maintenance

```typescript
await db.stats()            // metrics per collection
await db.compact()          // compacts the order log and the indexes
await db.backup('/path')    // copies the database tree
await db.restore('/path')   // replaces the content with a backup
await db.listCollections()
await db.renameCollection('products', 'catalog')
await db.dropCollection('catalog')
await db.collectionExists('catalog')
```

---

## Error handling

Every error is a `DocuDBError` with `code`, `details`, `cause` and `timestamp`. The original code **is preserved** when errors are wrapped, so you can react to the real cause.

```typescript
import { DocuDBError, MCO_ERROR } from 'docudb'

try {
  await users.insertOne({ name: 'X', email: 'not-an-email' })
} catch (error) {
  if (DocuDBError.isDocuDBError(error)) {
    console.error(error.code)     // e.g. MCO_ERROR.SCHEMA.INVALID_REGEX
    console.error(error.details)   // field, value, expected pattern
    console.error(error.cause)     // original error
  }
}
```

| Code | Meaning |
|---|---|
| `DB011` | Database not initialized |
| `DB014` | Database closed |
| `DB015` | Unsupported on-disk format (migration pending) |
| `DOC002` | Error while inserting |
| `DOC010` | Duplicate `_id` |
| `SCH002` | Missing required field |
| `SCH003` | Invalid type |
| `SCH005` | Field not allowed in strict mode |
| `SCH006` | A custom validator failed |
| `IDX004` | Unique index violation |
| `QUE001` | Invalid query operator |
| `QUE003` | Unsupported aggregation stage |

The full list lives in `MCO_ERROR`.

---

## Limits and performance

DocuDB prioritizes **clarity and zero infrastructure** over throughput. Numbers measured with `npm run bench` on Windows, Node 22+, small documents (~120 B) with gzip:

| Operation | 10 000 documents |
|---|---|
| Indexed read (`find({ name })`) | **~1,4 ms** |
| Indexed range read (`find({ n: { $gte } })`) | **~2,4 ms** |
| Full scan (`find({ group })` without an index) | ~7 900 ms |
| `insertMany` of 10 000 (write-through) | ~20 s |
| `insertMany` of 10 000 (`flushInterval: 25`) | ~24 s |
| On-disk size (10 000 docs, gzip) | ~1,6 MB |

Practical conclusion: **create an index for every field you filter by**. The gap between a scan and an index is three to four orders of magnitude.

Other known limits:

- **Single process.** Two processes on the same directory corrupt data; enable `fileLock: true` if you want DocuDB to prevent it with a clear error.
- **No transactions.** Multi-document operations are not atomic: use idempotent operations or the outbox pattern.
- **Scales well up to ~10⁵–10⁶ small documents.** Beyond that, evaluate a dedicated engine.
- **A query without an index reads every document** in the collection; add indexes or query by `_id`.
- DocuDB does not encrypt data at rest.

---

## Format migration

The v1 on-disk format (one directory per document) is migrated explicitly and verifiably:

```typescript
const db = new Database({ name: 'myDatabase', dataDir: './data' })
await db.migrate({ from: 1, to: 2, backup: true })
```

The migration copies, **verifies** the content of every document and only then removes the previous format. With `backup: true` (the default) the tree is copied to `data.bak-<timestamp>/` beforehand. When opening a v1 directory without migrating, DocuDB throws `DB015` instead of reading it halfway.

### Current layout (v2)

```
data/
├── _format.json                    # format version
└── myDatabase/
    ├── _database.json
    └── users/
        ├── _metadata.json          # counter, indexes, nextSeq (constant size)
        ├── _order.log              # append-only log with insertion order
        ├── _indices/email.idx      # index snapshot
        └── docs/
            ├── 6a1f….json.gz      # one file per document
            └── 6a2e….part-0000.json.gz   # several when it exceeds chunkSize
```

---

## Security

- Database and collection names are validated against an **allowlist** (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), Windows reserved names are rejected, and the resolved path is verified to stay inside the allowed directory.
- Writes are **atomic**: a power cut never leaves metadata half written.
- Queries are compiled into predicates: there is no `eval` and no code injection.
- **DocuDB does not encrypt data.** If you need encryption at rest, encrypt values from your application with `transform` in the schema.

---

## Roadmap

- [ ] Transactions and atomic multi-document operations
- [ ] Pluggable storage engine (LMDB / SQLite) for larger datasets
- [ ] Full-text search
- [ ] Replication and read-only mode

See [CHANGELOG.md](CHANGELOG.md) for the history.

---

## Contributing

```bash
npm install
npm run verify     # typecheck + lint + tests + build
npm run docs:check # verify the English/Spanish docs are in sync
npm run bench      # micro benchmarks
```

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## License

[MIT](LICENSE.txt)