import { Database, Schema } from '../index.js'
import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'
import { isValidUUID } from '../src/utils/uuidUtils.js'

import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('DocuDB - UUID Support and Custom Default Functions', () => {
  let db
  let products
  const testDbName = 'testUUID'
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

  describe('UUID ID Generation', () => {
    it('should generate UUID v4 IDs when specified in collection options', async () => {
      // Create collection with UUID ID type
      const uuidCollection = db.collection('uuidProducts', { idType: 'uuid' })

      // Insert a document
      const product = await uuidCollection.insertOne({
        name: 'Test Product',
        price: 100
      })

      // Verify ID is a valid UUID v4
      expect(product).to.have.property('_id')
      expect(isValidUUID(product._id)).to.be.true
    })

    it('should use MongoDB-style IDs by default', async () => {
      // Create collection without specifying ID type
      const defaultCollection = db.collection('defaultProducts')

      // Insert a document
      const product = await defaultCollection.insertOne({
        name: 'Test Product',
        price: 100
      })

      // Verify ID is a MongoDB-style ID (24 hex characters)
      expect(product).to.have.property('_id')
      expect(product._id).to.match(/^[0-9a-f]{24}$/i)
    })

    it('should accept valid UUID v4 IDs provided by the user', async () => {
      const uuidCollection = db.collection('userUuidProducts')

      // Insert a document with a valid UUID v4
      const uuid = '123e4567-e89b-42d3-a456-556642440000' // Valid UUID v4 format
      const product = await uuidCollection.insertOne({
        _id: uuid,
        name: 'User UUID Product',
        price: 200
      })

      // Verify the ID was preserved
      expect(product._id).to.equal(uuid)

      // Verify we can retrieve the document
      const retrieved = await uuidCollection.findById(uuid)
      expect(retrieved).to.exist
      expect(retrieved.name).to.equal('User UUID Product')
    })

    it('should reject invalid ID formats', async () => {
      const collection = db.collection('invalidIdProducts')

      try {
        await collection.insertOne({
          _id: 'not-a-valid-id-format',
          name: 'Invalid ID Product',
          price: 300
        })
        expect.fail('Should have thrown an error for invalid ID format')
      } catch (error) {
        expect(error.message).to.include('Invalid document ID format')
      }
    })
  })

  describe('Custom Default Functions', () => {
    it('should support custom functions for default values', async () => {
      // Create schema with custom function for default value
      const productSchema = new Schema({
        name: { type: 'string', required: true },
        price: { type: 'number', required: true },
        createdAt: {
          type: 'date',
          default: () => new Date()
        },
        code: {
          type: 'string',
          // Custom function that generates a code based on the document
          default: (doc) => `PROD-${doc.name.substring(0, 3).toUpperCase()}-${Math.floor(Math.random() * 1000)}`
        }
      })

      products = db.collection('products', { schema: productSchema })

      // Insert a document
      const product = await products.insertOne({
        name: 'Laptop',
        price: 1000
      })

      // Verify default values were generated
      expect(product).to.have.property('createdAt')
      expect(product.createdAt).to.be.an.instanceof(Date)

      expect(product).to.have.property('code')
      expect(product.code).to.match(/^PROD-LAP-\d{1,3}$/)
    })

    it('should support custom ID generation function', async () => {
      // Create schema with custom ID generation
      const customIdSchema = new Schema({
        name: { type: 'string', required: true },
        _id: {
          type: 'string',
          default: () => `CUSTOM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          validate: {
            pattern: /^CUSTOM-\d+-\d{1,3}$/ // Validación de formato para el ID personalizado
          }
        }
      })

      const customCollection = db.collection('customIdProducts', { schema: customIdSchema })

      // Insert a document
      const product = await customCollection.insertOne({
        name: 'Custom ID Product'
      })

      // Verify custom ID was generated
      expect(product).to.have.property('_id')
      expect(product._id).to.match(/^CUSTOM-\d+-\d{1,3}$/)

      // Verify we can retrieve the document
      const retrieved = await customCollection.findById(product._id)
      expect(retrieved).to.exist
      expect(retrieved.name).to.equal('Custom ID Product')
    })
  })
})
