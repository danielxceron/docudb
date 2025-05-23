import { Database, Schema } from '../index.js'
import { expect } from 'chai'

import { Collection } from '../src/core/database.js'

import { cleanTestDataDir } from './utils.js'

const dangerousPaths = [
  // === BASIC TRAVERSAL PATH ===
  '../',
  '../../',
  '../../../',
  '../../../../etc/passwd',
  '../../../windows/system32/config/sam',
  '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
  'folder/../../../etc/shadow',
  'uploads/../../../database.sqlite',

  // === PATH TRAVERSAL WITH SPECIFIC FILES ===
  '../etc/passwd',
  '../etc/shadow',
  '../etc/hosts',
  '../../windows/system32/config/sam',
  '../../../proc/self/environ',
  '../../../../var/log/apache2/access.log',
  '../../../home/user/.ssh/id_rsa',
  '../../root/.bash_history',

  // === URL ENCODING ===
  '%2e%2e%2f',
  '%2e%2e/',
  '%2e%2e%5c',
  '%2e%2e\\',
  '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '%2e%2e%2f%2e%2e%2f%2e%2e%2fwindows%2fsystem32%2fconfig%2fsam',
  '..%2f..%2f..%2fetc%2fpasswd',
  '..%5c..%5c..%5cwindows%5csystem32%5cconfig%5csam',

  // === DOUBLE URL ENCODING ===
  '%252e%252e%252f',
  '%252e%252e%255c',
  '%c0%ae%c0%ae%c0%af',
  '%c1%9c',

  // === UNICODE ENCODING ===
  '..%c0%af',
  '..%c1%9c',
  '\u002e\u002e\u002f',
  '\u002e\u002e\u005c',

  // === NULL BYTES ===
  '../etc/passwd\x00',
  '../../etc/shadow\u0000',
  'file.txt\x00.jpg',
  'config.ini\x00.png',

  // === CONTROL CHARACTERS ===
  'file\x01name.txt',
  'folder\x1fname',
  'document\x7fname.pdf',
  'image\x0aname.jpg',
  'script\x0dname.js',
  'data\x09file.csv',

  // === TEMPLATE INJECTION ===
  '${java:version}',
  '${env:PATH}',
  '${sys:user.name}',
  '${date:MM-dd-yyyy}',
  '#{7*7}',
  '{{7*7}}',

  // === ACCESS TO SYSTEM DIRECTORIES ===
  '/etc/passwd',
  '/etc/shadow',
  '/proc/version',
  '/proc/self/environ',
  '/proc/self/cmdline',
  '/sys/class/dmi/id/product_name',
  '/dev/random',
  '/bin/sh',
  '/usr/bin/id',

  // === WINDOWS SYSTEM PATHS ===
  'C:\\windows\\system32\\config\\sam',
  'C:\\windows\\system32\\drivers\\etc\\hosts',
  'C:\\boot.ini',
  'C:\\autoexec.bat',
  '\\windows\\system32\\config\\sam',
  '\\windows\\repair\\sam',

  // === HOME DIRECTORY ACCESS ===
  '~/',
  '~root/',
  '~admin/',
  '~/.bashrc',
  '~/.ssh/',
  '~/../../etc/passwd',

  // === DOUBLE SLASH AND VARIATIONS ===
  'folder//file.txt',
  'path///to////file',
  'dir\\\\file.txt',
  'folder/.//file.txt',
  'path/.//../file.txt',

  // === DANGEROUS ABSOLUTE PATHS ===
  '/',
  '\\',
  '/root/',
  '/admin/',
  '/var/www/',
  '/usr/local/',

  // === COMPLEX COMBINATIONS ===
  '../../../etc/passwd%00',
  '..\\..\\..\\windows\\system32\\config\\sam%00',
  'folder/../../../etc/passwd#',
  'uploads/../../database/config.ini?admin=true',
  'files/../../../app/config/database.yml',

  // === BYPASS ATTEMPTS ===
  '....//',
  '....\\\\',
  '..../',
  '....\\',
  '.../',
  '...\\',
  '....//....//....//etc/passwd',
  '....\\\\....\\\\....\\\\windows\\system32\\config\\sam',

  // === FILTER EVASION ===
  '..%252f..%252f..%252fetc%252fpasswd',
  '..\\\\..\\\\..\\\\etc\\passwd',
  'folder/..;/..;/..;/etc/passwd',
  'dir\\..;\\..;\\..;\\windows\\system32\\config\\sam',

  // === LOG POISONING ATTEMPTS ===
  '../../../var/log/apache2/access.log',
  '../../var/log/nginx/error.log',
  '../../../var/log/auth.log',
  '../../windows/system32/logfiles/',

  // === CONFIGURATION FILES ===
  '../../../etc/apache2/apache2.conf',
  '../../nginx/nginx.conf',
  '../../../app/config/database.yml',
  '../../config/settings.ini',
  '../wp-config.php',
  '../../.env',
  '../../../application.properties',

  // === EXTREME CASES ===
  '', // Empty string
  ' ', // Spaces only
  '.', // Current directory
  '..', // Parent directory
  '...', // Triple period
  '....', // Quadruple period
  '\t', // Tab
  '\n', // New line
  '\r', // Carriage return
  '\r\n', // CRLF

  // === MIXED CASE EVASION ===
  '../ETC/passwd',
  '..\\WINDOWS\\system32\\CONFIG\\sam',
  '../Etc/Passwd',
  '..\\Windows\\System32\\Config\\Sam'
]

