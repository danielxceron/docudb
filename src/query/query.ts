/**
 * Query Module (MQL - DocuDB Query Language)
 *
 * Implements a MongoDB-like query language. `compile()` turns the criteria
 * into a closure evaluated once per query instead of re-interpreting the
 * criteria tree for every document.
 */

import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  QueryCriteria,
  SortOptions,
  SelectFields,
  ProjectionValue,
  QueryInterface
} from '../types/index.js'
import {
  getNestedValue,
  hasNestedValue,
  compareValues,
  unsetNestedValue
} from '../utils/paths.js'

/** Predicate compiled from a criteria tree */
export type Predicate = (doc: Record<string, unknown>) => boolean

/** Set of comparison operators accepted inside a field condition */
const COMPARISON_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '$in', '$nin', '$exists', '$regex', '$options',
  '$size', '$all', '$elemMatch', '$type'
])

/** Logical operators accepted at the top level of a criteria tree */
const LOGICAL_OPERATORS = new Set(['$and', '$or', '$nor', '$not'])

class Query implements QueryInterface {
  /** Query criteria */
  public criteria: QueryCriteria
  /** Sort options */
  public sortOptions: SortOptions | null
  /** Limit value */
  public limitValue: number | null
  /** Skip value */
  public skipValue: number
  /** Fields to select */
  public selectFields: SelectFields | null

  /**
   * Creates a new query for filtering documents
   * @param criteria - Search criteria using MongoDB-like query syntax
   */
  constructor (criteria: QueryCriteria = {}) {
    this.criteria = criteria ?? {}
    this.sortOptions = null
    this.limitValue = null
    this.skipValue = 0
    this.selectFields = null
  }

  /**
   * Evaluates if a document matches the query criteria
   * @param doc - Document to evaluate
   * @returns true when the document matches the criteria
   */
  matches (doc: Record<string, unknown>): boolean {
    return compileCriteria(this.criteria)(doc)
  }

  /**
   * Compiles the criteria into a reusable predicate.
   * @returns Predicate evaluating the criteria
   */
  compile (): Predicate {
    return compileCriteria(this.criteria)
  }

  /**
   * Sorts results by specified fields
   * @param sortBy - Fields and sort direction (1 ascending, -1 descending)
   * @returns Current instance for chaining
   */
  sort (sortBy: SortOptions): Query {
    this.sortOptions = sortBy
    return this
  }

  /**
   * Limits the number of results
   * @param n - Maximum number of results
   * @returns Current instance for chaining
   */
  limit (n: number): Query {
    this.limitValue = n
    return this
  }

  /**
   * Skips a number of results
   * @param n - Number of results to skip
   * @returns Current instance for chaining
   */
  skip (n: number): Query {
    this.skipValue = n
    return this
  }

  /**
   * Selects specific fields to include in the results
   * @param fields - Fields to include
   * @returns Current instance for chaining
   */
  select (fields: SelectFields): Query {
    if (Array.isArray(fields)) {
      const selectObj: Record<string, ProjectionValue> = {}
      fields.forEach(field => (selectObj[field] = 1))
      this.selectFields = selectObj
    } else {
      this.selectFields = fields
    }
    return this
  }

  /**
   * Applies the query to a collection of documents
   * @param documents - Documents to filter
   * @returns Documents that match the criteria
   */
  execute (documents: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const predicate = this.compile()
    let results = documents.filter(doc => predicate(doc))

    if (this.sortOptions != null) {
      results = sortDocuments(results, this.sortOptions)
    }

    if (this.skipValue > 0) {
      results = results.slice(this.skipValue)
    }

    if (this.limitValue !== null) {
      results = results.slice(0, this.limitValue)
    }

    if (this.selectFields != null) {
      results = projectDocuments(results, this.selectFields)
    }

    return results
  }
}

/**
 * Compiles a criteria tree into a predicate
 * @param criteria - Criteria to compile
 * @returns Predicate evaluating the criteria
 */
