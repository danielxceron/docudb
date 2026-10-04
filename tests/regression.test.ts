import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'
import { Database, Schema, DocuDBError, MCO_ERROR, isValidID } from '../index.js'
import { cleanTestDataDir, getTestDataDir } from './utils.js'

/**
 * Regression suite: every test here corresponds to a bug reproduced against
 * the previous implementation.
 */
describe('DocuDB - Regression suite', function () {
  this.timeout(20000)

  const testDbName = 'testRegression'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  const createDb = async (options = {}): Promise<Database> => {
    const db = new Database({ name: testDbName, compression: false, ...options })
    await db.initialize()
    return db
  }

  describe('Indexes are actually used', () => {
    it('returns entries from an existing index instead of null', async () => {
      const db = await createDb()
      const products = db.collection('products')
      await products.insertMany([
        { name: 'Laptop', price: 1000 },
        { name: 'Mouse', price: 20 }
      ])
      await products.createIndex('name')

      expect(db.indexManager.findByIndex('products', 'name', 'Laptop')).to.have.lengthOf(1)
      expect(db.indexManager.findByIndex('products', 'name', 'Nope')).to.have.lengthOf(0)
      expect(db.indexManager.findByIndex('products', 'unindexed', 'x')).to.be.null
      await db.close()
    })

    it('uses the index instead of scanning the whole collection', async () => {
      const db = await createDb()
      const products = db.collection('products')
      await products.insertMany(
        Array.from({ length: 40 }, (_, index) => ({
          name: `product-${index}`,
          price: index * 10
        }))
      )
      await products.createIndex('name')

      const plan = await products.explain({ name: 'product-7' })
      expect(plan.usedIndex).to.be.true
      expect(plan.plan).to.include('IXSCAN')
      expect(plan.docsExamined).to.equal(1)

      const found = await products.find({ name: 'product-7' })
      expect(found).to.have.lengthOf(1)
      expect(found[0].price).to.equal(70)
      await db.close()
    })

    it('answers range queries through the index', async () => {
      const db = await createDb()
      const products = db.collection('products')
      await products.insertMany(
        Array.from({ length: 20 }, (_, index) => ({ sku: `SKU${index}`, price: index }))
      )
      await products.createIndex('price')

      const expensive = await products.find({ price: { $gte: 15 } })
      expect(expensive.map(doc => doc.price)).to.have.members([15, 16, 17, 18, 19])

      const cheap = await products.find({ price: { $lt: 3 } })
      expect(cheap.map(doc => doc.price)).to.have.members([0, 1, 2])

      const selected = await products.find({ price: { $in: [5, 10] } })
      expect(selected.map(doc => doc.price)).to.have.members([5, 10])

      const others = await products.find({ price: { $ne: 5 } })
      expect(others).to.have.lengthOf(19)
      await db.close()
    })

    it('skips documents without the field on sparse indexes', async () => {
      const db = await createDb()
      const items = db.collection('items')
      await items.insertMany([
        { name: 'a', code: 'A' },
        { name: 'b' }
      ])
      await items.createIndex('code', { sparse: true })

      const withCode = await items.find({ code: { $exists: true } })
      expect(withCode.map(doc => doc.name)).to.deep.equal(['a'])
      await db.close()
    })

    it('keeps compound indexes consistent through dropIndex and listIndexes', async () => {
      const db = await createDb()
      const products = db.collection('products')
      await products.insertOne({ category: 'tech', brand: 'acme', name: 'x' })
      await products.createIndex(['category', 'brand'])

      const indexes = await products.listIndexes()
      expect(indexes).to.have.lengthOf(1)
      expect(indexes[0].fields).to.deep.equal(['category', 'brand'])

      expect(await products.dropIndex(['category', 'brand'])).to.be.true
      expect(await products.listIndexes()).to.have.lengthOf(0)
      await db.close()
    })
  })

  describe('$exists is not inverted', () => {
    it('matches documents that do not have the field', async () => {
      const db = await createDb()
      const items = db.collection('items')
      await items.insertMany([
        { name: 'with', tags: ['a'] },
        { name: 'without' }
      ])

      const missing = await items.find({ tags: { $exists: false } })
      expect(missing.map(doc => doc.name)).to.deep.equal(['without'])

      const present = await items.find({ tags: { $exists: true } })
      expect(present.map(doc => doc.name)).to.deep.equal(['with'])
      await db.close()
    })
  })

  describe('Update operators are not silently ignored', () => {
    it('supports $push, $addToSet, $pull, $pop, $mul, $min and $max', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const doc = await items.insertOne({
        tags: ['a'],
        qty: 2,
        price: 10,
        floor: 5,
        ceiling: 50
      })

      const pushed = await items.updateById(doc._id, { $push: { tags: 'b' } })
      expect(pushed?.tags).to.deep.equal(['a', 'b'])

      const added = await items.updateById(doc._id, { $addToSet: { tags: 'a' } })
      expect(added?.tags).to.deep.equal(['a', 'b'])

      const pulled = await items.updateById(doc._id, { $pull: { tags: 'a' } })
      expect(pulled?.tags).to.deep.equal(['b'])

      const popped = await items.updateById(doc._id, { $pop: { tags: 1 } })
      expect(popped?.tags).to.deep.equal([])

      const multiplied = await items.updateById(doc._id, { $mul: { price: 3 } })
      expect(multiplied?.price).to.equal(30)

      const lowered = await items.updateById(doc._id, { $min: { floor: 3 } })
      expect(lowered?.floor).to.equal(3)

      const raised = await items.updateById(doc._id, { $max: { ceiling: 80 } })
      expect(raised?.ceiling).to.equal(80)

      const persisted = await items.findById(doc._id)
      expect(persisted?.price).to.equal(30)
      expect(persisted?.ceiling).to.equal(80)
      await db.close()
    })

    it('supports $push with $each, $position and $slice', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const doc = await items.insertOne({ tags: ['b'] })

      // MongoDB semantics: $each is inserted as a block at $position.
      const updated = await items.updateById(doc._id, {
        $push: { tags: { $each: ['a', 'c'], $position: 0 } }
      })
      expect(updated?.tags).to.deep.equal(['a', 'c', 'b'])

      const sliced = await items.updateById(doc._id, {
        $push: { tags: { $each: ['d'], $slice: 2 } }
      })
      expect(sliced?.tags).to.deep.equal(['a', 'c'])
      await db.close()
    })

    it('rejects unknown update operators with a clear message', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const doc = await items.insertOne({ a: 1 })

      try {
        await items.updateById(doc._id, { $nope: { a: 2 } })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.message).to.include('Invalid update operator')
      }
      await db.close()
    })
  })

  describe('Duplicate _id is rejected', () => {
    it('throws instead of overwriting and keeps the counter accurate', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const first = await items.insertOne({ name: 'first' })

      try {
        await items.insertOne({ _id: first._id, name: 'second' })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.DOCUMENT.DUPLICATE_ID)
      }

      expect(await items.countDocuments()).to.equal(1)
      expect((await items.findById(first._id))?.name).to.equal('first')
      await db.close()
    })
  })

  describe('Returned documents are defensive copies', () => {
    it('does not let callers corrupt the cache', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const doc = await items.insertOne({ counter: 1 })

      const read = await items.findById(doc._id)
      read!.counter = 999999

      const again = await items.findById(doc._id)
      expect(again?.counter).to.equal(1)

      const listed = await items.find({})
      listed[0].counter = 12345
      expect((await items.findById(doc._id))?.counter).to.equal(1)

      const onDisk = JSON.parse(
        fs.readFileSync(
          path.join(getTestDataDir(testDbName), 'items', 'docs', `${doc._id}.json`),
          'utf8'
        )
      )
      expect(onDisk.counter).to.equal(1)
      await db.close()
    })
  })

  describe('dataDir is respected', () => {
    it('does not append an extra "data" segment', async () => {
      await cleanTestDataDir('customRoot')
      const root = getTestDataDir('customRoot')
      const db = new Database({ name: 'shop', dataDir: root })
      await db.initialize()

      expect(db.dataDir).to.equal(path.join(root, 'shop'))
      expect(fs.existsSync(path.join(root, 'shop'))).to.be.true

      await db.collection('orders').insertOne({ total: 10 })
      expect(fs.existsSync(path.join(root, 'shop', 'orders', 'docs'))).to.be.true
      expect(fs.existsSync(path.join(root, 'data'))).to.be.false

      await db.close()
      await cleanTestDataDir('customRoot')
    })
  })

  describe('Collection timestamps', () => {
    it('adds createdAt and updatedAt', async () => {
      const db = await createDb()
      const items = db.collection('items', { timestamps: true })
      const doc = await items.insertOne({ name: 'a' })

      expect(doc.createdAt).to.be.a('string')
      expect(doc.updatedAt).to.be.a('string')

      const updated = await items.updateById(doc._id, { $set: { name: 'b' } })
      expect(updated?.createdAt).to.equal(doc.createdAt)
      expect(updated?.updatedAt).to.not.equal(doc.updatedAt)
      await db.close()
    })
  })

  describe('Positions accept UUID ids', () => {
    it('works with collections configured with idType uuid', async () => {
      const db = await createDb()
      const items = db.collection<{ n: number }>('items', { idType: 'uuid' })
      const [first, second] = await items.insertMany([{ n: 1 }, { n: 2 }])

      expect(isValidID(first._id)).to.be.true
      expect(await items.getPosition(first._id)).to.equal(0)
      expect(await items.getPosition(second._id)).to.equal(1)
      expect((await items.findByPosition(1))?._id).to.equal(second._id)
      expect(await items.updatePosition(first._id, 1)).to.be.true
      expect(await items.getPosition(first._id)).to.equal(1)
      await db.close()
    })
  })

  describe('Schema strictness', () => {
    it('keeps unknown fields by default', async () => {
      const db = await createDb()
      const schema = new Schema({ name: { type: 'string', required: true } })
      const items = db.collection('items', { schema })

      const doc = await items.insertOne({ name: 'a', extra: 42 })
      expect(doc.extra).to.equal(42)
      await db.close()
    })

    it('rejects unknown fields when strict is enabled', async () => {
      const db = await createDb()
      const schema = new Schema(
        { name: { type: 'string', required: true } },
        { strict: true }
      )
      const items = db.collection('items', { schema })

      try {
        await items.insertOne({ name: 'a', extra: 42 })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.SCHEMA.INVALID_FIELD)
      }
      await db.close()
    })

    it('never shares mutable defaults between documents', async () => {
      const db = await createDb()
      const schema = new Schema({
        tags: { type: 'array', default: [] },
        meta: { type: 'object', default: {} }
      })
      const items = db.collection('items', { schema })

      const first = await items.insertOne({})
      first.tags.push('mutated')
      first.meta.touched = true

      const second = await items.insertOne({})
      expect(second.tags).to.deep.equal([])
      expect(second.meta).to.deep.equal({})
      await db.close()
    })

    it('supports asynchronous validators', async () => {
      const db = await createDb()
      const schema = new Schema({
        email: {
          type: 'string',
          required: true,
          validate: {
            custom: async (value: string) => value.includes('@') || 'invalid email'
          }
        }
      })
      const items = db.collection('items', { schema })

      const good = await items.insertOne({ email: 'a@b.com' })
      expect(good.email).to.equal('a@b.com')

      try {
        await items.insertOne({ email: 'nope' })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.SCHEMA.CUSTOM_VALIDATION_ERROR)
      }
      await db.close()
    })
  })

  describe('Error reporting keeps the original code and cause', () => {
    it('surfaces schema codes instead of a generic insert error', async () => {
      const db = await createDb()
      const schema = new Schema({ name: { type: 'string', required: true } })
      const items = db.collection('items', { schema })

      try {
        await items.insertOne({})
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(DocuDBError.isDocuDBError(error)).to.be.true
        expect(error.code).to.equal(MCO_ERROR.SCHEMA.REQUIRED_FIELD)
        expect(error.message).to.include('required')
        expect(error.timestamp).to.be.instanceOf(Date)
      }
      await db.close()
    })

    it('surfaces unique index violations', async () => {
      const db = await createDb()
      const items = db.collection('items')
      await items.createIndex('code', { unique: true })
      await items.insertOne({ code: 'A' })

      try {
        await items.insertOne({ code: 'A' })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.INDEX.UNIQUE_VIOLATION)
        expect(error.message).to.include('Duplicate')
      }

      // The rejected document must not leave a file behind.
      expect(await items.countDocuments()).to.equal(1)
      expect(await items.countDocuments({ code: 'A' })).to.equal(1)
      await db.close()
    })

    it('does not write to the console', async () => {
      const messages: string[] = []
      const original = { log: console.log, warn: console.warn, error: console.error }
      console.log = (...args: unknown[]) => messages.push(String(args[0]))
      console.warn = (...args: unknown[]) => messages.push(String(args[0]))
      console.error = (...args: unknown[]) => messages.push(String(args[0]))

      try {
        const db = await createDb()
        const items = db.collection('items')
        await items.createIndex('name', { unique: true })
        await items.insertMany([{ name: 'a' }, { name: 'b' }])
        await items.updateById((await items.findOne({ name: 'a' }))!._id, {
          $set: { name: 'c' }
        })
        await items.deleteMany({})
        await db.close()
      } finally {
        console.log = original.log
        console.warn = original.warn
        console.error = original.error
      }

      expect(messages).to.deep.equal([])
    })
  })

  describe('Concurrent updates do not lose writes', () => {
    it('serializes read-modify-write on the same document', async () => {
      const db = await createDb()
      const counters = db.collection('counters')
      const counter = await counters.insertOne({ value: 0 })

      await Promise.all(
        Array.from({ length: 25 }, async () => {
          const current = await counters.findById(counter._id)
          return counters.updateById(counter._id, {
            $inc: { value: 1 }
          }).then(() => current)
        })
      )

      expect((await counters.findById(counter._id))?.value).to.equal(25)
      await db.close()
    })

    it('does not use a global lock namespace', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const doc = await items.insertOne({ v: 1 })
      await items.updateById(doc._id, { $set: { v: 2 } })
      expect((globalThis as Record<string, unknown>)._documentLocks).to.be.undefined
      await db.close()
    })
  })

  describe('Collection metadata stays constant size', () => {
    it('does not grow with the number of documents', async () => {
      const db = await createDb()
      const items = db.collection('items')
      const metadataPath = path.join(getTestDataDir(testDbName), 'items', '_metadata.json')

      await items.insertOne({ n: 1 })
      const sizeAfterFirst = fs.statSync(metadataPath).size

      await items.insertMany(
        Array.from({ length: 200 }, (_, index) => ({ n: index }))
      )
      const sizeAfterMany = fs.statSync(metadataPath).size

      expect(sizeAfterMany).to.be.at.most(sizeAfterFirst + 64)
      expect(await items.countDocuments()).to.equal(201)
      await db.close()
    })
  })

  describe('On-disk layout', () => {
    it('stores one file per document and chunks only large documents', async () => {
      await cleanTestDataDir('testLayout')
      const db = new Database({
        name: 'testLayout',
        compression: false,
        chunkSize: 2048
      })
      await db.initialize()
      const items = db.collection('items')

      const small = await items.insertOne({ name: 'small' })
      const docsDir = path.join(getTestDataDir('testLayout'), 'items', 'docs')
      expect(fs.readdirSync(docsDir)).to.deep.equal([`${small._id}.json`])

      const large = await items.insertOne({ blob: 'x'.repeat(8000) })
      const chunks = fs.readdirSync(docsDir).filter(name => name.startsWith(`${large._id}.part-`))
      expect(chunks.length).to.be.greaterThan(1)

      const restored = await items.findById(large._id)
      expect((restored?.blob as string).length).to.equal(8000)
      await db.close()
      await cleanTestDataDir('testLayout')
    })

    it('survives a restart preserving data, indexes and order', async () => {
      const db = await createDb()
      const items = db.collection('items')
      await items.createIndex('code', { unique: true })
      const [a, b, c] = await items.insertMany([
        { code: 'A', n: 1 },
        { code: 'B', n: 2 },
        { code: 'C', n: 3 }
      ])
      await items.updateById(b._id, { $set: { n: 20 } })
      await db.close()

      const reopened = await createDb()
      const reloaded = reopened.collection('items')
      expect(await reloaded.countDocuments()).to.equal(3)
      expect((await reloaded.find({})).map(doc => doc._id)).to.deep.equal([a._id, b._id, c._id])
      expect((await reloaded.findById(b._id))?.n).to.equal(20)
      expect(await reloaded.getPosition(c._id)).to.equal(2)

      try {
        await reloaded.insertOne({ code: 'A', n: 9 })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.INDEX.UNIQUE_VIOLATION)
      }
      await reopened.close()
    })
  })

  describe('Name validation', () => {
    it('accepts names with dots but rejects traversal and reserved names', async () => {
      const db = await createDb()

      expect(db.collection('my.collection-2_v1')).to.exist

      for (const name of ['../escape', 'a/b', 'a\\b', '..', '.', '', 'con', 'a'.repeat(65)]) {
        expect(() => db.collection(name), name).to.throw()
      }
      await db.close()
    })

    it('rejects a second process when the file lock is enabled', async () => {
      await cleanTestDataDir('testLock')
      const options = { name: 'testLock', fileLock: true }

      const first = new Database(options)
      await first.initialize()

      const second = new Database(options)
      try {
        await second.initialize()
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.message).to.include('Another process')
      }

      await first.close()

      const third = new Database(options)
      await third.initialize()
      await third.close()
      await cleanTestDataDir('testLock')
    })
  })
})
