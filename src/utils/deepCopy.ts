/**
 * Deep copy utility.
 * Creates a deep copy of a JSON compatible value, preserving `Date`,
 * `RegExp`, `Map`, `Set`, `BigInt` and typed arrays.
 */

/**
 * Creates a deep copy of a value
 * @param obj - Value to copy
 * @returns Deep copy of the value
 */
export default function deepCopy<T> (obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as unknown as T
  }

  if (typeof obj === 'bigint') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item)) as unknown as T
  }

  if (obj instanceof Map) {
    const copy = new Map()
    for (const [key, value] of obj.entries()) {
      copy.set(deepCopy(key), deepCopy(value))
    }
    return copy as unknown as T
  }

  if (obj instanceof Set) {
    const copy = new Set()
    for (const value of obj.values()) {
      copy.add(deepCopy(value))
    }
    return copy as unknown as T
  }

  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    // Structured clone handles Buffers, TypedArrays and ArrayBuffers.
    return structuredClone(obj)
  }

  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    copy[key] = deepCopy((obj as Record<string, unknown>)[key])
  }
  return copy as T
}
