import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'
import gzip from '../src/compression/gzip.js'
import { Database, MCO_ERROR } from '../index.js'
import { cleanTestDataDir, getTestDataDir } from './utils.js'

/**
 * Builds a format v1 tree by hand: one directory per document holding
 * `chunk_N.json[.gz]`, plus a `_metadata.json` carrying `documentOrder`.
 */
async function writeLegacyCollection (
  databaseDir: string,
  collectionName: string,
  documents: Array<Record<string, unknown>>,
  options: { compressed?: boolean, chunkSize?: number, order?: string[] } = {}
): Promise<void> {
  const compressed = options.compressed === true
  const chunkSize = options.chunkSize ?? 4096
  const extension = compressed ? '.json.gz' : '.json'
  const collectionDir = path.join(databaseDir, collectionName)
  const order: string[] = []

  for (const [index, document] of documents.entries()) {
    const id = String(document._id)
    order.push(id)
    const documentDir = path.join(collectionDir, id)
    fs.mkdirSync(documentDir, { recursive: true })

    const payload = JSON.stringify(document)
    const chunks: string[] = []
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      chunks.push(payload.slice(offset, offset + chunkSize))
    }
    if (chunks.length === 0) chunks.push('')

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const name = `chunk_${chunkIndex}${extension}`
      const buffer = compressed
        ? await gzip.compress(chunk)
        : Buffer.from(chunk, 'utf8')
      fs.writeFileSync(path.join(documentDir, name), buffer)
    }

    void index
  }

  const declaredOrder = options.order ?? order
  fs.writeFileSync(
    path.join(collectionDir, '_metadata.json'),
    JSON.stringify({
      count: documents.length,
      indices: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      documentOrder: declaredOrder
    }),
    'utf8'
  )

  const indicesDir = path.join(collectionDir, '_indices')
  fs.mkdirSync(indicesDir, { recursive: true })
  fs.writeFileSync(
    path.join(indicesDir, 'name.idx'),
    JSON.stringify({
      fields: ['name'],
      field: 'name',
      isCompound: false,
      unique: false,
      sparse: false,
      entries: Object.fromEntries(
        documents.map(document => [`string:${String(document.name)}`, [String(document._id)]])
      ),
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        name: 'idx_name'
      }
    }),
    'utf8'
  )
}

describe('DocuDB - Format migration v1 to v2', function () {
  this.timeout(30000)

  const testDbName = 'testMigration'

  beforeEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  afterEach(async () => {
    await cleanTestDataDir(testDbName)
  })

  it('refuses to open a v1 directory until it is migrated', async () => {
    const root = getTestDataDir(testDbName)
    await writeLegacyCollection(path.join(root, 'shop'), 'plain', [
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'a' }
    ])

    const db = new Database({ name: 'shop', dataDir: root })
    try {
      await db.initialize()
      expect.fail('should have thrown')
    } catch (error: any) {
      expect(error.code).to.equal(MCO_ERROR.DATABASE.UNSUPPORTED_FORMAT)
      expect(error.message).to.include('migrate')
    }
  })

  it('migrates uncompressed documents and keeps order, data and indexes', async () => {
    const root = getTestDataDir(testDbName)
    const ids = [
      'aaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccc'
    ]
    await writeLegacyCollection(
      path.join(root, 'shop'),
      'products',
      [
        { _id: ids[0], name: 'first', price: 1, when: new Date('2024-01-01T00:00:00.000Z') },
        { _id: ids[1], name: 'second', price: 2 },
        { _id: ids[2], name: 'third', price: 3 }
      ],
      { order: [ids[2], ids[0], ids[1]] }
    )

    const db = new Database({ name: 'shop', dataDir: root })
    const report = await db.migrate({ from: 1, to: 2, backup: true })

    expect(report.from).to.equal(1)
    expect(report.to).to.equal(2)
    expect(report.verified).to.be.true
    expect(report.collections.products).to.equal(3)
    expect(report.backupPath).to.be.a('string')
    expect(fs.existsSync(report.backupPath as string)).to.be.true

    // Reopening now works because the manifest declares format v2.
    const reopened = new Database({ name: 'shop', dataDir: root })
    await reopened.initialize()
    const products = reopened.collection('products')

    expect(await products.countDocuments()).to.equal(3)
    expect((await products.find({})).map(doc => doc._id)).to.deep.equal([ids[2], ids[0], ids[1]])
    expect(await products.getPosition(ids[0])).to.equal(1)

    const first = await products.findById(ids[0])
    expect(first?.name).to.equal('first')
    expect(first?.when).to.be.instanceOf(Date)

    // The index snapshot survived and still answers queries.
    expect(await products.find({ name: 'third' })).to.have.lengthOf(1)

    // New writes go to the v2 layout, honouring the compression setting.
    const inserted = await products.insertOne({ name: 'fourth', price: 4 })
    const docsDir = path.join(root, 'shop', 'products', 'docs')
    expect(fs.readdirSync(docsDir).some(name => name.startsWith(inserted._id))).to.be.true
    expect((await products.findById(inserted._id))?.name).to.equal('fourth')

    await reopened.close()
    await cleanTestDataDir('testMigration.bak')
  })

  it('migrates compressed and chunked documents', async () => {
    const root = getTestDataDir(testDbName)
    const big = 'x'.repeat(5000)
    await writeLegacyCollection(
      path.join(root, 'shop'),
      'blobs',
      [
        { _id: '111111111111111111111111', blob: big },
        { _id: '222222222222222222222222', blob: 'small' }
      ],
      { compressed: true, chunkSize: 512 }
    )

    const db = new Database({ name: 'shop', dataDir: root })
    const report = await db.migrate({ from: 1, to: 2 })
    expect(report.verified).to.be.true
    expect(report.collections.blobs).to.equal(2)

    const reopened = new Database({ name: 'shop', dataDir: root })
    await reopened.initialize()
    const blobs = reopened.collection('blobs')

    const restored = await blobs.findById('111111111111111111111111')
    expect((restored?.blob as string).length).to.equal(5000)

    const docsDir = path.join(root, 'shop', 'blobs', 'docs')
    const files = fs.readdirSync(docsDir)
    expect(files.every(name => name.endsWith('.json.gz'))).to.be.true

    await reopened.close()
    await cleanTestDataDir('testMigration.bak')
  })

  it('rejects a migration with nothing to do', async () => {
    const root = getTestDataDir(testDbName)
    const db = new Database({ name: 'shop', dataDir: root })
    await db.initialize()
    try {
      await db.migrate({ from: 2, to: 2 })
      expect.fail('should have thrown')
    } catch (error: any) {
      expect(error.code).to.equal(MCO_ERROR.DATABASE.MIGRATION_ERROR)
    }
    await db.close()
  })
})
