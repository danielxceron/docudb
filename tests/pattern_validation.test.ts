import { Database, Schema } from '../index.js'
import { expect } from 'chai'

import { cleanTestDataDir } from './utils.js'

describe('DocuDB - Pattern Validation', () => {
  let db: Database
  const testDbName = 'testPatternValidation'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)

    db = new Database({
      name: testDbName,
      compression: false
    })
    await db.initialize()
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  describe('Custom ID Validation', () => {
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
      } catch (error: any) {
        expect(error.message).to.include('Does not match the required pattern')
      }
    })
  })

  describe('Email Validation', () => {
    it('should validate email format correctly', async () => {
      const userSchema = new Schema({
        email: {
          type: 'string',
          required: true,
          validate: {
            pattern: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
            message: 'Invalid email format'
          }
        }
      })

      const users = db.collection('users', { schema: userSchema })

      // Valid email formats
      const validEmails = [
        'test@example.com',
        'user.name@domain.com',
        'user-name@domain.co.uk',
        'user123@subdomain.domain.org'
      ]

      for (const email of validEmails) {
        const user = await users.insertOne({ email })
        expect(user).to.have.property('_id')
        expect(user.email).to.equal(email)
      }

      // Invalid email formats
      const invalidEmails = [
        'plaintext',
        'missing@domain',
        '@domain.com',
        'user@.com',
        'user@domain..com',
        'user name@domain.com'
      ]

      for (const email of invalidEmails) {
        try {
          await users.insertOne({ email })
          expect.fail(`Should have rejected invalid email: ${email}`)
        } catch (error: any) {
          expect(error.message).to.include('Invalid email format')
        }
      }
    })
  })

  describe('Phone Number Validation', () => {
    it('should validate international phone number format', async () => {
      const userSchema = new Schema({
        phone: {
          type: 'string',
          validate: {
            pattern: /^\+?[1-9]\d{1,14}$/, // E.164 format
            message: 'Phone number must be in international format'
          }
        }
      })

      const users = db.collection('phoneUsers', { schema: userSchema })

      // Valid phone numbers
      const validPhones = [
        '+12025550179',
        '+442071234567',
        '+61491570156',
        '12025550179'
      ]

      for (const phone of validPhones) {
        const user = await users.insertOne({ phone })
        expect(user).to.have.property('_id')
        expect(user.phone).to.equal(phone)
      }

      // Invalid phone numbers
      const invalidPhones = [
        '+0123456789', // Starts with +0
        'abc12345678',
        '+123-456-7890', // Contains non-digit characters
        '+',
        ''
      ]

      for (const phone of invalidPhones) {
        try {
          await users.insertOne({ phone })
          expect.fail(`Should have rejected invalid phone: ${phone}`)
        } catch (error: any) {
          expect(error.message).to.include('Phone number must be in international format')
        }
      }
    })
  })

  describe('Username Validation', () => {
    it('should validate username format', async () => {
      const userSchema = new Schema({
        username: {
          type: 'string',
          required: true,
          validate: {
            pattern: /^[a-z0-9_-]{3,16}$/,
            message: 'Username must be 3-16 characters and contain only letters, numbers, underscores or hyphens'
          }
        }
      })

      const users = db.collection('usernameUsers', { schema: userSchema })

      // Valid usernames
      const validUsernames = [
        'user123',
        'john_doe',
        'test-user',
        'abc',
        'a-very-long-name'
      ]

      for (const username of validUsernames) {
        const user = await users.insertOne({ username })
        expect(user).to.have.property('_id')
        expect(user.username).to.equal(username)
      }

      // Invalid usernames
      const invalidUsernames = [
        'ab', // Too short
        'A-uppercase-letter', // Contains uppercase
        'user@name', // Contains special character
        'a_very_long_username_that_exceeds_limit', // Too long
        ''
      ]

      for (const username of invalidUsernames) {
        try {
          await users.insertOne({ username })
          expect.fail(`Should have rejected invalid username: ${username}`)
        } catch (error: any) {
          expect(error.message).to.include('Username must be 3-16 characters')
        }
      }
    })
  })

  describe('Product Code Validation', () => {
    it('should validate product code format', async () => {
      const productSchema = new Schema({
        productCode: {
          type: 'string',
          validate: {
            pattern: /^[A-Z]{3}-\d{5}$/,
            message: 'Product code must be in format: ABC-12345'
          }
        }
      })

      const products = db.collection('products', { schema: productSchema })

      // Valid product codes
      const validCodes = [
        'ABC-12345',
        'XYZ-00001',
        'DEF-99999'
      ]

      for (const productCode of validCodes) {
        const product = await products.insertOne({ productCode })
        expect(product).to.have.property('_id')
        expect(product.productCode).to.equal(productCode)
      }

      // Invalid product codes
      const invalidCodes = [
        'AB-12345', // Only 2 letters
        'ABCD-12345', // 4 letters
        'ABC-1234', // Only 4 digits
        'ABC-123456', // 6 digits
        'abc-12345', // Lowercase letters
        'ABC12345', // Missing hyphen
        ''
      ]

      for (const productCode of invalidCodes) {
        try {
          await products.insertOne({ productCode })
          expect.fail(`Should have rejected invalid product code: ${productCode}`)
        } catch (error: any) {
          expect(error.message).to.include('Product code must be in format')
        }
      }
    })
  })

  describe('Combined Pattern Validation', () => {
    it('should validate URL with additional length constraints', async () => {
      const urlSchema = new Schema({
        url: {
          type: 'string',
          validate: {
            pattern: /^https?:\/\/[\w\.-]+\.[a-z]{2,}\/?.*$/,
            minLength: 10,
            maxLength: 2048,
            message: 'Invalid URL format'
          }
        }
      })

      const sites = db.collection('sites', { schema: urlSchema })

      // Valid URLs
      const validUrls = [
        'https://example.com',
        'http://subdomain.example.co.uk/path',
        'https://example.com/path?query=string'
      ]

      for (const url of validUrls) {
        const site = await sites.insertOne({ url })
        expect(site).to.have.property('_id')
        expect(site.url).to.equal(url)
      }

      // Invalid URLs
      const invalidUrls = [
        'example.com', // Missing protocol
        'https://', // Missing domain
        'https://a.b', // Domain too short
        'ftp://example.com', // Wrong protocol
        'http://' + 'a'.repeat(2050) + '.com' // Too long
      ]

      for (const url of invalidUrls) {
        try {
          await sites.insertOne({ url })
          expect.fail(`Should have rejected invalid URL: ${url}`)
        } catch (error: any) {
          expect(error.message).to.include('Invalid URL format')
        }
      }
    })
  })

  describe('Conditional Validation', () => {
    it('should validate zip codes based on country', async () => {
      const addressSchema = new Schema({
        country: { type: 'string', required: true },
        zipCode: {
          type: 'string',
          validate: {
            custom: (value: string, doc: any) => {
              if (doc.country === 'US') {
                return /^\d{5}(-\d{4})?$/.test(value) || 'Invalid US zip code'
              } else if (doc.country === 'CA') {
                return /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/.test(value) || 'Invalid Canadian postal code'
              }
              return true
            }
          }
        }
      })

      const addresses = db.collection('addresses', { schema: addressSchema })

      // Valid addresses
      const validAddresses = [
        { country: 'US', zipCode: '12345' },
        { country: 'US', zipCode: '12345-6789' },
        { country: 'CA', zipCode: 'A1B2C3' },
        { country: 'CA', zipCode: 'A1B 2C3' },
        { country: 'UK', zipCode: 'ANY FORMAT' } // Not validated for UK
      ]

      for (const address of validAddresses) {
        const result = await addresses.insertOne(address)
        expect(result).to.have.property('_id')
        expect(result.country).to.equal(address.country)
        expect(result.zipCode).to.equal(address.zipCode)
      }

      // Invalid addresses
      const invalidAddresses = [
        { country: 'US', zipCode: '1234' }, // Too short
        { country: 'US', zipCode: '123456' }, // Too long
        { country: 'US', zipCode: 'ABCDE' }, // Not numeric
        { country: 'CA', zipCode: '123456' }, // Wrong format
        { country: 'CA', zipCode: 'ABCDEF' } // Wrong format
      ]

      for (const address of invalidAddresses) {
        try {
          await addresses.insertOne(address)
          expect.fail(`Should have rejected invalid address: ${JSON.stringify(address)}`)
        } catch (error: any) {
          if (address.country === 'US') {
            expect(error.message).to.include('Invalid US zip code')
          } else if (address.country === 'CA') {
            expect(error.message).to.include('Invalid Canadian postal code')
          }
        }
      }
    })
  })
})
