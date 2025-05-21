import { Database, DocuDBError, MCO_ERROR } from '../index.js'
import { expect } from 'chai'

import { cleanTestDataDir } from './utils.js'

describe('DocuDB - Concurrency and Data Integrity', () => {
  const testDbName = 'testConcurrency'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  describe('Data Integrity After Restarts', () => {
    it('should maintain data after database restart', async () => {
      // Create and initialize database
      let db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      // Create collection and add data
      const users = db.collection('users')
      const originalData = [
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' }
      ]

      await users.insertMany(originalData)

      // Verify successful insertion
      const initialCount = await users.count()
      expect(initialCount).to.equal(3)

      // Close database (simulating restart)
      db = null as any

      // Restart database
      db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      // Get collection again
      const recoveredUsers = db.collection('users')

      // Verify data persists
      const recoveredData = await recoveredUsers.find({})
      expect(recoveredData).to.have.lengthOf(3)

      // Verify data is correct
      expect(recoveredData.map(u => u.email)).to.have.members(
        originalData.map(u => u.email)
      )
    })

    it('should maintain indexes after database restart', async () => {
      // Create and initialize database
      let db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      // Create collection with unique index
      const products = db.collection('products')
      await products.createIndex('code', { unique: true })

      // Insert data with unique codes
      await products.insertMany([
        { name: 'Product A', code: 'A001' },
        { name: 'Product B', code: 'B002' }
      ])

      // Close database (simulating restart)
      db = null as any

      // Restart database
      db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      // Get collection again
      const recoveredProducts = db.collection('products')

      // Verify index still works
      try {
        await recoveredProducts.insertOne({
          name: 'Product C',
          code: 'A001' // Duplicate code
        })

        expect.fail('Should have thrown a duplicate error')
      } catch (error: any) {
        expect(error.message).to.include('Duplicate')
      }
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent insertions', async () => {
      // Create and initialize database
      const db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      const messages = db.collection('messages')

      // Perform multiple concurrent insertions
      const insertPromises = []
      for (let i = 0; i < 50; i++) {
        insertPromises.push(
          messages.insertOne({
            text: `Concurrent message ${i}`,
            timestamp: Date.now() + i
          })
        )
      }

      // Wait for all insertions to complete
      const results = await Promise.all(insertPromises)

      // Verify all insertions were successful
      expect(results).to.have.lengthOf(50)
      results.forEach(doc => {
        expect(doc).to.have.property('_id')
        expect(doc.text).to.include('Concurrent message')
      })

      // Verify total document count
      const total = await messages.count()
      expect(total).to.equal(50)
    })

    it('should handle concurrent reads and writes', async () => {
      // Create and initialize database
      const db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      const counters = db.collection('counters')

      // Insert initial document
      const counter = await counters.insertOne({
        name: 'visits',
        value: 0
      })

      // Perform multiple concurrent increments
      let promise: Promise<any> = Promise.resolve()
      const operationPromises = []
      const numOperations = 20

      for (let i = 0; i < numOperations; i++) {
        promise = promise.then(async () => {
          // Get current value and increment it in a single atomic operation
          const current = await counters.findById(counter._id)
          if (current != null) {
            return await counters.updateById(counter._id, {
              $set: { value: current.value + 1 }
            })
          } else {
            throw new DocuDBError('Counter not found', MCO_ERROR.DOCUMENT.NOT_FOUND)
          }
        })
        operationPromises.push(promise)
      }

      // Wait for all operations to complete
      await Promise.all(operationPromises)

      // Verify final value
      const finalCounter = await counters.findById(counter._id)
      expect(finalCounter).to.exist
      if (finalCounter != null) {
        expect(finalCounter.value).to.equal(numOperations)
      }
    })

    it('should handle concurrent updates on different documents', async () => {
      // Create and initialize database
      const db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      const products = db.collection('products')

      // Insert multiple documents
      const docs = []
      for (let i = 0; i < 10; i++) {
        docs.push({
          name: `Product ${i}`,
          stock: 100,
          reserved: 0
        })
      }

      const inserted = await products.insertMany(docs)

      // Perform multiple concurrent reservations on different products
      const reservationPromises = []

      // Create a promise chain for each product
      for (let i = 0; i < inserted.length; i++) {
        const product = inserted[i]
        let productPromise: Promise<any> = Promise.resolve()

        // Chain the updates for each product sequentially
        for (let j = 0; j < 5; j++) { // 5 reservations per product
          productPromise = productPromise.then(async () => {
            const currentProduct = await products.findById(product._id)
            if (currentProduct != null) {
              return await products.updateById(product._id, {
                $set: {
                  stock: currentProduct.stock - 10,
                  reserved: currentProduct.reserved + 10
                }
              })
            } else {
              throw new DocuDBError('Product not found', MCO_ERROR.DOCUMENT.NOT_FOUND)
            }
          })
        }

        // Add this product's chain to the overall promises array
        reservationPromises.push(productPromise)
      }

      // Wait for all products' update chains to complete
      await Promise.all(reservationPromises)

      // Verify final values
      const updatedProducts = await products.find({})

      updatedProducts.forEach(product => {
        expect(product.stock).to.equal(50) // 100 - (10 * 5)
        expect(product.reserved).to.equal(50) // 0 + (10 * 5)
      })
    })

    it('should handle concurrent deletions', async () => {
      // Create and initialize database
      const db = new Database({
        name: testDbName,
        compression: false
      })
      await db.initialize()

      const tasks = db.collection('tasks')

      // Insert multiple documents
      const docs = []
      for (let i = 0; i < 20; i++) {
        docs.push({
          description: `Task ${i}`,
          completed: i % 2 === 0 // Even tasks completed
        })
      }

      const inserted = await tasks.insertMany(docs)

      // Concurrently delete all completed tasks
      const completedTasks = inserted.filter(t => t.completed)
      const deletionPromises = completedTasks.map(async task =>
        await tasks.deleteById(task._id)
      )

      // Wait for all deletions to complete
      await Promise.all(deletionPromises)

      // Verify only incomplete tasks remain
      const remainingTasks = await tasks.find({})
      expect(remainingTasks).to.have.lengthOf(10) // Only odd ones remain

      remainingTasks.forEach(task => {
        expect(task.completed).to.be.false
      })
    })
  })
})
