import { Database, Schema, Query } from '../index.js'
import { expect } from 'chai'

import { Collection } from '../src/core/database.js'

import { cleanTestDataDir } from './utils.js'

describe('DocuDB - Schema Validation', () => {
  let db: Database
  let productos: Collection
  const testDbName = 'testSchema'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)

    db = new Database({
      name: testDbName,
      compression: false
    })
    await db.initialize()

    const productoSchema = new Schema(
      {
        name: {
          type: 'string',
          required: true,
          validate: { minLength: 3, maxLength: 50 }
        },
        price: {
          type: 'number',
          required: true,
          validate: { min: 0 }
        },
        categorias: {
          type: 'array',
          validate: { minLength: 1 }
        }
      },
      {
        strict: true
      }
    )

    productos = db.collection('productos', { schema: productoSchema })
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  describe('Schema Validation', () => {
    it('should reject invalid document structure', async () => {
      try {
        await productos.insertOne({
          name: 'Test Product',
          price: 15,
          invalidField: 'test'
        })
        expect.fail('Should have thrown validation error')
      } catch (error: any) {
        expect(error.message).to.include('invalidField')
      }
    })

    it('should validate string length', async () => {
      try {
        await productos.insertOne({
          name: 'AB', // Less than minLength
          price: 10,
          categorias: ['test']
        })
        expect.fail('Should have thrown validation error')
      } catch (error: any) {
        expect(error.message).to.include('greater than or equal to 3')
      }
    })

    it('should validate number min value', async () => {
      try {
        await productos.insertOne({
          name: 'Test Product',
          price: -5, // Less than min
          categorias: ['test']
        })
        expect.fail('Should have thrown validation error')
      } catch (error: any) {
        expect(error.message).to.include('greater than or equal to 0')
      }
    })

    it('should validate array length', async () => {
      try {
        await productos.insertOne({
          name: 'Test Product',
          price: 10,
          categorias: [] // Empty array
        })
        expect.fail('Should have thrown validation error')
      } catch (error: any) {
        expect(error.message).to.include('greater than or equal to 1')
      }
    })
  })
})

describe('DocuDB - Schema Data Type Preservation', () => {
  describe('Basic Type Validation', () => {
    let schema: Schema

    beforeEach(() => {
      schema = new Schema({
        stringField: { type: 'string' },
        numberField: { type: 'number' },
        booleanField: { type: 'boolean' },
        dateField: { type: 'date' },
        arrayField: { type: 'array' },
        objectField: { type: 'object' }
      })
    })

    it('should preserve string', () => {
      const doc = {
        stringField: 'test string'
      }
      const validated = schema.validate(doc)
      expect(typeof validated.stringField).equal('string')
      expect(validated.stringField).equal('test string')
    })

    it('should preserve number', () => {
      const doc = {
        numberField: 42.5
      }
      const validated = schema.validate(doc)
      expect(typeof validated.numberField).equal('number')
      expect(validated.numberField).equal(42.5)
    })

    it('should preserve boolean', () => {
      const doc = {
        booleanField: true
      }
      const validated = schema.validate(doc)
      expect(typeof validated.booleanField).equal('boolean')
      expect(validated.booleanField).equal(true)
    })

    it('should preserve date', () => {
      const date = new Date()
      const doc = {
        dateField: date
      }
      const validated = schema.validate(doc)
      expect(validated.dateField instanceof Date).equal(true)
      expect(validated.dateField.getTime()).equal(date.getTime())
    })

    it('should preserve array', () => {
      const doc = {
        arrayField: [1, 'test', { key: 'value' }]
      }
      const validated = schema.validate(doc)
      expect(Array.isArray(validated.arrayField)).to.be.true
      expect(validated.arrayField).to.deep.equal([1, 'test', { key: 'value' }])
    })

    it('should preserve object', () => {
      const doc = {
        objectField: { key1: 'value1', key2: 42 }
      }
      const validated = schema.validate(doc)
      expect(typeof validated.objectField).equal('object')
      expect(validated.objectField).to.deep.equal({ key1: 'value1', key2: 42 })
    })
  })

  describe('Special Cases', () => {
    it('should reject incorrect type', () => {
      const schema = new Schema({
        numberField: { type: 'number' }
      })
      expect(() => {
        schema.validate({ numberField: 'not a number' })
      }).to.throw()
    })

    it('should handle null and undefined values', () => {
      const schema = new Schema({
        optionalString: { type: 'string' },
        requiredString: { type: 'string', required: true }
      })

      const doc = {
        requiredString: 'present'
      }
      const validated = schema.validate(doc)
      expect(validated.optionalString).to.be.undefined
      expect(validated.requiredString).equal('present')
    })

    it('should apply default values', () => {
      const schema = new Schema({
        defaultString: { type: 'string', default: 'default value' },
        defaultNumber: { type: 'number', default: 0 },
        defaultDate: { type: 'date', default: () => new Date(2023, 0, 1) }
      })

      const validated = schema.validate({})
      expect(validated.defaultString).equal('default value')
      expect(validated.defaultNumber).equal(0)
      expect(validated.defaultDate.getFullYear()).equal(2023)
    })
  })
})

