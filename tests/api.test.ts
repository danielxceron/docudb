import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'
import { Database, DocuDBError, MCO_ERROR } from '../index.js'
import { cleanTestDataDir, getTestDataDir } from './utils.js'

interface Product {
  name: string
  price: number
  category: string
  tags?: string[]
}

describe('DocuDB - Public API', function () {
  this.timeout(20000)

  const testDbName = 'testApi'
  let db: Database

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)
    db = new Database({ name: testDbName, compression: false })
    await db.initialize()
  })

  afterEach(async () => {
    await db.close()
    await cleanTestDataDir(testDbName)
  })

  const seed = async (): Promise<ReturnType<Database['collection']>> => {
    const products = db.collection<Product>('products')
    await products.insertMany([
      { name: 'Laptop', price: 1200, category: 'tech', tags: ['heavy', 'portable'] },
      { name: 'Mouse', price: 25, category: 'tech', tags: ['light'] },
      { name: 'Keyboard', price: 75, category: 'tech' },
      { name: 'Book', price: 30, category: 'books', tags: ['paper'] }
    ])
    return products
  }

  describe('Typed collections', () => {
    it('infers document types through generics', async () => {
      const products = db.collection<Product>('products')
      const inserted = await products.insertOne({ name: 'Desk', price: 250, category: 'furniture' })

      const found = await products.find({ category: 'furniture' })
      expect(found).to.have.lengthOf(1)
      expect(found[0].price).to.be.a('number')
      expect(inserted.name).to.equal('Desk')
    })
  })

  describe('find with options', () => {
    it('supports sort, skip, limit and projection', async () => {
      const products = await seed()

      const sorted = await products.find({}, { sort: { price: -1 } })
      expect(sorted.map(doc => doc.name)).to.deep.equal(['Laptop', 'Keyboard', 'Book', 'Mouse'])

      const page = await products.find({}, { sort: { price: 1 }, skip: 1, limit: 2 })
      expect(page.map(doc => doc.name)).to.deep.equal(['Book', 'Keyboard'])

      const projected = await products.find({ name: 'Mouse' }, { projection: { name: 1 } })
      expect(Object.keys(projected[0]).sort()).to.deep.equal(['_id', 'name'])

      const excluded = await products.find({ name: 'Mouse' }, { projection: { price: 0, category: 0, tags: 0 } })
      expect(excluded[0].price).to.be.undefined
      expect(excluded[0].name).to.equal('Mouse')
    })

    it('sorts deterministically when some documents miss the field', async () => {
      const items = db.collection('items')
      await items.insertMany([
        { n: 2 }, { n: 1 }, { n: 3 }
      ])
      const partial = db.collection('partial')
      await partial.insertMany([{ n: 2 }, { n: 1 }, { other: true }])

      const sorted = await partial.find({}, { sort: { n: 1 } })
      expect(sorted.map(doc => doc.n)).to.deep.equal([undefined, 1, 2])
    })
  })

  describe('MongoDB-like helpers', () => {
    it('countDocuments, estimatedDocumentCount and count agree', async () => {
      const products = await seed()
      expect(await products.count()).to.equal(4)
      expect(await products.countDocuments()).to.equal(4)
      expect(await products.estimatedDocumentCount()).to.equal(4)
      expect(await products.countDocuments({ category: 'tech' })).to.equal(3)
    })

    it('distinct returns unique values', async () => {
      const products = await seed()
      expect(await products.distinct('category')).to.have.members(['tech', 'books'])
      expect(await products.distinct('category', { price: { $lt: 100 } })).to.deep.equal(['tech', 'books'])
    })

    it('updateOne updates a single document and supports upsert', async () => {
      const products = await seed()

      const result = await products.updateOne({ name: 'Mouse' }, { $inc: { price: 5 } })
      expect(result.matchedCount).to.equal(1)
      expect(result.modifiedCount).to.equal(1)
      expect((await products.findOne({ name: 'Mouse' }))?.price).to.equal(30)

      const missed = await products.updateOne({ name: 'Nope' }, { $set: { price: 1 } })
      expect(missed.matchedCount).to.equal(0)

      const upserted = await products.updateOne(
        { name: 'New', category: 'misc' },
        { $set: { price: 5, category: 'misc' } },
        { upsert: true }
      )
      expect(upserted.document?.name).to.equal('New')
      expect(await products.countDocuments()).to.equal(5)
    })

    it('updateMany updates every match', async () => {
      const products = await seed()
      const result = await products.updateMany({ category: 'tech' }, { $set: { category: 'hardware' } })
      expect(result.matchedCount).to.equal(3)
      expect(result.modifiedCount).to.equal(3)
      expect(await products.countDocuments({ category: 'hardware' })).to.equal(3)
    })

    it('replaceOne swaps the whole document keeping the id', async () => {
      const products = await seed()
      const original = await products.findOne({ name: 'Mouse' })
      const result = await products.replaceOne({ name: 'Mouse' }, { name: 'Rat', price: 20, category: 'tech' })

      expect(result.matchedCount).to.equal(1)
      const replaced = await products.findById(original!._id)
      expect(replaced?.name).to.equal('Rat')
      expect(replaced?.tags).to.be.undefined
    })

    it('findOneAndUpdate and findOneAndDelete work atomically', async () => {
      const products = await seed()

      const after = await products.findOneAndUpdate({ name: 'Book' }, { $set: { price: 35 } })
      expect(after.document?.price).to.equal(35)

      const before = await products.findOneAndUpdate(
        { name: 'Book' },
        { $set: { price: 40 } },
        { returnDocument: 'before' }
      )
      expect(before.document?.price).to.equal(35)

      const removed = await products.findOneAndDelete({ name: 'Book' })
      expect(removed?.name).to.equal('Book')
      expect(await products.countDocuments()).to.equal(3)
    })

    it('bulkWrite applies a mixed batch', async () => {
      const products = await seed()
      const result = await products.bulkWrite([
        { insertOne: { name: 'Lamp', price: 60, category: 'home' } },
        { updateOne: { filter: { name: 'Mouse' }, update: { $set: { price: 30 } } } },
        { updateMany: { filter: { category: 'tech' }, update: { $set: { tags: ['tagged'] } } } },
        { deleteOne: { filter: { name: 'Book' } } }
      ])

      expect(result.insertedCount).to.equal(1)
      expect(result.insertedIds).to.have.lengthOf(1)
      expect(result.modifiedCount).to.be.at.least(2)
      expect(result.deletedCount).to.equal(1)
      expect(await products.countDocuments()).to.equal(4)
      expect((await products.findOne({ name: 'Mouse' }))?.price).to.equal(30)
    })

    it('bulkWrite can continue after a failure when unordered', async () => {
      const products = db.collection('items')
      await products.createIndex('code', { unique: true })
      await products.insertOne({ code: 'A' })

      const result = await products.bulkWrite(
        [
          { insertOne: { code: 'A' } },
          { insertOne: { code: 'B' } }
        ],
        { ordered: false }
      )
      expect(result.insertedCount).to.equal(1)
      expect(await products.countDocuments()).to.equal(2)
    })
  })

  describe('Aggregation', () => {
    it('groups, sums and sorts', async () => {
      const orders = db.collection('orders')
      await orders.insertMany([
        { customer: 'a', amount: 10, status: 'paid' },
        { customer: 'a', amount: 20, status: 'paid' },
        { customer: 'b', amount: 5, status: 'pending' },
        { customer: 'c', amount: 40, status: 'paid' }
      ])

      const result = await orders.aggregate([
        { $match: { status: 'paid' } },
        {
          $group: {
            _id: '$customer',
            total: { $sum: '$amount' },
            orders: { $sum: 1 }
          }
        },
        { $sort: { total: -1 } },
        { $limit: 2 }
      ])

      expect(result).to.have.lengthOf(2)
      expect(result[0]._id).to.equal('c')
      expect(result[0].total).to.equal(40)
      expect(result[1]._id).to.equal('a')
      expect(result[1].total).to.equal(30)
      expect(result[1].orders).to.equal(2)
    })

    it('supports $count, $unwind and computed projections', async () => {
      const items = db.collection('items')
      await items.insertMany([
        { name: 'a', tags: ['x', 'y'], price: 10 },
        { name: 'b', tags: ['z'], price: 20 }
      ])

      const counted = await items.aggregate([{ $count: 'total' }])
      expect(counted[0].total).to.equal(2)

      const unwound = await items.aggregate([{ $unwind: '$tags' }, { $sort: { tags: 1 } }])
      expect(unwound.map(doc => doc.tags)).to.deep.equal(['x', 'y', 'z'])

      const computed = await items.aggregate([
        { $match: { name: 'a' } },
        { $project: { label: { $concat: ['$name', '-', '$tags.0'] } } }
      ])
      expect(computed[0].label).to.equal('a-x')
    })

    it('rejects unsupported stages', async () => {
      const items = db.collection('items')
      try {
        await items.aggregate([{ $lookup: {} } as never])
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.QUERY.INVALID_STAGE)
      }
    })
  })

  describe('Database management', () => {
    it('lists, renames and drops collections', async () => {
      const products = db.collection('products')
      await products.insertOne({ name: 'x' })

      expect(await db.listCollections()).to.deep.equal(['products'])
      expect(await db.collectionExists('products')).to.be.true
      expect(await db.collectionExists('nope')).to.be.false

      expect(await db.renameCollection('products', 'catalog')).to.be.true
      expect(await db.listCollections()).to.deep.equal(['catalog'])
      expect(await db.collection('catalog').countDocuments()).to.equal(1)

      expect(await db.dropCollection('catalog')).to.be.true
      expect(await db.listCollections()).to.deep.equal([])
      expect(await db.dropCollection('catalog')).to.be.false
    })

    it('reports statistics', async () => {
      const products = await seed()
      await products.createIndex('name')

      const stats = await db.stats()
      expect(stats.name).to.equal(testDbName)
      expect(stats.collectionCount).to.equal(1)
      expect(stats.collections.products.count).to.equal(4)
      expect(stats.collections.products.indexCount).to.equal(1)
      expect(stats.collections.products.storageSize).to.be.greaterThan(0)
      expect(stats.collections.products.cachedDocuments).to.be.greaterThan(0)
    })

    it('backs up and restores', async () => {
      const products = db.collection('products')
      await products.insertOne({ name: 'kept' })

      const backupPath = await db.backup(path.join(getTestDataDir(testDbName), '..', 'testApiBackup'))
      expect(fs.existsSync(backupPath)).to.be.true

      await products.deleteMany({})
      expect(await products.countDocuments()).to.equal(0)

      await db.restore(backupPath)
      expect(await db.collection('products').countDocuments()).to.equal(1)
      await cleanTestDataDir('testApiBackup')
    })

    it('compacts the order log', async () => {
      const items = db.collection('items')
      await items.insertMany(Array.from({ length: 30 }, (_, i) => ({ i })))
      await items.deleteMany({ i: { $lt: 10 } })

      const logPath = path.join(getTestDataDir(testDbName), 'items', '_order.log')
      const before = fs.statSync(logPath).size
      await db.compact()
      const after = fs.statSync(logPath).size

      expect(after).to.be.at.most(before)
      expect(await items.countDocuments()).to.equal(20)
      expect(await items.getPosition((await items.findOne({ i: 29 }))!._id)).to.equal(19)
    })

    it('refuses to work after close', async () => {
      const local = new Database({ name: 'testApiClose' })
      await local.initialize()
      await local.close()
      expect(() => local.collection('x')).to.throw()
      await cleanTestDataDir('testApiClose')
    })

    it('requires initialize before use', () => {
      const local = new Database({ name: 'testApiInit' })
      expect(() => local.collection('x')).to.throw()
    })
  })

  describe('Indexes management', () => {
    it('creates several indexes at once and drops them', async () => {
      const products = await seed()
      const created = await products.createIndexes([
        { field: 'name', options: { unique: true } },
        { field: ['category', 'price'] }
      ])
      expect(created).to.equal(2)
      expect(await products.listIndexes()).to.have.lengthOf(2)

      await products.dropIndexes()
      expect(await products.listIndexes()).to.have.lengthOf(0)
    })

    it('keeps index definitions across restarts', async () => {
      const products = db.collection('products')
      await products.createIndex('code', { unique: true })
      await products.insertOne({ code: 'A' })
      await db.close()

      db = new Database({ name: testDbName, compression: false })
      await db.initialize()
      const reopened = db.collection('products')

      expect((await reopened.listIndexes()).map(index => index.field)).to.deep.equal(['code'])
      try {
        await reopened.insertOne({ code: 'A' })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.INDEX.UNIQUE_VIOLATION)
      }
    })
  })

  describe('Errors', () => {
    it('exposes stable codes for unknown operators', async () => {
      const items = db.collection('items')
      await items.insertOne({ n: 1 })

      try {
        await items.find({ n: { $bogus: 1 } })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error.code).to.equal(MCO_ERROR.QUERY.INVALID_OPERATOR)
        expect(error.message).to.include('$bogus')
      }
    })

    it('serializes errors to JSON', async () => {
      const error = new DocuDBError('boom', MCO_ERROR.DOCUMENT.NOT_FOUND, { id: 'x' })
      const json = error.toJSON() as Record<string, any>
      expect(json.code).to.equal(MCO_ERROR.DOCUMENT.NOT_FOUND)
      expect(json.message).to.equal('boom')
      expect(json.details.id).to.equal('x')
    })

    it('every error code has a value', () => {
      for (const [group, codes] of Object.entries(MCO_ERROR)) {
        for (const [name, code] of Object.entries(codes as Record<string, unknown>)) {
          expect(code, `${group}.${name}`).to.be.a('string')
          expect(String(code).length, `${group}.${name}`).to.be.greaterThan(0)
        }
      }
    })
  })

  describe('Configuration', () => {
    it('supports auto compression', async () => {
      await cleanTestDataDir('testAutoCompression')
      const local = new Database({
        name: 'testAutoCompression',
        compression: 'auto',
        compressionThreshold: 256
      })
      await local.initialize()
      const items = local.collection('items')

      const small = await items.insertOne({ note: 'tiny' })
      const large = await items.insertOne({ note: 'x'.repeat(4096) })

      const dir = path.join(getTestDataDir('testAutoCompression'), 'items', 'docs')
      expect(fs.existsSync(path.join(dir, `${small._id}.json`))).to.be.true
      expect(fs.existsSync(path.join(dir, `${large._id}.json.gz`))).to.be.true
      expect(((await items.findById(large._id))?.note as string).length).to.equal(4096)

      await local.close()
      await cleanTestDataDir('testAutoCompression')
    })

    it('honours a custom cache size', async () => {
      const local = new Database({ name: 'testApiCache', cacheSize: 5 })
      await local.initialize()
      const items = local.collection('items')
      await items.insertMany(Array.from({ length: 20 }, (_, i) => ({ i })))

      const stats = await items.stats()
      expect(stats.cachedDocuments).to.be.at.most(5)
      expect(await items.countDocuments()).to.equal(20)
      expect((await items.findOne({ i: 19 }))?.i).to.equal(19)

      await local.close()
      await cleanTestDataDir('testApiCache')
    })

    it('supports deferred flushing with an explicit close', async () => {
      const local = new Database({ name: 'testApiFlush', flushInterval: 10_000 })
      await local.initialize()
      const items = local.collection('items')
      await items.insertMany([{ a: 1 }, { a: 2 }])
      await local.close()

      const reopened = new Database({ name: 'testApiFlush', flushInterval: 10_000 })
      await reopened.initialize()
      expect(await reopened.collection('items').countDocuments()).to.equal(2)
      await reopened.close()
      await cleanTestDataDir('testApiFlush')
    })
  })
})
