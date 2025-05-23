/**
 * Deep copy utility
 * Creates a deep copy of an object or array
 */

/**
 * Creates a deep copy of an object or array
 * @param obj - Object to copy
 * @returns Deep copy of the object
 */
export default function deepCopy (obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item))
  }

  const copy = {} as any
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      copy[key] = deepCopy(obj[key])
    }
  }
  return copy
}
