/**
 * Aggregation pipeline.
 *
 * A deliberately small subset of the MongoDB aggregation framework, enough for
 * reporting queries without pulling in a full execution engine.
 *
 * Supported stages: `$match`, `$project`, `$group`, `$sort`, `$skip`, `$limit`,
 * `$count`, `$unwind`.
 */

import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  AggregationStage,
  Document,
  GroupStage,
  SortOptions
} from '../types/index.js'
import { compileCriteria, sortDocuments } from '../query/query.js'
import { compareValues, getNestedValue } from '../utils/paths.js'

/** Maximum number of documents materialized by `$group` */
const MAX_GROUP_KEYS = 100_000

/**
 * Executes an aggregation pipeline
 * @param documents - Documents to process
 * @param pipeline - Ordered list of stages
 * @returns Pipeline output
 */
export function aggregate (
  documents: Document[],
  pipeline: AggregationStage[]
): Document[] {
  if (!Array.isArray(pipeline)) {
    throw new DocuDBError(
      'Aggregation pipeline must be an array of stages',
      MCO_ERROR.QUERY.INVALID_STAGE
    )
  }

  let result: Document[] = documents

  for (const stage of pipeline) {
    if (stage === null || typeof stage !== 'object') {
      throw new DocuDBError(
        'Aggregation stages must be objects',
        MCO_ERROR.QUERY.INVALID_STAGE,
        { stage }
      )
    }

    const name = Object.keys(stage)[0]
    const body = (stage as Record<string, unknown>)[name]

    switch (name) {
      case '$match':
        result = result.filter(doc => compileCriteria(body as never)(doc))
        break

      case '$project':
        result = project(result, body as Record<string, unknown>)
        break

      case '$group':
        result = group(result, body as GroupStage)
        break

      case '$sort':
        result = sortDocuments(result, body as SortOptions)
        break

      case '$skip':
        result = result.slice(Math.max(0, Number(body) || 0))
        break

      case '$limit':
        result = result.slice(0, Math.max(0, Number(body) || 0))
        break

      case '$count':
        result = [{ [String(body)]: result.length } as Document]
        break

      case '$unwind':
        result = unwind(result, body)
        break

      default:
        throw new DocuDBError(
          `Unsupported aggregation stage: ${String(name)}`,
          MCO_ERROR.QUERY.INVALID_STAGE,
          { stage: name }
        )
    }
  }

  return result
}

/**
 * Includes or excludes fields
 * @param documents - Documents to project
 * @param spec - Projection specification
 * @returns Projected documents
 */
function project (
  documents: Document[],
  spec: Record<string, unknown>
): Document[] {
  const isInclusion = Object.entries(spec).some(([field, value]) =>
    field !== '_id' && value !== 0 && value !== false
  )

  const computed = new Map<string, (doc: Document) => unknown>()
  const plain = new Map<string, 0 | 1>()

  if (isInclusion) {
    for (const [field, expression] of Object.entries(spec)) {
      if (isComputedExpression(expression)) {
        computed.set(field, compileProjection(expression, field))
        continue
      }
      plain.set(field, expression === 0 || expression === false ? 0 : 1)
    }
  } else {
    for (const field of Object.keys(spec)) plain.set(field, 0)
    for (const field of Object.keys(spec)) {
      if (!field.includes('$')) continue
      computed.set(field, compileProjection(spec[field], field))
    }
  }

  return documents.map(doc => {
    const result = {} as Document

    for (const [field, include] of plain) {
      if (include === 1) {
        if (field === '_id') {
          result._id = doc._id
          continue
        }
        const value = getNestedValue(doc, field)
        if (value !== undefined) assign(result, field, value)
      }
    }

    if (!isInclusion) {
      for (const key of Object.keys(doc)) {
        if (plain.has(key)) continue
        result[key] = doc[key]
      }
    }

    for (const [field, evaluate] of computed) {
      const value = evaluate(doc)
      if (value !== undefined) assign(result, field, value)
    }

    if (plain.get('_id') !== 0 && result._id === undefined && doc._id !== undefined) {
      result._id = doc._id
    }

    return result
  })
}