export function compileCriteria (criteria: QueryCriteria): Predicate {
  if (criteria === null || criteria === undefined) {
    return () => true
  }

  if (typeof criteria !== 'object') {
    throw new DocuDBError(
      'Query criteria must be an object',
      MCO_ERROR.QUERY.INVALID_CRITERIA,
      { criteria }
    )
  }

  const checks: Predicate[] = []

  for (const key of Object.keys(criteria)) {
    const expected = (criteria as Record<string, unknown>)[key]

    if (key.startsWith('$')) {
      if (!LOGICAL_OPERATORS.has(key)) {
        throw new DocuDBError(
          `Invalid query operator: ${key}`,
          MCO_ERROR.QUERY.INVALID_OPERATOR,
          { operator: key }
        )
      }
      checks.push(compileLogical(key, expected))
      continue
    }

    checks.push(compileFieldCondition(key, expected))
  }

  if (checks.length === 0) return () => true
  if (checks.length === 1) return checks[0]
  return doc => checks.every(check => check(doc))
}

/**
 * Compiles a logical operator
 * @param operator - Logical operator name
 * @param operand - Operator operand
 * @returns Predicate
 */
function compileLogical (operator: string, operand: unknown): Predicate {
  switch (operator) {
    case '$and': {
      if (!Array.isArray(operand) || operand.length === 0) {
        throw new DocuDBError(
          '$and expects a non-empty array of criteria',
          MCO_ERROR.QUERY.INVALID_CRITERIA,
          { operator }
        )
      }
      const subs = operand.map(sub => compileCriteria(sub as QueryCriteria))
      return doc => subs.every(sub => sub(doc))
    }
    case '$or': {
      if (!Array.isArray(operand) || operand.length === 0) {
        throw new DocuDBError(
          '$or expects a non-empty array of criteria',
          MCO_ERROR.QUERY.INVALID_CRITERIA,
          { operator }
        )
      }
      const subs = operand.map(sub => compileCriteria(sub as QueryCriteria))
      return doc => subs.some(sub => sub(doc))
    }
    case '$nor': {
      if (!Array.isArray(operand) || operand.length === 0) {
        throw new DocuDBError(
          '$nor expects a non-empty array of criteria',
          MCO_ERROR.QUERY.INVALID_CRITERIA,
          { operator }
        )
      }
      const subs = operand.map(sub => compileCriteria(sub as QueryCriteria))
      return doc => !subs.some(sub => sub(doc))
    }
    case '$not': {
      const sub = compileCriteria(operand as QueryCriteria)
      return doc => !sub(doc)
    }
    /* istanbul ignore next - unreachable, guarded by LOGICAL_OPERATORS */
    default:
      throw new DocuDBError(
        `Invalid query operator: ${operator}`,
        MCO_ERROR.QUERY.INVALID_OPERATOR,
        { operator }
      )
  }
}

/**
 * Compiles the condition applied to a single field
 * @param path - Field path using dot notation
 * @param condition - Literal value, array of values or operator object
 * @returns Predicate
 */
function compileFieldCondition (path: string, condition: unknown): Predicate {
  if (Array.isArray(condition)) {
    // Implicit $in
    return doc => matchesAny(getNestedValue(doc, path), condition)
  }

  if (condition === null || typeof condition !== 'object' || condition instanceof Date || condition instanceof RegExp) {
    return doc => matchesValue(getNestedValue(doc, path), condition)
  }

  const operators = Object.keys(condition as Record<string, unknown>)
  if (operators.length === 0) {
    return doc => valuesEqual(getNestedValue(doc, path), condition)
  }

  const checks: Predicate[] = []
  const raw = condition as Record<string, unknown>
  const regexFlags = typeof raw.$regex === 'string' && typeof raw.$options === 'string'
    ? raw.$options
    : undefined

  for (const operator of operators) {
    if (!COMPARISON_OPERATORS.has(operator)) {
      throw new DocuDBError(
        `Invalid query operator: ${operator}`,
        MCO_ERROR.QUERY.INVALID_OPERATOR,
        { operator, field: path }
      )
    }
    // $options is only meaningful together with a string $regex.
    if (operator === '$options') continue
    const operand = raw[operator]
    checks.push(compileComparison(path, operator, operand, regexFlags))
  }

  return doc => checks.every(check => check(doc))
}

/**
 * Compiles a single comparison operator
 * @param path - Field path
 * @param operator - Operator name
 * @param operand - Operator operand
 * @param regexFlags - Flags coming from a sibling `$options`
 * @returns Predicate
 */
