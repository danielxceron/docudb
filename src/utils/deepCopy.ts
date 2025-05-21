/**
 * Deep copy utility
 * Creates a deep copy of an object or array
 */

/**
 * Creates a deep copy of an object or array
 * @param obj - Object to copy
 * @returns Deep copy of the object
 */
export default function deepCopy<T> (obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj) as unknown as T
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item)) as unknown as T
  }

  const copy = {} as T
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      (copy as any)[key] = deepCopy((obj as any)[key])
    }
  }
  return copy
}