/**
 * Tells whether a `$project` expression must be evaluated instead of being
 * read as a plain field.
 * @param expression - Expression coming from the specification
 * @returns true when the expression computes a value
 */
function isComputedExpression (expression: unknown): boolean {
  if (expression === null || typeof expression !== 'object' || Array.isArray(expression)) {
    return false
  }
  const keys = Object.keys(expression as Record<string, unknown>)
  return keys.length > 0 && keys.every(key => key.startsWith('$'))
}

/**
 * Groups documents and computes accumulators
 * @param documents - Documents to group
 * @param spec - `$group` specification
 * @returns Grouped documents
 */
function group (
  documents: Document[],
  spec: GroupStage
): Document[] {
  const buckets = new Map<string, { key: unknown, docs: Document[] }>()

  for (const doc of documents) {
    const key = evaluateGroupKey(spec._id, doc)
    const keyString = typeof key === 'object' && key !== null
      ? JSON.stringify(key)
      : String(key)

    let bucket = buckets.get(keyString)
    if (bucket === undefined) {
      if (buckets.size >= MAX_GROUP_KEYS) {
        throw new DocuDBError(
          `$group produced more than ${MAX_GROUP_KEYS} groups: refine the _id expression`,
          MCO_ERROR.QUERY.INVALID_STAGE,
          { stage: '$group' }
        )
      }
      bucket = { key, docs: [] }
      buckets.set(keyString, bucket)
    }
    bucket.docs.push(doc)
  }

  const result: Document[] = []
  for (const bucket of buckets.values()) {
    const grouped: Document = { _id: bucket.key as string }
    for (const [field, accumulator] of Object.entries(spec)) {
      if (field === '_id') continue
      const operator = Object.keys(accumulator as Record<string, unknown>)[0]
      const operand = (accumulator as Record<string, unknown>)[operator]
      const value = computeAccumulator(operator, operand, bucket.docs)
      if (value !== undefined) grouped[field] = value
    }
    result.push(grouped)
  }

  return result
}

/**
 * Evaluates the `_id` expression of a `$group` stage
 * @param expression - Group key expression
 * @param doc - Current document
 * @returns Group key
 */
function evaluateGroupKey (expression: unknown, doc: Document): unknown {
  if (typeof expression === 'string') {
    const path = expression.startsWith('$') ? expression.slice(1) : expression
    return getNestedValue(doc, path)
  }
  if (expression === null || typeof expression !== 'object') return expression

  const computed: Record<string, unknown> = {}
  for (const [field, nested] of Object.entries(expression as Record<string, unknown>)) {
    computed[field] = field === '$literal'
      ? nested
      : evaluateGroupKey(nested, doc)
  }
  return computed
}

/**
 * Computes one accumulator over a group
 * @param operator - Accumulator name
 * @param operand - Accumulator operand
 * @param docs - Documents of the group
 * @returns Accumulated value
 */
function computeAccumulator (
  operator: string,
  operand: unknown,
  docs: Document[]
): unknown {
  const field = typeof operand === 'string' && operand.startsWith('$')
    ? operand.slice(1)
    : undefined

  const values = (): unknown[] =>
    field === undefined ? docs.map(doc => doc._id) : docs.map(doc => getNestedValue(doc, field))

  switch (operator) {
    case '$sum': {
      if (typeof operand === 'number') return docs.length * operand
      return values().reduce<number>((total, value) =>
        typeof value === 'number' ? total + value : total, 0)
    }
    case '$avg': {
      const numbers = values().filter((value): value is number => typeof value === 'number')
      return numbers.length === 0
        ? null
        : numbers.reduce((total, value) => total + value, 0) / numbers.length
    }
    case '$min': {
      const candidates = values().filter(value => value !== undefined && value !== null)
      return candidates.reduce<unknown>((min, value) =>
        min === undefined || compareValues(value, min) < 0 ? value : min, undefined)
    }
    case '$max': {
      const candidates = values().filter(value => value !== undefined && value !== null)
      return candidates.reduce<unknown>((max, value) =>
        max === undefined || compareValues(value, max) > 0 ? value : max, undefined)
    }
    case '$first':
      return docs.length === 0
        ? null
        : (field === undefined ? docs[0]._id : getNestedValue(docs[0], field))
    case '$last':
      return docs.length === 0
        ? null
        : (field === undefined ? docs[docs.length - 1]._id : getNestedValue(docs[docs.length - 1], field))
    case '$push':
      return values()
    case '$addToSet': {
      const unique = new Map<string, unknown>()
      for (const value of values()) {
        unique.set(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value), value)
      }
      return [...unique.values()]
    }
    case '$count':
      return docs.length
    default:
      throw new DocuDBError(
        `Unsupported accumulator: ${operator}`,
        MCO_ERROR.QUERY.INVALID_STAGE,
        { operator }
      )
  }
}