function compileComparison (
  path: string,
  operator: string,
  operand: unknown,
  regexFlags?: string
): Predicate {
  switch (operator) {
    case '$eq':
      return doc => matchesValue(getNestedValue(doc, path), operand)

    case '$ne':
      return doc => !matchesValue(getNestedValue(doc, path), operand)

    case '$gt':
      return doc => compare(getNestedValue(doc, path), operand) > 0

    case '$gte':
      return doc => compare(getNestedValue(doc, path), operand) >= 0

    case '$lt':
      return doc => compare(getNestedValue(doc, path), operand) < 0

    case '$lte':
      return doc => compare(getNestedValue(doc, path), operand) <= 0

    case '$in': {
      if (!Array.isArray(operand)) {
        throw new DocuDBError(
          '$in expects an array',
          MCO_ERROR.QUERY.INVALID_OPERATOR,
          { operator }
        )
      }
      return doc => matchesAny(getNestedValue(doc, path), operand)
    }

    case '$nin': {
      if (!Array.isArray(operand)) {
        throw new DocuDBError(
          '$nin expects an array',
          MCO_ERROR.QUERY.INVALID_OPERATOR,
          { operator }
        )
      }
      return doc => !matchesAny(getNestedValue(doc, path), operand)
    }

    case '$exists': {
      const expected = operand !== false
      return doc => hasNestedValue(doc, path) === expected
    }

    case '$regex': {
      const flags = regexFlags ?? (operand instanceof RegExp ? operand.flags : '')
      const pattern = operand instanceof RegExp
        ? new RegExp(operand.source, flags)
        : new RegExp(String(operand), flags)
      return doc => {
        const actual = getNestedValue(doc, path)
        if (typeof actual === 'string') return pattern.test(actual)
        return Array.isArray(actual) && actual.some(item => typeof item === 'string' && pattern.test(item))
      }
    }

    case '$options':
      // Consumed together with a string $regex; handled in $regex.
      return () => true

    case '$size':
      return doc => {
        const actual = getNestedValue(doc, path)
        return Array.isArray(actual) && actual.length === operand
      }

    case '$all': {
      if (!Array.isArray(operand)) {
        throw new DocuDBError(
          '$all expects an array',
          MCO_ERROR.QUERY.INVALID_OPERATOR,
          { operator }
        )
      }
      return doc => {
        const actual = getNestedValue(doc, path)
        if (!Array.isArray(actual)) return false
        return operand.every(value => actual.some(item => valuesEqual(item, value)))
      }
    }

    case '$elemMatch': {
      const sub = compileFieldCondition(path, operand)
      return doc => {
        const actual = getNestedValue(doc, path)
        if (!Array.isArray(actual)) return false
        return actual.some(item => sub(item as Record<string, unknown>))
      }
    }

    case '$type':
      return doc => matchesType(getNestedValue(doc, path), operand as string)

    /* istanbul ignore next - unreachable, guarded by COMPARISON_OPERATORS */
    default:
      throw new DocuDBError(
        `Invalid query operator: ${operator}`,
        MCO_ERROR.QUERY.INVALID_OPERATOR,
        { operator }
      )
  }
}

/**
 * Compares a document value with a criteria value, treating `null` and
 * `undefined` as equivalent the way MongoDB does.
 * @param actual - Value read from the document
 * @param expected - Value coming from the criteria
 * @returns Negative, zero or positive
 */
function compare (actual: unknown, expected: unknown): number {
  if (actual === undefined || actual === null) {
    return (expected === undefined || expected === null) ? 0 : -1
  }
  return compareValues(actual, expected)
}

/**
 * Matches a document value against a criteria value.
 *
 * Following MongoDB, a scalar criteria value matches when it equals the field
 * value *or* any element of it, which is what makes `{ tags: 'premium' }` work
 * for array fields.
 * @param actual - Value read from the document
 * @param expected - Value coming from the criteria
 * @returns true when both match
 */
export function matchesValue (actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.some(item => valuesEqual(item, expected))
  }
  return valuesEqual(actual, expected)
}

