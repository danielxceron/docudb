import { expect } from 'chai'
import Database, { Collection } from '../src/core/database.js'

import { cleanTestDataDir } from './utils.js'

describe('DocuDB - Position Operations - updatePosition', function () {
  this.timeout(10000)

  let db: Database
  let products: Collection
  let productIds: string[] = []

  before(async () => {
    // Clean test data directory
    const testDataDir = await cleanTestDataDir()

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
    await cleanTestDataDir()
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
      await products.updatePosition(null as any, 2)
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.message).to.include('Invalid ID')
    }
  })

  it('should throw an error when the index is invalid', async () => {
    try {
      await products.updatePosition(productIds[0], -1)
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.message).to.include('Invalid index')
    }
  })
})

describe('DocuDB - Position Operations - getPosition', function () {
  this.timeout(10000)

  let db: Database
  let products: Collection
  let productIds: string[] = []

  before(async () => {
    // Clean test data directory
    const testDataDir = await cleanTestDataDir()

    // Initialize database
    db = new Database({
      name: 'test-get-position',
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
    await cleanTestDataDir()
  })

  it('should return the correct position of a document', async () => {
    const position = await products.getPosition(productIds[0])
    expect(position).to.equal(0)
  })

  it('should return -1 when the document does not exist', async () => {
    const position = await products.getPosition('000000000000000000000000')
    expect(position).to.equal(-1)
  })

  it('should throw an error when the ID is invalid', async () => {
    try {
      await products.getPosition(null as any)
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.message).to.include('Invalid ID')
    }
  })
})

describe('DocuDB - Position Operations - findByPosition', function () {
  this.timeout(10000)

  let db: Database
  let products: Collection
  let productIds: string[] = []

  before(async () => {
    // Clean test data directory
    const testDataDir = await cleanTestDataDir()

    // Initialize database
    db = new Database({
      name: 'test-find-by-position',
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
    await cleanTestDataDir()
  })

  it('should return the document at the specified position', async () => {
    const doc = await products.findByPosition(0)
    expect(doc).to.not.be.null
    if (doc != null) {
      expect(doc._id).to.equal(productIds[0])
    }
  })

  it('should return null when the position is out of range', async () => {
    const doc = await products.findByPosition(100)
    expect(doc).to.be.null
  })

  it('should throw an error when the position is negative', async () => {
    try {
      await products.findByPosition(-1)
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.message).to.include('Invalid Position')
    }
  })

  it('should throw an error when the ID is invalid', async () => {
    try {
      const doc = await products.findByPosition(null as any)
      console.log(doc)
      expect.fail('Should have thrown an error')
    } catch (error: any) {
      expect(error.message).to.include('Invalid Position')
    }
  })
})
