import { Database, Schema } from '../index.js'
import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('DocuDB - Schema Format Validation', () => {
  let db
  const testDbName = 'testFormatValidation'
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

  describe('Format Validation with Regex', () => {
    it('should validate string fields using format regex', async () => {
      // Create schema with format validation using regex
      const userSchema = new Schema({
        name: { type: 'string', required: true },
        email: {
          type: 'string',
          required: true,
          validate: {
            pattern: /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/ // Email format validation
          }
        },
        phone: {
          type: 'string',
          validate: {
            pattern: /^\d{3}-\d{3}-\d{4}$/ // Phone format: 123-456-7890
          }
        }
      })

      const users = db.collection('users', { schema: userSchema })

      // Valid document should pass validation
      const validUser = await users.insertOne({
        name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '123-456-7890'
      })

      expect(validUser).to.have.property('_id')
      expect(validUser.name).to.equal('John Doe')
      expect(validUser.email).to.equal('john.doe@example.com')
      expect(validUser.phone).to.equal('123-456-7890')

      // Invalid email format should fail validation
      try {
        await users.insertOne({
          name: 'Invalid Email',
          email: 'not-an-email',
          phone: '123-456-7890'
        })
        expect.fail('Should have thrown validation error for invalid email format')
      } catch (error) {
        expect(error.message).to.include('Does not match the required pattern')
      }

      // Invalid phone format should fail validation
      try {
        await users.insertOne({
          name: 'Invalid Phone',
          email: 'valid@example.com',
          phone: '1234567890' // Missing hyphens
        })
        expect.fail('Should have thrown validation error for invalid phone format')
      } catch (error) {
        expect(error.message).to.include('Does not match the required pattern')
      }
    })

    it('should support custom ID format validation', async () => {
      // Create schema with custom ID format validation
      const productSchema = new Schema({
        name: { type: 'string', required: true },
        _id: {
          type: 'string',
          default: () => `PROD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          validate: {
            pattern: /^PROD-\d+-\d{1,3}$/ // Custom ID format validation
          }
        }
      })

      const products = db.collection('products', { schema: productSchema })

      // Insert a document with auto-generated ID that matches the format
      const product = await products.insertOne({
        name: 'Format Validated Product'
      })

      // Verify custom ID was generated and matches the format
      expect(product).to.have.property('_id')
      expect(product._id).to.match(/^PROD-\d+-\d{1,3}$/)

      // Try to insert a document with an ID that doesn't match the format
      try {
        await products.insertOne({
          _id: 'INVALID-FORMAT',
          name: 'Invalid ID Format Product'
        })
        expect.fail('Should have thrown validation error for invalid ID format')
      } catch (error) {
        expect(error.message).to.include('Does not match the required pattern')
      }
    })
  })
})