describe('DocuDB - Error Handling', () => {
  let db: Database
  const testDbName = 'testErrors'

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

  describe('Initialization Errors', () => {
    it('should handle errors when initializing with invalid directory', async () => {
      try {
        const invalidDb = new Database({
          name: 'invalid/db', // Name with invalid characters for directory
          dataDir: '/ruta/inexistente/invalid/db'
        })
        await invalidDb.initialize()
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Invalid database name')
      }
    })
  })

  describe('Collection Errors', () => {
    it('should reject invalid collection names', () => {
      try {
        db.collection('')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Collection name')
      }

      try {
        db.collection(null as any)
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Collection name')
      }

      try {
        db.collection(123 as any)
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Collection name')
      }
    })

    it('should handle errors when deleting non-existent collections', async () => {
      const result = await db.dropCollection('coleccionInexistente')
      expect(result).to.be.false
    })
  })

  describe('Schema Validation Errors', () => {
    let productos: Collection

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
      } catch (error: any) {
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
      } catch (error: any) {
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
      } catch (error: any) {
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
      } catch (error: any) {
        expect(error.message).to.include('allowed')
      }
    })
  })

  describe('CRUD Operation Errors', () => {
    let productos: Collection

    beforeEach(async () => {
      productos = db.collection('productos')
    })

    it('should handle errors when searching with invalid ID', async () => {
      try {
        await productos.findById('id-no-valido' as any)
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Invalid document ID format')
      }
    })

    it('should handle errors when updating with invalid ID', async () => {
      try {
        await productos.updateById('id-no-valido' as any, { $set: { campo: 'valor' } })
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Invalid document ID format')
      }
    })

    it('should handle errors when deleting with invalid ID', async () => {
      try {
        await productos.deleteById('id-no-valido' as any)
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Invalid document ID format')
      }
    })

    it('should accept valid MongoDB-style IDs', async () => {
      const validMongoId = '507f1f77bcf86cd799439011' // Valid 24-char hex
      try {
        // Just testing validation, not actual operation
        await productos.findById(validMongoId)
      } catch (error: any) {
        // Should fail with NOT_FOUND, not INVALID_ID
        expect(error.message).to.not.include('Invalid document ID format')
      }
    })

    it('should accept valid UUID v4 IDs', async () => {
      const validUuid = '123e4567-e89b-42d3-a456-556642440000' // Valid UUID format
      try {
        // Just testing validation, not actual operation
        await productos.findById(validUuid)
      } catch (error: any) {
        // Should fail with NOT_FOUND, not INVALID_ID
        expect(error.message).to.not.include('Invalid document ID format')
      }
    })

    it('should handle errors with invalid update operators', async () => {
      // First insert a document
      const doc = await productos.insertOne({ campo: 'valor' })

      try {
        await productos.updateById(doc._id, { $operadorInvalido: { campo: 'nuevo' } })
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('operator')
      }
    })
  })
})

describe('DocuDB - Validate Collection Name', () => {
  let db: Database

  beforeEach(async () => {
    await cleanTestDataDir('testValidateCollectionName')
  })

  afterEach(async () => {
    await cleanTestDataDir('testValidateCollectionName')
  })

  it('should reject names that contain dangerous characters', async () => {
    for (const name of dangerousPaths) {
      try {
        db = new Database({
          name,
          compression: false
        })
        await db.initialize()
        console.log(name)
        expect.fail(`Should have thrown an error for name: ${name}`)
      } catch (error: any) {
        expect(error.message).to.include('Invalid database name')
      }
    }
  })
})