/**
 * Matches a document value against a list of criteria values, element-wise
 * when the field holds an array.
 * @param actual - Value read from the document
 * @param candidates - Values coming from `$in` / `$nin`
 * @returns true when any candidate matches
 */
export function matchesAny (actual: unknown, candidates: unknown[]): boolean {
  if (Array.isArray(actual)) {
    return actual.some(item => candidates.some(candidate => valuesEqual(item, candidate)))
  }
  return candidates.some(candidate => valuesEqual(actual, candidate))
}

/**
 * Deep equality with `null`/`undefined` equivalence
 * @param a - First value
 * @param b - Second value
 * @returns true when both values are equivalent
 */
export function valuesEqual (a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null && b === undefined) return true
  if (a === undefined && b === null) return true

  if (a instanceof Date || b instanceof Date) {
    const timeA = a instanceof Date ? a.getTime() : (a == null ? null : a)
    const timeB = b instanceof Date ? b.getTime() : (b == null ? null : b)
    return timeA === timeB
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => valuesEqual(item, b[index]))
  }

  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keysA = Object.keys(a as Record<string, unknown>)
    const keysB = Object.keys(b as Record<string, unknown>)
    if (keysA.length !== keysB.length) return false
    return keysA.every(key =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      valuesEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    )
  }

  return false
}

/**
 * Implements `$type`
 * @param value - Value read from the document
 * @param type - Expected type name
 * @returns true when the value matches the type
 */
function matchesType (value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': case 'int': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    case 'date': return value instanceof Date
    case 'array': return Array.isArray(value)
    case 'null': return value === null
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        !(value instanceof Date)
    case 'undefined': return value === undefined
    default: return false
  }
}

/**
 * Sorts documents using the total ordering of `compareValues`
 * @param docs - Documents to sort
 * @param sortOptions - Fields and directions
 * @returns A new sorted array
 */
export function sortDocuments<T> (
  docs: T[],
  sortOptions: SortOptions
): T[] {
  const entries = Object.entries(sortOptions)
  if (entries.length === 0) return docs

  return [...docs].sort((a, b) => {
    for (const [field, direction] of entries) {
      const valueA = getNestedValue(a, field)
      const valueB = getNestedValue(b, field)
      if (valueA === undefined && valueB === undefined) continue
      const result = compareValues(valueA, valueB)
      if (result !== 0) return result * direction
    }
    return 0
  })
}

/**
 * Applies an inclusion or exclusion projection
 * @param docs - Documents to project
 * @param fields - Projection definition
 * @returns Projected documents
 */
export function projectDocuments<T> (
  docs: T[],
  fields: Record<string, ProjectionValue> | string[]
): T[] {
  const normalized: Record<string, ProjectionValue> = {}
  if (Array.isArray(fields)) {
    for (const field of fields) normalized[field] = 1
  } else {
    for (const [field, value] of Object.entries(fields)) {
      normalized[field] = value
    }
  }

  const entries = Object.entries(normalized)
  if (entries.length === 0) return docs

  const isInclusion = entries.some(([, include]) => include !== 0 && include !== false)

  if (!isInclusion) {
    // Exclusion projection: shallow copy without the listed fields.
    return docs.map(doc => {
      const result: Record<string, unknown> = { ...(doc as Record<string, unknown>) }
      for (const [field] of entries) {
        if (field.includes('.')) {
          unsetNestedValue(result, field)
          continue
        }
        delete result[field]
      }
      return result as T
    })
  }

  return docs.map(doc => {
    const source = doc as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [field, include] of entries) {
      if (include === 0 || include === false) continue
      if (field === '_id') {
        result._id = source._id
        continue
      }
      const value = getNestedValue(doc, field)
      if (value !== undefined) {
        assignPath(result, field, value)
      }
    }

    // MongoDB keeps `_id` unless it is explicitly excluded.
    if (result._id === undefined && !entries.some(([field]) => field === '_id')) {
      result._id = source._id
    }

    return result as T
  })
}

/**
 * Assigns a value using dot notation, creating intermediate objects
 * @param target - Target object
 * @param path - Dot separated path
 * @param value - Value to assign
 */
function assignPath (target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === null || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part]
  }
  current[parts[parts.length - 1]] = value
}

export default Query
