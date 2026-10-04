/**
 * Micro benchmarks for DocuDB.
 *
 * Run with `npm run bench`. Uses `node:perf_hooks` only, so the benchmark
 * harness adds no dependency to the library.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Database, Schema } from '../index.js'

interface Row {
  group: string
  n: number
  name: string
  active: boolean
  tags: string[]
}

const SCHEMA = new Schema({
  group: { type: 'string', required: true },
  n: { type: 'number', required: true },
  name: { type: 'string', required: true },
  active: { type: 'boolean', default: false },
  tags: { type: 'array', default: [] }
})

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    group: `g${index % 10}`,
    n: index,
    name: `row-${index}`,
    active: index % 3 === 0,
    tags: [`t${index % 4}`, 'common']
  }))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docudb-bench-'))

/**
 * Times an async operation
 * @param label - Row label
 * @param task - Operation to measure
 */
async function measure (label: string, task: () => Promise<unknown> | unknown): Promise<void> {
  const start = performance.now()
  await task()
  const ms = performance.now() - start
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(1).padStart(9)} ms`)
}

async function main (): Promise<void> {
  console.log(`DocuDB benchmarks (node ${process.version})\n`)
  console.log(`workspace: ${root}\n`)

  // Cold start ---------------------------------------------------------------
  console.log('cold start')
  await measure('open + initialize an empty database', async () => {
    const db = new Database({ name: 'cold', dataDir: path.join(root, 'cold') })
    await db.initialize()
    await db.close()
  })

  // Inserts ------------------------------------------------------------------
  for (const [size, flushInterval] of [[1000, 0], [10_000, 25]] as const) {
    console.log(`\ninsert ${size} documents (schema validated, flushInterval: ${flushInterval})`)
    const db = new Database({
      name: `insert${size}`,
      dataDir: path.join(root, `insert${size}`),
      flushInterval
    })
    await db.initialize()
    const items = db.collection<Row>('items', { schema: SCHEMA })
    await measure(`insertMany x${size}`, () => items.insertMany(rows(size)))
    await measure('read them all back', () => items.find({}))
    await measure('countDocuments', () => items.countDocuments())
    await measure('close', () => db.close())
  }

  // Queries ------------------------------------------------------------------
  console.log('\nqueries on 10 000 documents')
  {
    const db = new Database({
      name: 'query',
      dataDir: path.join(root, 'query'),
      flushInterval: 25
    })
    await db.initialize()
    const items = db.collection<Row>('items')
    await items.insertMany(rows(10_000))
    await items.createIndex('name')
    await items.createIndex('n')

    await measure('collscan find({ group: "g3" })', () => items.find({ group: 'g3' }))
    await measure('indexed find({ name: "row-5000" })', () => items.find({ name: 'row-5000' }))
    await measure('indexed range find({ n: { $gte: 9990 } })', () => items.find({ n: { $gte: 9990 } }))
    await measure('sort + limit (top 10 by n desc)', () =>
      items.find({}, { sort: { n: -1 }, limit: 10 }))
    await measure('explain (no document materialization)', () => items.explain({ name: 'row-1' }))
    await measure('aggregate $group + $sort', () => items.aggregate([
      { $group: { _id: '$group', total: { $sum: '$n' } } },
      { $sort: { total: -1 } }
    ]))
    await db.close()
  }

  // Updates ------------------------------------------------------------------
  console.log('\nupdates on 10 000 documents')
  {
    const db = new Database({
      name: 'update',
      dataDir: path.join(root, 'update'),
      flushInterval: 25
    })
    await db.initialize()
    const items = db.collection<Row>('items')
    await items.insertMany(rows(10_000))
    const all = await items.find({}, { limit: 1000, projection: { _id: 1 } })

    await measure('updateById x1000 ($set)', async () => {
      for (const doc of all) await items.updateById(doc._id, { $set: { active: true } })
    })
    await measure('updateMany ($set over everything)', () =>
      items.updateMany({}, { $set: { name: 'renamed' } }))
    await measure('deleteMany (half)', () => items.deleteMany({ n: { $lt: 5000 } }))
    await db.close()
  }

  // Deferred flush -----------------------------------------------------------
  console.log('\ndeferred metadata flush (flushInterval: 25ms)')
  {
    const db = new Database({
      name: 'deferred',
      dataDir: path.join(root, 'deferred'),
      flushInterval: 25
    })
    await db.initialize()
    const items = db.collection<Row>('items')
    await measure('insertMany x10 000', () => items.insertMany(rows(10_000)))
    await measure('close (flush + release)', () => db.close())
  }

  // Storage size -------------------------------------------------------------
  console.log('\non-disk footprint')
  const footprints: Array<[string, string]> = [
    ['10 000 docs, gzip', path.join(root, 'insert10000')],
    ['10 000 docs, deferred flush', path.join(root, 'deferred')]
  ]

  for (const [label, dir] of footprints) {
    let bytes = 0
    const walk = (current: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name)
        if (entry.isDirectory()) walk(target)
        else bytes += fs.statSync(target).size
      }
    }
    walk(dir)
    console.log(`  ${label.padEnd(46)} ${(bytes / 1024 / 1024).toFixed(2).padStart(9)} MB`)
  }

  fs.rmSync(root, { recursive: true, force: true })
  console.log('\ndone')
}

await main()
