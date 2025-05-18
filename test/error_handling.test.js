const { Database, Schema } = require('../index')
const { expect } = require('chai')
const fs = require('fs')
const path = require('path')

describe('DocuDB - Error Handling', () => {
  let db
  const testDbName = 'testErrores'
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
  })

  afterEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true })
    }
  })

  describe('Initialization Errors', () => {
    it('should handle errors when initializing with invalid directory', async () => {
      const invalidDb = new Database({
        name: 'invalid/db', // Name with invalid characters for directory
        dataDir: '/ruta/inexistente/invalid/db'
      })

      try {
        await invalidDb.initialize()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Error initializing')
      }
    })
  })

  describe('Collection Errors', () => {
    it('should reject invalid collection names', () => {
      try {
        db.collection('')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Collection name')
      }

      try {
        db.collection(null)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Collection name')
      }

      try {
        db.collection(123)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Collection name')
      }
    })

    it('should handle errors when deleting non-existent collections', async () => {
      const result = await db.dropCollection('coleccionInexistente')
      expect(result).to.be.false
    })
  })

  describe('Schema Validation Errors', () => {
    let productos

    beforeEach(() => {
      const productoSchema = new Schema({
        name: { type: 'string', required: true },
        price: {
          type: 'number',
          required: true,
          validate: { min: 0 }
        },
        stock: { type: 'number', default: 0 }
      }, { strict: true })

      productos = db.collection('productos', { schema: productoSchema })
    })

    it('should reject documents without required fields', async () => {
      try {
        await productos.insertOne({ price: 100 }) // Missing name
        expect.fail('Should have thrown a validation error')
      } catch (error) {
        expect(error.message).to.include('required')
      }
    })

    it('should reject documents with incorrect types', async () => {
      try {
        await productos.insertOne({
          name: 'Test Product',
          price: 'hundred' // Should be a number
        })
        expect.fail('Should have thrown a validation error')
      } catch (error) {
        expect(error.message).to.include('type')
      }
    })

    it('should reject documents with out-of-range values', async () => {
      try {
        await productos.insertOne({
          name: 'Test Product',
          price: -10 // Should be >= 0
        })
        expect.fail('Should have thrown a validation error')
      } catch (error) {
        expect(error.message).to.include('greater than or equal to 0')
      }
    })

    it('should reject undefined fields in strict mode', async () => {
      try {
        await productos.insertOne({
          name: 'Test Product',
          price: 100,
          invalidField: 'value' // Not in schema
        })
        expect.fail('Should have thrown a validation error')
      } catch (error) {
        expect(error.message).to.include('allowed')
      }
    })
  })

  describe('CRUD Operation Errors', () => {
    let productos

    beforeEach(async () => {
      productos = db.collection('productos')
    })

    it('should handle errors when searching with invalid ID', async () => {
      try {
        await productos.findById('id-no-valido')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('ID')
      }
    })

    it('should handle errors when updating with invalid ID', async () => {
      try {
        await productos.updateById('id-no-valido', { $set: { campo: 'valor' } })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('ID')
      }
    })

    it('should handle errors when deleting with invalid ID', async () => {
      try {
        await productos.deleteById('id-no-valido')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('ID')
      }
    })

    it('should handle errors with invalid update operators', async () => {
      // First insert a document
      const doc = await productos.insertOne({ campo: 'valor' })

      try {
        await productos.updateById(doc._id, { $operadorInvalido: { campo: 'nuevo' } })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('operator')
      }
    })
  })
})
