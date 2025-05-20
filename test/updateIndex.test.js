import { expect } from 'chai'
import Database from '../src/core/database.js'
import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function modernRemove (path) {
  try {
    await fs.promises.rm(path, { recursive: true, force: true })
  } catch (error) {
    console.error(`Error deleting ${path}:`, error)
    throw error
  }
}

describe('Collection.updatePosition', function () {
  this.timeout(10000)

  let db
  let products
  let productIds = []

  before(async () => {
    // Clean test data directory
    const testDataDir = path.join(__dirname, 'data')
    if (fs.existsSync(testDataDir)) {
      await modernRemove(testDataDir)
    }

    // Initialize database
    db = new Database({
      name: 'test-update-index',
      dataDir: testDataDir
    })

    await db.initialize()
    products = db.collection('products')

    // Insert test documents
    const testProducts = [
      { name: 'Product 1', price: 100, stock: 10 },
      { name: 'Product 2', price: 200, stock: 20 },
      { name: 'Product 3', price: 300, stock: 30 },
      { name: 'Product 4', price: 400, stock: 40 },
      { name: 'Product 5', price: 500, stock: 50 }
    ]

    const results = await products.insertMany(testProducts)
    productIds = results.map(doc => doc._id)
  })

  after(async () => {
    // Clean up after tests
    const testDataDir = path.join(__dirname, 'data')
    if (fs.existsSync(testDataDir)) {
      await modernRemove(testDataDir)
    }
  })

  it('should correctly update the position of a document', async () => {
    // Verify initial order
    const initialDocs = await products.find({})
    expect(initialDocs[0]._id).to.equal(productIds[0])
    expect(initialDocs[1]._id).to.equal(productIds[1])
    expect(initialDocs[2]._id).to.equal(productIds[2])

    // Move the first product to position 2 (index 1)
    const result = await products.updatePosition(productIds[0], 1)
    expect(result).to.be.true

    // Verify the new order
    const updatedDocs = await products.find({})
    expect(updatedDocs[0]._id).to.equal(productIds[1])
    expect(updatedDocs[1]._id).to.equal(productIds[0])
    expect(updatedDocs[2]._id).to.equal(productIds[2])

    // Verify that getPosition returns the new index
    const newIndex = await products.getPosition(productIds[0])
    expect(newIndex).to.equal(1)
  })

  it('should move a document to the end when the index is greater than the collection size', async () => {
    // Move the second product to an out-of-range position
    const result = await products.updatePosition(productIds[1], 100)
    expect(result).to.be.true

    // Verify that it moved to the end
    const updatedDocs = await products.find({})
    expect(updatedDocs[updatedDocs.length - 1]._id).to.equal(productIds[1])
  })

  it('should return false when the document does not exist', async () => {
    // Try to update a document that doesn't exist
    const result = await products.updatePosition('000000000000000000000000', 2)
    expect(result).to.be.false
  })

  it('should throw an error when the ID is invalid', async () => {
    try {
      await products.updatePosition(null, 2)
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error.message).to.include('Invalid ID')
    }
  })

  it('should throw an error when the index is invalid', async () => {
    try {
      await products.updatePosition(productIds[0], -1)
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error.message).to.include('Invalid index')
    }
  })
})
