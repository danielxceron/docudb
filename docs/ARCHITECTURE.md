# Architecture

> 🇬🇧 **English** · 🇪🇸 [Español](ARCHITECTURE.es.md)

DocuDB is an **embedded** NoSQL document database for Node.js: MongoDB-like API,
zero runtime dependencies and storage in local files.

## One-page overview

```
┌──────────────────────────────────────────────────────────────┐
│ index.ts                     Public API (ESM + CJS + types)  │
├──────────────────────────────────────────────────────────────┤
│ src/core/database.ts         Database + Collection            │
│   ├─ Collection<T>           CRUD, bulk, positions, stats     │
│   └─ Database                lifecycle, backup, migration     │
├──────────────────────────────────────────────────────────────┤
│ src/query/query.ts           criteria → compiled predicate    │
│ src/aggregation/aggregate.ts $match…$unwind pipeline          │
│ src/schema/schema.ts         declarative validation           │
├──────────────────────────────────────────────────────────────┤
│ src/index/indexManager.ts    in-memory indexes + snapshots    │
│ src/storage/fileStorage.ts   v2 on-disk format + gzip        │
│ src/compression/gzip.ts      zlib                             │
├──────────────────────────────────────────────────────────────┤
│ src/utils/*                  paths, I/O helpers, mutex, UUID  │
│ src/errors/errors.ts         MCO_ERROR + DocuDBError          │
│ src/types/index.ts           type contract                    │
└──────────────────────────────────────────────────────────────┘
```

## On-disk format (v2)

```
data/
├── _format.json                          # { formatVersion: 2 }
└── <db>/
    ├── _database.json
    └── <collection>/
        ├── _metadata.json                # count, nextSeq, indexes — constant size
        ├── _order.log                    # append-only log: {s,i} | {d} | {o}
        ├── _indices/<field>[+field].idx   # index snapshot
        └── docs/<id>.json[.gz]            # one file per document
            <id>.part-NNNN.json[.gz]       # N files when it exceeds chunkSize
```

Four decisions explain the current performance:

1. **One file per document instead of a directory with N files.**
   A directory plus a file per document cost two filesystem entries per
   document; now it costs one.

2. **Constant-size metadata.** Insertion order is **not** stored as an array in
   `_metadata.json` (that made every insert rewrite an O(n) file, turning a
   10 000-document load into O(n²)). It lives in `_order.log`, an append-only
   log: inserting costs one `append`.

3. **Atomic writes.** Every file is written as a temporary file plus `rename`,
   and writes to the same destination are serialized with a per-path mutex. On
   Windows, `rename` onto a file another handle still holds open fails with
   `EPERM`, so the rename also retries on transient errors.

4. **Indexes with a reverse map.** An index is
   `Map<valueKey, Set<docId>>` plus `Map<docId, Set<valueKey>>`. Removing a
   document from an index costs O(its own keys) instead of walking every key in
   the index. Snapshots are written lazily (dirty flag plus `flushInterval`),
   never on every write.

## Concurrency

- **Within one process**: `KeyedMutex` (`src/utils/mutex.ts`) serializes
  per-document operations with a FIFO promise chain. The lock is taken
  **before** reading, not after, which removes the lost-update window. It used
  to be a `global._documentLocks` spin-wait with `setTimeout`, which also
  collided between distinct databases.
- **Across processes**: opt-in via `fileLock: true`, which takes a `_lock` with
  `open(path, 'wx')` and detects dead processes.

## Query engine

`compileCriteria()` walks the criteria tree **once** and returns a closure.
Previously the tree was re-interpreted for every document. Predicates operate on
the values taken from the document through `getNestedValue`, with dot notation
and support for numeric array indexes.

`sort` uses an explicit total order (`undefined < null < boolean < number <
string < Date < array < object`) so sorting never returns an arbitrary order
when fields are missing.

## Indexed lookups

`Collection._findWithOptimization()` looks for an indexed field in the criteria,
delegates to `IndexManager.lookup()` and then re-checks the full predicate over
the candidates. It supports equality, sets, ranges and negations; compound
indexes are queried by prefix. `explain()` exposes the plan, so tests can assert
that the index is actually being used.

## Format versioning

`FORMAT_VERSION` lives in `src/types/index.ts`. When opening a database:

- Empty directory → the current version is adopted.
- Manifest with a higher version → `DB015` error.
- Manifest with a lower version (or directories holding v1 documents) → `DB015`
  error stating that a migration is required.

`migrateDatabase()` implements v1 → v2: it reads each document with the v1
reader, writes it with the v2 writer, reads it back and compares; only afterwards
does it remove the previous format. With `backup: true` it copies the whole tree
first.

## Extension points

- `Schema` accepts async `custom` validators (`validateAsync`).
- `logger` receives diagnostics without the library writing to the console.
- `compression: 'auto'` decides by size, and `compressionLevel` tunes gzip.
- `KeyedMutex`, `deepCopy` and the path helpers are exported in case you want to
  reuse them.