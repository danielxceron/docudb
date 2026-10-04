/**
 * Schema module for data validation.
 * Allows defining the structure of a document and validating it on write.
 */

import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  SchemaDefinition,
  SchemaOptions,
  SchemaFieldType,
  ValidationRules,
  SchemaInterface,
  DocumentStructure
} from '../types/index.js'

class Schema implements SchemaInterface {
  /** Schema definition */
  public definition: SchemaDefinition
  /** Schema options */
  public options: SchemaOptions

  /**
   * Creates a new schema for document validation
   * @param definition - Schema definition with field types and validation rules
   * @param options - Additional schema options
   */
  constructor (definition: SchemaDefinition, options: SchemaOptions = {}) {
    this.definition = definition
    // `strict` defaults to false: unknown fields are preserved, not rejected.
    this.options = {
      idType: options.idType ?? 'mongo',
      strict: options.strict === true,
      timestamps: options.timestamps === true
    }
  }

  /**
   * Validates a document against the schema (synchronous).
   *
   * Custom validators must be synchronous; use {@link validateAsync} when an
   * asynchronous validator (database check, HTTP call) is needed.
   * @param document - Document to validate
   * @returns The validated and normalized document
   */
  validate (document: DocumentStructure): DocumentStructure {
    const result = this._validateFields(document, false)
    this._applyStrictRules(document, result)
    this._applyTimestamps(document, result)
    return result
  }

  /**
   * Validates a document against the schema, awaiting async custom validators.
   * @param document - Document to validate
   * @returns The validated and normalized document
   */
  async validateAsync (document: DocumentStructure): Promise<DocumentStructure> {
    const result = this._validateFields(document, true)
    this._applyStrictRules(document, result)
    await this._runAsyncValidators(document)
    this._applyTimestamps(document, result)
    return result
  }

  /**
   * Validates every declared field: required, defaults, types and rules.
   * @param document - Document to validate
   * @param skipCustom - Skips custom validators (they are awaited separately)
   * @returns Normalized document
   * @private
   */
  private _validateFields (
    document: DocumentStructure,
    skipCustom: boolean
  ): DocumentStructure {
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      throw new DocuDBError(
        'The document must be an object',
        MCO_ERROR.SCHEMA.INVALID_DOCUMENT
      )
    }

    const validatedDoc: DocumentStructure = {}

    for (const [field, fieldDef] of Object.entries(this.definition)) {
      const value = document[field]

      if (fieldDef.required === true && (value === undefined || value === null)) {
        throw new DocuDBError(
          `The '${field}' field is required`,
          MCO_ERROR.SCHEMA.REQUIRED_FIELD,
          { field }
        )
      }

      if (value === undefined || value === null) {
        if ('default' in fieldDef) {
          validatedDoc[field] = typeof fieldDef.default === 'function'
            ? (fieldDef.default as (doc: DocumentStructure, name: string) => unknown)(document, field)
            : defaultValueOf(fieldDef.default)
        }
        continue
      }

      if (!matchesType(value, fieldDef.type)) {
        throw new DocuDBError(
          `The '${field}' field must be of type ${fieldDef.type}`,
          MCO_ERROR.SCHEMA.INVALID_TYPE,
          { field, type: fieldDef.type, value }
        )
      }

      if (fieldDef.validate != null) {
        runSyncValidators(value, fieldDef.validate, field, document, skipCustom)
      }

      validatedDoc[field] = fieldDef.transform != null
        ? fieldDef.transform(value)
        : value
    }

    // Preserve fields that are not part of the definition (always allowed:
    // they are handled by the strict-mode rule below).
    for (const field of Object.keys(document)) {
      if (!(field in this.definition) && !field.startsWith('_')) {
        validatedDoc[field] = document[field]
      }
    }

    // Internal fields are never dropped, even when not declared.
    for (const field of Object.keys(document)) {
      if (field.startsWith('_')) {
        validatedDoc[field] = document[field]
      }
    }

    return validatedDoc
  }

  /**
   * Awaits every asynchronous custom validator of the schema
   * @param document - Document being validated
   * @private
   */
  private async _runAsyncValidators (document: DocumentStructure): Promise<void> {
    for (const [field, fieldDef] of Object.entries(this.definition)) {
      const custom = fieldDef.validate?.custom
      if (custom == null) continue

      const value = document[field]
      if (value === undefined || value === null) continue

      const result = await custom(value, document)
      assertCustomResult(result, fieldDef.validate as ValidationRules, field, value)
    }
  }

  /**
   * Applies the strict mode rule
   * @param document - Original document
   * @param validatedDoc - Normalized document (mutated when rejecting)
   * @private
   */
  private _applyStrictRules (
    document: DocumentStructure,
    validatedDoc: DocumentStructure
  ): void {
    if (this.options.strict !== true) return

    for (const field of Object.keys(document)) {
      if (!(field in this.definition) && !field.startsWith('_')) {
        throw new DocuDBError(
          `Field not allowed: '${field}'`,
          MCO_ERROR.SCHEMA.INVALID_FIELD,
          { field }
        )
      }
    }
    // Document is valid; keep the normalized version.
    void validatedDoc
  }

  /**
   * Maintains `_createdAt` / `_updatedAt` when enabled
   * @param document - Original document
   * @param validatedDoc - Normalized document (mutated)
   * @private
   */
  private _applyTimestamps (
    document: DocumentStructure,
    validatedDoc: DocumentStructure
  ): void {
    if (this.options.timestamps !== true) return

    const now = new Date()
    validatedDoc._createdAt = (document._createdAt as Date | undefined) ?? now
    validatedDoc._updatedAt = now
  }
}

