# Changelog

All notable changes to DocuDB.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versioning follows [SemVer](https://semver.org/).

> 🇬🇧 **English** · 🇪🇸 [Español](CHANGELOG.es.md)

## [0.1.0]

First stable public release of the **v2** on-disk format.

### Added

- **MongoDB-compatible API**: `updateOne`, `replaceOne`,
  `findOneAndUpdate`, `findOneAndDelete`, `countDocuments`,
  `estimatedDocumentCount`, `distinct`, `aggregate`, `bulkWrite`,
  `createIndexes`, `dropIndexes`.
- **`find(filter, options)`** with `sort`, `skip`, `limit` and `projection`.
  `FindOptions` used to exist in the types but was ignored.
- **Update operators that previously did nothing**: `$push` (with `$each`,
  `$position` and `$slice`), `$addToSet`, `$pull`, `$pop`, `$mul`, `$min`,
  `$max`. An unknown operator now throws an explicit error.
- **Working indexes**: they answer equality, sets (`$in`, `$nin`), ranges
  (`$gt`, `$gte`, `$lt`, `$lte`) and negations, with prefix support for
  compound indexes. Before this release they **were never used**.
- `explain()` to inspect the execution plan.
- **Aggregation** with `$match`, `$project`, `$group`, `$sort`, `$skip`,
  `$limit`, `$count` and `$unwind`.
- **Lifecycle**: `close()`, `flush()`, `stats()`, `compact()`, `backup()`,
  `restore()`, `renameCollection()`, `collectionExists()`.
- **Generics per collection**: `db.collection<User>('users')` types
  insertions and queries; `InferSchema` derives a type from a schema.
- **Async validators** through `Schema.validateAsync()`.
- **v2 on-disk format**: one file per document, an append-only log for the
  order, constant-size metadata and atomic writes.
- **v1 → v2 migration** with backup, per-document verification and a report.
- **Dual ESM + CJS build** with `exports` and per-condition types.
- **Optional lock file** (`fileLock`) to stop two processes from opening the
  same directory.
- `compression: 'auto'` option, `compressionLevel`, and an LRU `cacheSize`.
- Strict TypeScript, ESLint, GitHub Actions CI (Linux and Windows) and
  reproducible micro benchmarks via `npm run bench`.

### Fixed

- **Indexes were never used.** `findByIndex` had an inverted condition: it
  returned `null` when the index existed and dereferenced `undefined` when it
  did not. Every query ended up doing a full scan.
- **`$exists` was inverted**: `{ field: { $exists: false } }` returned the
  documents that **did** have the field.
- **A duplicate `_id` silently overwrote** the document and inflated the
  `count()` counter. It now throws `DOC010`, and the rejected document is not
  left on disk.
- **The cache was returned by reference**: mutating the result of `findById`
  modified internal state. Results are now defensive copies.
- **`dataDir` was ignored**: an implicit `data/` segment was appended. `dataDir`
  is now the root directory and the database lives in `<dataDir>/<name>`.
- **`timestamps: true` did nothing** on a collection. It now adds and maintains
  `createdAt` / `updatedAt`.
- **`getPosition` rejected UUIDs** even for collections using
  `idType: 'uuid'`.
- **Errors lost their code**: a schema failure or a unique index violation
  surfaced as a generic `DOC002`. `DocuDBError` now exposes `cause`, and
  `wrap()` preserves the original code.
- **Lost updates**: the lock was taken **after** the read-modify-write. It is
  now taken beforehand, as an FIFO mutex instead of a spin-wait over
  `global._documentLocks`.
- **`$in` / `$nin` did not compare element by element** on array fields.
- **`strict` defaulted to `true`**, which rejected undeclared fields and
  contradicted the README examples. It now defaults to `false`.
- **Non-atomic writes**: a power cut could leave `_metadata.json` half written.
  Everything now goes through a temporary file plus `rename`, serialized per
  path.
- **`drop()` deleted document by document**; it now removes the tree and the
  indexes directly.
- **Name validation used a block list** that rejected any name containing a dot
  and names such as `hosts`. It is now an allowlist.
- Removed `console.error` from the library.
- Filled in the error codes whose value was `undefined`.

### Changed

- **Breaking**: the on-disk format moved from v1 to v2. Existing directories
  require `db.migrate({ from: 1, to: 2 })`; DocuDB refuses to open them with a
  `DB015` error instead of reading them halfway.
- The package version went from `0.0.0` to `0.1.0`.
- `Schema` and `CollectionOptions.schema` are now typed as the
  `SchemaInterface` interface, so the types no longer depend on the concrete
  class.
- The package is published with `exports`, so deep imports
  (`docudb/dist/...`) are no longer supported.

### Removed

- `.npmignore`, redundant with the `files` field in `package.json`.