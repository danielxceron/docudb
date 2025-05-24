/**
 * Query Module (MQL - DocuDB Query Language)
 * Implements a simple and powerful query language for filtering documents
 */

import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  QueryCriteria,
  SortOptions,
  SelectFields,
  Document,
  Query as QueryInterface,
  DocumentWithId
} from '../types/index.js'

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
    this.criteria = criteria
    this.sortOptions = null
    this.limitValue = null
    this.skipValue = 0
    this.selectFields = null
  }

  /**
   * Evaluates if a document matches the query criteria
   * @param doc - Document to evaluate
   * @returns true if the document matches the criteria
   */
  matches (doc: Document): boolean {
    return this._evaluateCriteria(doc, this.criteria)
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
      const selectObj: SelectFields = {}
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
  execute (documents: Document[]): DocumentWithId[] {
    // Filter documents according to criteria
    let results = []

    // Always use the matches method to evaluate criteria
    // This allows handling complex queries with multiple levels of nested operators
    results = documents.filter(doc => this.matches(doc))

    // Apply sorting if defined
    if (this.sortOptions != null) {
      results = this._applySorting(results)
    }

    // Apply skip
    if (this.skipValue > 0) {
      results = results.slice(this.skipValue)
    }

    // Apply limit
    if (this.limitValue !== null) {
      results = results.slice(0, this.limitValue)
    }

    // Apply field projection
    if (this.selectFields != null) {
      results = this._applyProjection(results)
    }

    return results as DocumentWithId[]
  }

  /**
   * Recursively evaluates query criteria
   * @param {Object} doc - Document to evaluate
   * @param {QueryCriteria} criteria - Query criteria
   * @returns {boolean} - true if the document matches the criteria
   * @private
   */
  _evaluateCriteria (doc: Document, criteria: QueryCriteria = {}): boolean {
    // If criteria is null or undefined, always matches
    if (criteria == null) return true

    // For each key in the criteria
    for (const key in criteria) {
      // Special operators
      if (key.startsWith('$')) {
        switch (key) {
          case '$and':
            if (!Array.isArray(criteria[key])) {
              return false
            }
            // Verify that all criteria are met
            for (const subCriteria of criteria[key]) {
              if (!this._evaluateCriteria(doc, subCriteria)) {
                return false
              }
            }
            continue // Continue with next criteria after evaluating $and
          case '$or':
            if (
              !Array.isArray(criteria[key]) ||
              !criteria[key].some(c => this._evaluateCriteria(doc, c))
            ) {
              return false
            }
            break
          case '$not':
            if (this._evaluateCriteria(doc, criteria[key] as QueryCriteria)) {
              return false
            }
            break
          default:
            throw new DocuDBError('Invalid query operator', MCO_ERROR.QUERY.INVALID_OPERATOR, { operator: key })
        }
      } else {
        // Get field value from document
        const value = this._getNestedValue(doc, key)

        // If criteria is an object, it may contain operators
        if (criteria[key as keyof QueryCriteria] !== null && typeof criteria[key as keyof QueryCriteria] === 'object') {
          // Check each operator in criteria
          for (const op in criteria[key as keyof QueryCriteria]) {
            if (!this._evaluateOperator(op, value, criteria[key as keyof QueryCriteria][op])) {
              return false
            }
          }
        } else if (!this._equals(value, criteria[key as keyof QueryCriteria])) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Evaluates a specific operator
   * @param {string} operator - Operator to evaluate
   * @param {*} docValue - Document value
   * @param {*} criteriaValue - Criteria value
   * @returns {boolean} - true if the operator condition is met
   * @private
   */
  _evaluateOperator (operator: string, docValue: any, criteriaValue: any): boolean {
    switch (operator) {
      case '$eq':
        return this._equals(docValue, criteriaValue)
      case '$ne':
        return !this._equals(docValue, criteriaValue)
      case '$gt':
        return docValue > criteriaValue
      case '$gte':
        return docValue >= criteriaValue
      case '$lt':
        return docValue < criteriaValue
      case '$lte':
        return docValue <= criteriaValue
      case '$in':
        if (Array.isArray(criteriaValue)) {
          // If docValue is an array, check if any element matches any criteria value
          if (Array.isArray(docValue)) {
            return docValue.some(dv =>
              criteriaValue.some(cv => this._equals(dv, cv))
            )
          }
          // If docValue is not an array, check if it matches any criteria value
          return criteriaValue.some(v => this._equals(docValue, v))
        }
        return false
      case '$nin':
        if (Array.isArray(criteriaValue)) {
          // If docValue is an array, verify that no element matches any criteria value
          if (Array.isArray(docValue)) {
            return !docValue.some(dv => criteriaValue.some(cv => this._equals(dv, cv)))
          }
          // If docValue is not an array, verify it doesn't match any criteria value
          return !criteriaValue.some(v => this._equals(docValue, v))
        }
        return true
      case '$exists':
        return criteriaValue !== undefined ? docValue !== undefined : docValue === undefined
      case '$regex': {
        if (typeof docValue !== 'string') return false
        const flags = criteriaValue.$options ?? ''
        const pattern =
          criteriaValue instanceof RegExp
            ? criteriaValue
            : new RegExp(criteriaValue, flags)
        return pattern.test(docValue)
      }
      case '$size':
        return Array.isArray(docValue) && docValue.length === criteriaValue
      case '$all':
        return (
          Array.isArray(docValue) &&
          Array.isArray(criteriaValue) &&
          criteriaValue.every(v => docValue.some(dv => this._equals(dv, v)))
        )
      default:
        throw new DocuDBError('Invalid query operator', MCO_ERROR.QUERY.INVALID_OPERATOR, { operator })
    }
  }

  /**
   * Compares two values to determine if they are equal
   * @param {*} a - First value
   * @param {*} b - Second value
   * @returns {boolean} - true if values are equal
   * @private
   */
  _equals (a: any, b: any): boolean {
    if (a === b) return true

    // Date comparison
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }

    // Object comparison
    if (
      a !== null &&
      b !== null &&
      typeof a === 'object' &&
      typeof b === 'object'
    ) {
      const keysA = Object.keys(a)
      const keysB = Object.keys(b)

      if (keysA.length !== keysB.length) return false

      return keysA.every(
        key => keysB.includes(key) && this._equals(a[key], b[key])
      )
    }

    return false
  }

  /**
   * Gets a nested value from an object using dot notation
   * @param {Object} obj - Object to get value from
   * @param {string} path - Path to value using dot notation
   * @returns {*} - Found value or undefined
   * @private
   */
  _getNestedValue (obj: Document, path: string): Document | undefined {
    if (obj === undefined || path === undefined) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = current[part]
    }

    return current
  }

  /**
   * Applies sorting to results
   * @param {Array} results - Results to sort
   * @returns {Array} - Sorted results
   * @private
   */
  _applySorting (results: Document[]): Document[] {
    if (this.sortOptions == null) return results

    return [...results].sort((a, b) => {
      for (const [field, direction] of Object.entries(this.sortOptions as Record<string, 1 | -1>)) {
        const valueA = this._getNestedValue(a, field)
        const valueB = this._getNestedValue(b, field)

        // Compare values
        if (valueA === undefined || valueB === undefined) return 0
        if (valueA < valueB) return -1 * direction
        if (valueA > valueB) return 1 * direction
      }
      return 0
    })
  }

  /**
   * Applies field projection to results
   * @param {Array} results - Results to project
   * @returns {Array} - Results with projection applied
   * @private
   */
  _applyProjection (results: Document[]): Document[] {
    return results.map(doc => {
      const projected: Document = {}

      for (const [field, include] of Object.entries(this.selectFields as Record<string, 1 | -1>)) {
        if (!Number.isNaN(include)) {
          const value = this._getNestedValue(doc, field)
          if (value !== undefined) {
            // Handle nested fields
            const parts = field.split('.')
            let current = projected

            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i]
              if (current[part] === undefined) current[part] = {}
              current = current[part]
            }

            current[parts[parts.length - 1]] = value
          }
        }
      }

      return projected
    })
  }
}

export default Query