/**
 * Clones default values so that mutable defaults (`[]`, `{}`) are never shared
 * between documents.
 * @param value - Configured default
 * @returns A fresh value
 */
function defaultValueOf (value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (value instanceof Date) return new Date(value.getTime())
  if (value !== null && typeof value === 'object') return { ...(value) }
  return value
}

/**
 * Type check for schema fields
 * @param value - Value to check
 * @param type - Expected type
 * @returns true when the value matches
 */
function matchesType (value: unknown, type: SchemaFieldType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'int': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'date': return value instanceof Date && !Number.isNaN(value.getTime())
    case 'array': return Array.isArray(value)
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        !(value instanceof Date)
    case 'null': return value === null
    /* istanbul ignore next - unknown types are accepted */
    default: return true
  }
}

/**
 * Runs every declarative validation rule plus custom validators
 * @param value - Field value
 * @param rules - Validation rules
 * @param field - Field name
 * @param document - Whole document, forwarded to custom validators
 * @param skipCustom - Skips custom validators (they are awaited separately)
 * @private
 */
function runSyncValidators (
  value: unknown,
  rules: ValidationRules,
  field: string,
  document: DocumentStructure,
  skipCustom: boolean
): void {
  if (typeof value === 'number') {
    if (rules.min !== undefined && value < rules.min) {
      throw new DocuDBError(
        rules.message ?? `The value must be greater than or equal to ${rules.min}`,
        MCO_ERROR.SCHEMA.INVALID_VALUE,
        { field, value, min: rules.min }
      )
    }
    if (rules.max !== undefined && value > rules.max) {
      throw new DocuDBError(
        rules.message ?? `The value must be less than or equal to ${rules.max}`,
        MCO_ERROR.SCHEMA.INVALID_VALUE,
        { field, value, max: rules.max }
      )
    }
  }

  if (typeof value === 'string' || Array.isArray(value)) {
    const length = (value as string | unknown[]).length
    if (rules.minLength !== undefined && length < rules.minLength) {
      throw new DocuDBError(
        rules.message ?? `The length must be greater than or equal to ${rules.minLength}`,
        MCO_ERROR.SCHEMA.INVALID_LENGTH,
        { field, value, minLength: rules.minLength, currentLength: length }
      )
    }
    if (rules.maxLength !== undefined && length > rules.maxLength) {
      throw new DocuDBError(
        rules.message ?? `The length must be less than or equal to ${rules.maxLength}`,
        MCO_ERROR.SCHEMA.INVALID_LENGTH,
        { field, value, maxLength: rules.maxLength, currentLength: length }
      )
    }
  }

  if (typeof value === 'string' && rules.pattern != null) {
    const pattern = rules.pattern instanceof RegExp
      ? rules.pattern
      : new RegExp(rules.pattern)
    if (!pattern.test(value)) {
      throw new DocuDBError(
        rules.message ?? 'Does not match the required pattern',
        MCO_ERROR.SCHEMA.INVALID_REGEX,
        { field, value, pattern: pattern.toString() }
      )
    }
  }

  if (rules.enum != null && !rules.enum.includes(value)) {
    throw new DocuDBError(
      rules.message ?? `The value must be one of: ${rules.enum.join(', ')}`,
      MCO_ERROR.SCHEMA.INVALID_ENUM,
      { field, value, allowedValues: rules.enum }
    )
  }

  if (rules.custom != null && !skipCustom) {
    const result = rules.custom(value, document)
    if (typeof result === 'object' && result !== null && typeof (result as Promise<unknown>).then === 'function') {
      throw new DocuDBError(
        'Asynchronous validators require Schema.validateAsync()',
        MCO_ERROR.SCHEMA.ASYNC_VALIDATOR,
        { field }
      )
    }
    assertCustomResult(result as boolean | string | void, rules, field, value)
  }
}

/**
 * Interprets the return value of a custom validator
 * @param result - Validator result
 * @param rules - Validation rules
 * @param field - Field name
 * @param value - Field value
 * @private
 */
function assertCustomResult (
  result: boolean | string | void,
  rules: ValidationRules,
  field: string,
  value: unknown
): void {
  if (typeof result === 'string') {
    throw new DocuDBError(
      result,
      MCO_ERROR.SCHEMA.CUSTOM_VALIDATION_ERROR,
      { field, value }
    )
  }
  if (result === false) {
    throw new DocuDBError(
      rules.message ?? 'Failed custom validation',
      MCO_ERROR.SCHEMA.CUSTOM_VALIDATION_ERROR,
      { field, value }
    )
  }
}

export default Schema
