import path from 'node:path'
import fsPromises from 'node:fs/promises'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const _filename = fileURLToPath(import.meta.url)
export const _dirname = path.join(path.dirname(_filename), '../../')

export const getTestDataDir = (testName: string = '') => {
  const testDataDir = path.join(_dirname, 'data', testName)
  return testDataDir
}

export const cleanTestDataDir = async (testName: string = '') => {
  const testDataDir = getTestDataDir(testName)
  const exists = await fsPromises.stat(testDataDir).catch(() => false)
  if (exists) {
    await fsPromises.rm(testDataDir, { recursive: true })
  }

  return testDataDir
}

// clean test data dir sync
export const cleanTestDataDirSync = (testName: string = '') => {
  const testDataDir = getTestDataDir(testName)
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true })
  }

  return testDataDir
}