describe('DocuDB - Query Operations', () => {
  let db: Database
  let productos: Collection
  const testDbName = 'testQuery'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)

    db = new Database({
      name: testDbName,
      compression: false
    })
    await db.initialize()

    const productoSchema = new Schema({
      name: { type: 'string', required: true },
      price: { type: 'number', required: true },
      stock: { type: 'number', default: 0 },
      categorias: { type: 'array' }
    })

    productos = db.collection('productos', { schema: productoSchema })

    // Insert test data
    await productos.insertMany([
      {
        name: 'Laptop',
        price: 1000,
        stock: 5,
        categorias: ['Electronics', 'Computers']
      },
      {
        name: 'Mouse',
        price: 20,
        stock: 10,
        categorias: ['Electronics', 'Peripherals']
      },
      {
        name: 'Keyboard',
        price: 50,
        stock: 8,
        categorias: ['Electronics', 'Peripherals']
      },
      {
        name: 'Monitor',
        price: 300,
        stock: 3,
        categorias: ['Electronics', 'Displays']
      },
      {
        name: 'Tablet',
        price: 250,
        stock: 0,
        categorias: ['Electronics', 'Mobile']
      }
    ])
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  describe('Basic Queries', () => {
    it('should find documents with $gt operator', async () => {
      const results = await productos.find({ price: { $gt: 100 } })
      expect(results).to.have.lengthOf(3)
      expect(results.map(p => p.name)).to.have.members([
        'Laptop',
        'Monitor',
        'Tablet'
      ])
    })

    it('should find documents with $lt operator', async () => {
      const results = await productos.find({ price: { $lt: 100 } })
      expect(results).to.have.lengthOf(2)
      expect(results.map(p => p.name)).to.have.members(['Mouse', 'Keyboard'])
    })

    it('should find documents with $in operator', async () => {
      const results = await productos.find({
        categorias: { $in: ['Peripherals'] }
      })
      expect(results).to.have.lengthOf(2)
      expect(results.map(p => p.name)).to.have.members(['Mouse', 'Keyboard'])
    })
  })

  describe('Complex Queries', () => {
    it('should handle $and operator', async () => {
      const query = new Query({
        $and: [{ price: { $gt: 50 } }, { stock: { $gt: 0 } }]
      })

      const results = await productos.find(query)
      expect(results).to.have.lengthOf(2)
      expect(results.map(p => p.name)).to.have.members(['Laptop', 'Monitor'])
    })

    it('should handle $or operator', async () => {
      const query = new Query({
        $or: [{ price: { $lt: 30 } }, { stock: { $eq: 0 } }]
      })

      const results = await productos.find(query)
      expect(results).to.have.lengthOf(2)
      expect(results.map(p => p.name)).to.have.members(['Mouse', 'Tablet'])
    })

    it('should handle sorting', async () => {
      const query = new Query({}).sort({ price: 1 })
      const results = await productos.find(query)
      expect(results[0].name).to.equal('Mouse')
      expect(results[4].name).to.equal('Laptop')
    })

    it('should handle limit', async () => {
      const query = new Query({}).limit(2)
      const results = await productos.find(query)
      expect(results).to.have.lengthOf(2)
    })
  })
})