/**
 * Unwinds an array field
 * @param documents - Documents to unwind
 * @param expression - Field path (optionally as `{ path: '$items' }`)
 * @returns Flattened documents
 */
function unwind (documents: Document[], expression: unknown): Document[] {
  const field = typeof expression === 'string'
    ? expression
    : String((expression as { path?: string })?.path ?? '')
  const path = field.startsWith('$') ? field.slice(1) : field

  if (path.length === 0) {
    throw new DocuDBError(
      '$unwind requires a field path',
      MCO_ERROR.QUERY.INVALID_STAGE,
      { stage: '$unwind' }
    )
  }

  const result: Document[] = []
  for (const doc of documents) {
    const value = getNestedValue(doc, path)
    if (Array.isArray(value)) {
      for (const item of value) {
        const copy: Document = { ...doc }
        assign(copy, path, item)
        result.push(copy)
      }
    } else {
      result.push(doc)
    }
  }
  return result
}

/**
 * Builds an evaluator for a projection expression
 * @param expression - Projection expression
 * @param alias - Output field name
 * @returns Evaluator
 */
function compileProjection (
  expression: unknown,
  alias: string
): (doc: Document) => unknown {
  if (expression === 0 || expression === false) return () => undefined

  if (expression === 1 || expression === true) {
    return doc => getNestedValue(doc, alias)
  }

  if (typeof expression === 'string') {
    if (expression === '$$ROOT') return doc => doc
    if (expression === '$$CURRENT') return doc => doc
    if (expression.startsWith('$')) return doc => getNestedValue(doc, expression.slice(1))
    return () => expression
  }

  if (expression !== null && typeof expression === 'object') {
    const operators = Object.keys(expression as Record<string, unknown>)
    if (operators.length === 1 && operators[0].startsWith('$')) {
      const operator = operators[0]
      const operand = (expression as Record<string, unknown>)[operator]
      switch (operator) {
        case '$literal':
          return () => operand
        case '$add':
        case '$subtract':
        case '$multiply':
        case '$divide':
        case '$concat': {
          const operands = (Array.isArray(operand) ? operand : [operand]).map(entry =>
            typeof entry === 'string' && entry.startsWith('$')
              ? (doc: Document) => getNestedValue(doc, entry.slice(1))
              : () => entry
          )
          return doc => {
            const values = operands.map(fn => fn(doc))
            switch (operator) {
              case '$add': return values.reduce<number>((a, b) => Number(a) + Number(b), 0)
              case '$subtract': return Number(values[0]) - Number(values[1])
              case '$multiply': return values.reduce<number>((a, b) => Number(a) * Number(b), 1)
              case '$divide':
                return Number(values[1]) === 0 ? null : Number(values[0]) / Number(values[1])
              default: return values.map(String).join('')
            }
          }
        }
        default:
          break
      }
    }
  }

  throw new DocuDBError(
    `Unsupported projection expression in "${alias}"`,
    MCO_ERROR.QUERY.INVALID_STAGE,
    { stage: '$project', alias }
  )
}

/**
 * Assigns a value using dot notation
 * @param target - Target object
 * @param path - Dot separated path
 * @param value - Value to assign
 */
function assign (target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = target
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]
    if (current[part] === null || typeof current[part] !== 'object') current[part] = {}
    current = current[part]
  }
  current[parts[parts.length - 1]] = value
}

export default aggregate
