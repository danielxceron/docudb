const { Database, Schema } = require('../index')
const { expect } = require('chai')
const fs = require('fs')
const path = require('path')

describe('DocuDB - Indexes and Constraints', () => {
  let db
  let productos
  const testDbName = 'testIndexes'
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
      codigo: { type: 'string', required: true },
      price: { type: 'number', required: true },
      categoria: { type: 'string' }
    })

    productos = db.collection('productos', { schema: productoSchema })
  })

  afterEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true })
    }
  })

  describe('Unique Indexes', () => {
    it('should create a unique index correctly', async () => {
      const result = await productos.createIndex('codigo', { unique: true })
      expect(result).to.be.true
    })

    it('should reject duplicate documents in field with unique index', async () => {
      // Create unique index
      await productos.createIndex('codigo', { unique: true })

      // Insert first document
      await productos.insertOne({
        name: 'Product 1',
        codigo: 'ABC123',
        price: 100
      })

      // Try to insert document with the same code
      try {
        await productos.insertOne({
          name: 'Product 2',
          codigo: 'ABC123', // Same code
          price: 200
        })
        expect.fail('Should have thrown a duplicate error')
      } catch (error) {
        expect(error.message).to.include('Duplicate')
      }
    })

    it('should allow updating a document without violating uniqueness constraint', async () => {
      // Create unique index
      await productos.createIndex('codigo', { unique: true })

      // Insert documents
      const product1 = await productos.insertOne({
        name: 'Product 1',
        codigo: 'ABC123',
        price: 100
      })

      await productos.insertOne({
        name: 'Product 2',
        codigo: 'XYZ789',
        price: 200
      })

      // Update without changing the code (should work)
      const updated = await productos.updateById(product1._id, {
        $set: { price: 150 }
      })

      expect(updated.price).to.equal(150)
    })

    it('should reject update that violates uniqueness constraint', async () => {
      // Create unique index
      await productos.createIndex('codigo', { unique: true })

      // Insert documents
      const product1 = await productos.insertOne({
        name: 'Product 1',
        codigo: 'ABC123',
        price: 100
      })

      await productos.insertOne({
        name: 'Product 2',
        codigo: 'XYZ789',
        price: 200
      })

      // Try to update with a code that already exists
      try {
        await productos.updateById(product1._id, {
          $set: { codigo: 'XYZ789' } // This code already exists
        })
        expect.fail('Should have thrown a duplicate error')
      } catch (error) {
        expect(error.message).to.include('Duplicate')
      }
    })
  })

  describe('Composite Indexes', () => {
    it('should create a composite index correctly', async () => {
      const result = await productos.createIndex(['categoria', 'name'], { name: 'idx_cat_name' })
      expect(result).to.be.true
    })

    it('should reject duplicate documents in unique composite index', async () => {
      // Create unique composite index
      await productos.createIndex(['categoria', 'name'], { unique: true })

      // Insert first document
      await productos.insertOne({
        name: 'Laptop',
        codigo: 'LAP001',
        price: 1000,
        categoria: 'Electronics'
      })

      // Try to insert document with the same combination
      try {
        await productos.insertOne({
          name: 'Laptop', // Same name
          codigo: 'LAP002', // Different code
          price: 1200,
          categoria: 'Electronics' // Same category
        })
        expect.fail('Should have thrown a duplicate error')
      } catch (error) {
        expect(error.message).to.include('Duplicate')
      }

      // Should allow insert with different category or name
      const doc = await productos.insertOne({
        name: 'Laptop Pro', // Different name
        codigo: 'LAP003',
        price: 1500,
        categoria: 'Electronics' // Same category
      })

      expect(doc).to.have.property('_id')
    })
  })

  describe('Index Operations', () => {
    it('should list collection indexes', async () => {
      await productos.createIndex('codigo', { unique: true })
      await productos.createIndex('price')

      const indices = await productos.listIndexes()
      expect(indices).to.have.lengthOf.at.least(2)

      const codigoIndex = indices.find(idx => idx.field === 'codigo')
      expect(codigoIndex).to.exist
      expect(codigoIndex.unique).to.be.true
    })

    it('should delete an index correctly', async () => {
      await productos.createIndex('codigo', { unique: true })

      const result = await productos.dropIndex('codigo')
      expect(result).to.be.true

      // Now should be able to insert documents with the same code
      await productos.insertOne({
        name: 'Product 1',
        codigo: 'ABC123',
        price: 100
      })

      const doc = await productos.insertOne({
        name: 'Product 2',
        codigo: 'ABC123', // Same code
        price: 200
      })

      expect(doc).to.have.property('_id')
    })
  })
})