describe('DocuDB - Data Type Preservation After Query Operations', () => {
  let db: Database
  let products: Collection
  const testDbName = 'testDataTypes'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)

    db = new Database({
      name: testDbName,
      compression: false
    })
    await db.initialize()

    const productSchema = new Schema({
      name: { type: 'string', required: true },
      price: { type: 'number', required: true },
      stock: { type: 'number', default: 0 },
      lastUpdated: { type: 'date' },
      tags: { type: 'array', default: [] },
      metadata: { type: 'object', default: {} }
    })

    products = db.collection('products', { schema: productSchema })

    // Insert test data
    await products.insertOne({
      name: 'Test Product',
      price: 100,
      stock: 5,
      lastUpdated: new Date(),
      tags: ['test', 'product'],
      metadata: { origin: 'local' }
    })
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  describe('Data Type Preservation After Find Operations', () => {
    it('should maintain data types after find operation', async () => {
      const result = await products.findOne({ name: 'Test Product' })
      expect(result).to.exist

      if (result != null) {
        expect(typeof result.name).to.equal('string')
        expect(typeof result.price).to.equal('number')
        expect(typeof result.stock).to.equal('number')
        expect(result.lastUpdated).to.be.instanceOf(Date)
        expect(Array.isArray(result.tags)).to.be.true
        expect(typeof result.metadata).to.equal('object')
        expect(result.metadata).to.not.be.an('array')
      }
    })

    it('should maintain data types after complex query operations', async () => {
      const result = await products.findOne({
        price: { $gte: 50 },
        tags: { $in: ['test'] }
      })

      expect(result).to.exist

      if (result != null) {
        expect(typeof result.name).to.equal('string')
        expect(typeof result.price).to.equal('number')
        expect(result.lastUpdated).to.be.instanceOf(Date)
        expect(Array.isArray(result.tags)).to.be.true
      }
    })
  })

  describe('Data Type Preservation After Update Operations', () => {
    it('should maintain data types after full document update', async () => {
      const doc = await products.findOne({ name: 'Test Product' })
      expect(doc).to.exist

      if (doc != null) {
        const updated = await products.updateById(doc._id, {
          $set: {
            price: 150,
            stock: 10,
            lastUpdated: new Date(),
            tags: ['test', 'updated'],
            metadata: { status: 'updated' }
          }
        })

        expect(updated).to.exist

        if (updated != null) {
          expect(typeof updated.price).to.equal('number')
          expect(typeof updated.stock).to.equal('number')
          expect(updated.lastUpdated).to.be.instanceOf(Date)
          expect(Array.isArray(updated.tags)).to.be.true
          expect(typeof updated.metadata).to.equal('object')
          expect(updated.metadata).to.not.be.an('array')
        }

        // Verify data persistence
        const retrieved = await products.findById(doc._id)

        expect(retrieved).to.exist

        if (retrieved != null) {
          expect(typeof retrieved.price).to.equal('number')
          expect(typeof retrieved.stock).to.equal('number')
          expect(retrieved.lastUpdated).to.be.instanceOf(Date)
          expect(Array.isArray(retrieved.tags)).to.be.true
          expect(typeof retrieved.metadata).to.equal('object')
        }
      }
    })

    it('should maintain data types after partial update', async () => {
      const doc = await products.findOne({ name: 'Test Product' })
      expect(doc).to.exist

      if (doc != null) {
        // Partial update
        await products.updateById(doc._id, {
          $set: {
            price: 200
          }
        })

        const updated = await products.findById(doc._id)
        expect(updated).to.exist

        if (updated != null) {
          expect(typeof updated.price).to.equal('number')
          expect(typeof updated.stock).to.equal('number')
          expect(updated.lastUpdated).to.be.instanceOf(Date)
          expect(Array.isArray(updated.tags)).to.be.true
          expect(typeof updated.metadata).to.equal('object')
        }
      }
    })
  })
})
