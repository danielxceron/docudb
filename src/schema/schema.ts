/**
 * Schema module for data validation
 * Allows defining structure and validating documents
 */

import { MCO_ERROR, DocuDBError } from '../errors/errors.js'
import {
  SchemaDefinition,
  SchemaOptions,
  ValidationRules,
  Schema as SchemaInterface,
  Document
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
  constructor (
    definition: SchemaDefinition,
    options: SchemaOptions = { idType: 'mongo' }
  ) {
    this.definition = definition
    this.options = {
      strict: options.strict !== false,
      timestamps: options.timestamps === true,
      ...options
    }
  }

  /**
   * Validates a document against the schema
   * @param document - Document to validate
   * @returns Validated and normalized document
   * @throws {DocuDBError} - If the document does not comply with the schema
   */
  validate (document: Document): Document {
    if (!document || typeof document !== 'object') {
      throw new DocuDBError(
        'The document must be an object',
        MCO_ERROR.SCHEMA.INVALID_DOCUMENT
      )
    }

    const validatedDoc: Document = {}

    // Validate each field according to the schema definition
    for (const [field, fieldDef] of Object.entries(this.definition)) {
      const value = document[field]

      // Check if the field is required
      if (fieldDef.required && (value === undefined || value === null)) {
        throw new DocuDBError(
          `The '${field}' field is required`,
          MCO_ERROR.SCHEMA.REQUIRED_FIELD,
          { field }
        )
      }

      // If the value is not defined and not required, use default value or skip
      if (value === undefined || value === null) {
        if ('default' in fieldDef) {
          // Support for custom functions as default values
          if (typeof fieldDef.default === 'function') {
            // Pass the current document and field name to the function
            validatedDoc[field] = fieldDef.default(document, field)
          } else {
            validatedDoc[field] = fieldDef.default
          }
        }
        continue
      }

      // Validate type
      if (!this._validateType(value, fieldDef.type)) {
        throw new DocuDBError(
          `The '${field}' field must be of type ${fieldDef.type}`,
          MCO_ERROR.SCHEMA.INVALID_TYPE,
          { field, type: fieldDef.type, value }
        )
      }

      // Validate additional rules
      if (fieldDef.validate != null) {
        try {
          this._runValidators(value, fieldDef.validate, field)
        } catch (error: any) {
          throw new DocuDBError(
            error.message,
            error.code || MCO_ERROR.SCHEMA.VALIDATION_ERROR,
            { field, ...error.details }
          )
        }
      }

      // Apply transformations if they exist
      if (
        fieldDef.transform != null &&
        typeof fieldDef.transform === 'function'
      ) {
        validatedDoc[field] = fieldDef.transform(value)
      } else {
        validatedDoc[field] = value
      }
    }

    // In strict mode, verify there are no additional fields
    if (this.options.strict) {
      for (const field in document) {
        if (!(field in this.definition) && !field.startsWith('_')) {
          throw new DocuDBError(
            `Field not allowed: '${field}'`,
            MCO_ERROR.SCHEMA.INVALID_FIELD,
            { field }
          )
        }
      }
    }

    // Add additional fields if not in strict mode
    if (!this.options.strict) {
      for (const field in document) {
        if (!(field in this.definition) && !field.startsWith('_')) {
          validatedDoc[field] = document[field]
        }
      }
    }

    // Add timestamps if enabled
    if (this.options.timestamps) {
      const now = new Date()
      if (!document._createdAt) {
        validatedDoc._createdAt = now
      } else {
        validatedDoc._createdAt = document._createdAt
      }
      validatedDoc._updatedAt = now
    }

    return validatedDoc
  }

  /**
   * Validates the type of a value
   * @param {*} value - Value to validate
   * @param {string|Function} type - Expected type
   * @returns {boolean} - Indicates if the value is of the expected type
   * @private
   */
  _validateType (value: any, type: string | Function): boolean {
    if (typeof type === 'function') {
      return value instanceof type
    }

    switch (type) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && !isNaN(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'date':
        return value instanceof Date
      case 'array':
        return Array.isArray(value)
      case 'object':
        return (
          typeof value === 'object' && value !== null && !Array.isArray(value)
        )
      default:
        return true // Unknown type, assume valid
    }
  }

  /**
   * Executes custom validators
   * @param {*} value - Value to validate
   * @param {Function|Array|Object} validators - Validators to execute
   * @returns {Object} - Validation result
   * @private
   */
  _runValidators (value: any, validators: ValidationRules, field: string) {
    // Validate min/max for numbers
    if (typeof value === 'number') {
      if ((validators.min !== undefined) && value < validators.min) {
        throw new DocuDBError(
          `The value must be greater than or equal to ${validators.min}`,
          MCO_ERROR.SCHEMA.INVALID_VALUE,
          { field, value, min: validators.min }
        )
      }
      if ((validators.max !== undefined) && value > validators.max) {
        throw new DocuDBError(
          `The value must be less than or equal to ${validators.max}`,
          MCO_ERROR.SCHEMA.INVALID_VALUE,
          { field, value, max: validators.max }
        )
      }
    }

    // Validate minLength/maxLength for strings and arrays
    if (typeof value === 'string' || Array.isArray(value)) {
      if ((validators.minLength !== undefined) && value.length < validators.minLength) {
        throw new DocuDBError(
          `The length must be greater than or equal to ${validators.minLength}`,
          MCO_ERROR.SCHEMA.INVALID_LENGTH,
          {
            field,
            value,
            minLength: validators.minLength,
            currentLength: value.length
          }
        )
      }
      if ((validators.maxLength !== undefined) && value.length > validators.maxLength) {
        throw new DocuDBError(
          `The length must be less than or equal to ${validators.maxLength}`,
          MCO_ERROR.SCHEMA.INVALID_LENGTH,
          {
            field,
            value,
            maxLength: validators.maxLength,
            currentLength: value.length
          }
        )
      }
    }

    // Validate pattern for strings
    if (typeof value === 'string' && validators.pattern != null) {
      const pattern =
        validators.pattern instanceof RegExp
          ? validators.pattern
          : new RegExp(validators.pattern)

      if (!pattern.test(value)) {
        throw new DocuDBError(
          'Does not match the required pattern',
          MCO_ERROR.SCHEMA.INVALID_REGEX,
          { field, value, pattern: pattern.toString() }
        )
      }
    }

    // Validate enum
    if (validators.enum != null && !validators.enum.includes(value)) {
      throw new DocuDBError(
        `The value must be one of: ${validators.enum.join(', ')}`,
        MCO_ERROR.SCHEMA.INVALID_ENUM,
        { field, value, allowedValues: validators.enum }
      )
    }
  }
}

export default Schema
