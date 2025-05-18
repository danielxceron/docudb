const { Database, Schema, Query } = require('../index')
const { expect } = require('chai')
const fs = require('fs')
const path = require('path')

describe('DocuDB - Compression and Edge Cases', () => {
  let db
  let productos
  const testDbName = 'testCompression'
  const testDataDir = path.join(__dirname, '..', 'data', testDbName)

  describe('Data Compression', () => {
    beforeEach(async () => {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true })
      }

      db = new Database({
        name: testDbName,
        compression: true, // Enable compression
        chunkSize: 512 // Small size to force multiple chunks
      })
      await db.initialize()

      const productoSchema = new Schema({
        name: { type: 'string', required: true },
        description: { type: 'string', default: '' },
        price: { type: 'number', required: true },
        details: { type: 'object', default: {} }
      })

      productos = db.collection('productos', { schema: productoSchema })
    })

    afterEach(async () => {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true })
      }
    })

    it('should compress large documents correctly', async () => {
      // Create a document with large data
      const longDescription = 'a'.repeat(1000) // 1KB of text
      const largeDetails = {}

      // Generate large object
      for (let i = 0; i < 100; i++) {
        largeDetails[`property${i}`] = `value${i}`.repeat(10)
      }

      const product = await productos.insertOne({
        name: 'Large Product',
        description: longDescription,
        price: 999.99,
        details: largeDetails
      })

      expect(product).to.have.property('_id')

      // Retrieve the document
      const retrieved = await productos.findById(product._id)
      expect(retrieved.description).to.equal(longDescription)
      expect(Object.keys(retrieved.details)).to.have.lengthOf(100)
    })

    it('should compress and decompress multiple documents correctly', async () => {
      // Insert multiple documents with medium-sized data
      const docs = []
      for (let i = 0; i < 50; i++) {
        docs.push({
          name: `Product ${i}`,
          description: `Product description ${i}`.repeat(20),
          price: i * 10.5,
          details: {
            color: 'red',
            weight: `${i * 100}g`,
            dimensions: `${i}x${i + 1}x${i + 2}`
          }
        })
      }

      const inserted = await productos.insertMany(docs)
      expect(inserted).to.have.lengthOf(50)

      // Retrieve all documents
      const retrieved = await productos.find({})
      expect(retrieved).to.have.lengthOf(50)

      // Verify data integrity
      for (let i = 0; i < 50; i++) {
        const doc = retrieved.find(d => d.name === `Product ${i}`)
        expect(doc).to.exist
        expect(doc.price).to.equal(i * 10.5)
        expect(doc.details.weight).to.equal(`${i * 100}g`)
      }
    })

    it('should handle compression in updates correctly', async () => {
      // Insert initial document
      const product = await productos.insertOne({
        name: 'Updatable Product',
        description: 'Initial description',
        price: 100
      })

      // Update with large data
      const longDescription = 'New extended description '.repeat(100)
      const largeDetails = {}
      for (let i = 0; i < 50; i++) {
        largeDetails[`attribute${i}`] = `value${i}`.repeat(5)
      }

      const updated = await productos.updateById(product._id, {
        $set: {
          description: longDescription,
          details: largeDetails
        }
      })

      expect(updated.description).to.equal(longDescription)

      // Retrieve and verify
      const retrieved = await productos.findById(product._id)
      expect(retrieved.description).to.equal(longDescription)
      expect(Object.keys(retrieved.details)).to.have.lengthOf(50)
    })
  })

  describe('Edge Cases', () => {
    beforeEach(async () => {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true })
      }

      db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      const productoSchema = new Schema(
        {
          name: { type: 'string', required: true },
          price: { type: 'number', default: 0 },
          stock: { type: 'number', default: 0 },
          tags: { type: 'array', default: [] },
          metadata: { type: 'object' }
        },
        { strict: false }
      )

      productos = db.collection('productos', { schema: productoSchema })
    })

    afterEach(async () => {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true })
      }
    })

    it('should handle empty documents correctly', async () => {
      // Only with required field
      const minimalProduct = await productos.insertOne({
        name: 'Minimal Product'
      })

      expect(minimalProduct).to.have.property('_id')
      expect(minimalProduct.price).to.equal(0) // Default value
      expect(minimalProduct.tags).to.be.an('array').that.is.empty

      // Retrieve
      const retrieved = await productos.findById(minimalProduct._id)
      expect(retrieved.name).to.equal('Minimal Product')
    })

    it('should handle empty arrays and objects', async () => {
      const product = await productos.insertOne({
        name: 'Array Product',
        price: 50,
        tags: [],
        metadata: {}
      })

      expect(product.tags).to.be.an('array').that.is.empty
      expect(product.metadata).to.be.an('object').that.is.empty

      // Update with arrays and objects
      const updated = await productos.updateById(product._id, {
        $set: {
          tags: ['tag1', 'tag2'],
          metadata: { color: 'red' }
        }
      })

      expect(updated.tags).to.have.lengthOf(2)
      expect(updated.metadata.color).to.equal('red')
    })

    it('should handle queries with complex filters', async () => {
      // Insert varied data
      await productos.insertMany([
        { name: 'A', price: 10, stock: 5, tags: ['small', 'cheap'] },
        { name: 'B', price: 20, stock: 0, tags: ['medium', 'cheap'] },
        { name: 'C', price: 30, stock: 15, tags: ['small', 'premium'] },
        { name: 'D', price: 100, stock: 10, tags: ['large', 'premium'] },
        { name: 'E', price: 50, stock: 0, tags: ['medium', 'premium'] },
        { name: 'F', price: 25, stock: 2, tags: ['medium', 'premium'] },
        { name: 'G', price: 95, stock: 8, tags: ['small', 'cheap'] }
      ])

      // Complex query with multiple conditions
      const query = new Query({
        $and: [
          {
            $or: [{ price: { $lt: 30 } }, { price: { $gt: 90 } }]
          },
          {
            $or: [{ stock: { $gt: 0 } }, { tags: { $in: ['premium'] } }]
          },
          { tags: { $nin: ['large'] } }
        ]
      })

      const results = await productos.find(query)
      expect(results).to.have.lengthOf(3)
      expect(results.map(p => p.name)).to.have.members(['A', 'F', 'G'])
    })

    it('should handle massive document deletion', async () => {
      // Insert many documents
      const docs = []
      for (let i = 0; i < 100; i++) {
        docs.push({
          name: `Product ${i}`,
          price: (i % 10) * 10,
          stock: i % 5,
          tags: i % 2 === 0 ? ['even'] : ['odd']
        })
      }

      await productos.insertMany(docs)

      // Verify total
      const initialTotal = await productos.count()
      expect(initialTotal).to.equal(100)

      // Delete documents with price > 50
      const deleted = await productos.deleteMany({ price: { $gt: 50 } })
      expect(deleted).to.be.at.least(40) // At least 40 documents deleted

      // Verify remaining
      const remaining = await productos.count()
      expect(remaining).to.equal(initialTotal - deleted)

      // Verify correct ones were deleted
      const results = await productos.find({ price: { $gt: 50 } })
      expect(results).to.have.lengthOf(0)
    })

    it('should handle extreme values correctly', async () => {
      // Extreme values
      const extremeProduct = await productos.insertOne({
        name: 'Extreme Product',
        price: Number.MAX_SAFE_INTEGER,
        stock: -0,
        tags: Array(1000).fill('tag'), // Large array
        metadata: { nested: { deeply: { value: Number.MIN_SAFE_INTEGER } } }
      })

      // Retrieve and verify
      const retrieved = await productos.findById(extremeProduct._id)
      expect(retrieved.price).to.equal(Number.MAX_SAFE_INTEGER)
      expect(retrieved.stock).to.equal(0) // -0 converts to 0
      expect(retrieved.tags).to.have.lengthOf(1000)
      expect(retrieved.metadata.nested.deeply.value).to.equal(
        Number.MIN_SAFE_INTEGER
      )
    })
  })
})
