const { Database, Schema } = require('../index')
const { expect } = require('chai')
const fs = require('fs')
const path = require('path')

describe('DocuDB - Database Operations', () => {
  let db
  const testDbName = 'testDB'
  const testDataDir = path.join(__dirname, '..', 'data', testDbName)

  // Clean test directory before each test
  beforeEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true })
    }
    db = new Database({
      name: testDbName,
      compression: false,
      chunkSize: 1024
    })
    await db.initialize()
  })

  afterEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true })
    }
  })

  describe('Database Initialization', () => {
    it('should initialize database with correct options', async () => {
      expect(db.name).to.equal(testDbName)
      expect(db.storageOptions.compression).to.be.false
      expect(db.storageOptions.chunkSize).to.equal(1024)
    })

    it('should create data directory on initialize', async () => {
      expect(fs.existsSync(testDataDir)).to.be.true
    })
  })

  describe('Collection Operations', () => {
    it('should create and return a collection', () => {
      const collection = db.collection('testCollection')
      expect(collection).to.exist
      expect(db.collections.testCollection).to.equal(collection)
    })

    it('should drop a collection', async () => {
      db.collection('testCollection')
      const result = await db.dropCollection('testCollection')
      expect(result).to.be.true
      expect(db.collections.testCollection).to.be.undefined
    })
  })
})

describe('DocuDB - CRUD Operations', () => {
  let db
  let productos
  const testDbName = 'testCRUD'
  const testDataDir = path.join(__dirname, '..', 'data', testDbName)

  beforeEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true })
    }

    db = new Database({
      name: testDbName,
      compression: false
    })
    await db.initialize()

    const productoSchema = new Schema({
      name: { type: 'string', required: true },
      price: { type: 'number', required: true },
      stock: { type: 'number', default: 0 }
    })

    productos = db.collection('productos', { schema: productoSchema })
  })

  afterEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true })
    }
  })

  describe('Insert Operations', () => {
    it('should insert a single document', async () => {
      const producto = await productos.insertOne({
        name: 'Test Product',
        price: 100
      })

      expect(producto).to.have.property('_id')
      expect(producto.name).to.equal('Test Product')
      expect(producto.price).to.equal(100)
      expect(producto.stock).to.equal(0)
    })

    it('should insert multiple documents', async () => {
      const docs = await productos.insertMany([
        { name: 'Product 1', price: 10 },
        { name: 'Product 2', price: 20 }
      ])

      expect(docs).to.have.lengthOf(2)
      expect(docs[0].name).to.equal('Product 1')
      expect(docs[1].name).to.equal('Product 2')
    })
  })

  describe('Query Operations', () => {
    beforeEach(async () => {
      await productos.insertMany([
        { name: 'Laptop', price: 1000, stock: 5 },
        { name: 'Mouse', price: 20, stock: 10 },
        { name: 'Keyboard', price: 50, stock: 8 }
      ])
    })

    it('should find all documents', async () => {
      const results = await productos.find({})
      expect(results).to.have.lengthOf(3)
    })

    it('should find documents with conditions', async () => {
      const results = await productos.find({ price: { $gt: 50 } })
      expect(results).to.have.lengthOf(1)
      expect(results[0].name).to.equal('Laptop')
    })

    it('should find one document', async () => {
      const result = await productos.findOne({ name: 'Mouse' })
      expect(result.name).to.equal('Mouse')
      expect(result.price).to.equal(20)
    })
  })

  describe('Update Operations', () => {
    let productoId

    beforeEach(async () => {
      const producto = await productos.insertOne({
        name: 'Monitor', price: 200, stock: 3
      })
      productoId = producto._id
    })

    it('should update a document', async () => {
      const updated = await productos.updateById(productoId, {
        $set: { price: 180, stock: 5 }
      })

      expect(updated.price).to.equal(180)
      expect(updated.stock).to.equal(5)
    })
  })

  describe('Delete Operations', () => {
    let productoId

    beforeEach(async () => {
      const producto = await productos.insertOne({
        name: 'Headphones', price: 50, stock: 10
      })
      productoId = producto._id
    })

    it('should delete a document', async () => {
      await productos.deleteById(productoId)
      const count = await productos.count()
      expect(count).to.equal(0)
    })
  })
})
