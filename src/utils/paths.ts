/**
 * Path helpers shared by the query engine, the index manager and the
 * collection. Dot notation is used everywhere (`address.city`, `items.0.name`).
 */

/**
 * Reads a nested value using dot notation
 * @param obj - Source object
 * @param path - Path such as `address.city` or `items.0`
 * @returns The value, or undefined when any segment is missing
 */
export function getNestedValue (obj: unknown, path: string): any {
  if (obj === undefined || obj === null || path === undefined) return undefined
  if (path.length === 0) return obj

  let current: any = obj
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
      continue
    }
    if (typeof current !== 'object' && typeof current !== 'function') return undefined
    current = current[part]
  }
  return current
}

/**
 * Returns the parent container of a nested path, creating it when missing
 * @param obj - Target object (mutated)
 * @param path - Dot separated path
 * @returns `{ parent, key }` or null when the path cannot be resolved
 */
function resolveParent (
  obj: Record<string, any>,
  path: string
): { parent: Record<string, any>, key: string } | null {
  const parts = path.split('.')
  const key = parts.pop() as string
  let current: any = obj

  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
    } else {
      if (current[part] === null || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part]
    }
    if (current === null || typeof current !== 'object') return null
  }

  return { parent: current as Record<string, any>, key }
}

/**
 * Sets a nested value creating intermediate objects when needed
 * @param obj - Target object (mutated)
 * @param path - Dot separated path
 * @param value - Value to assign
 * @returns true when the value could be assigned
 */
export function setNestedValue (
  obj: Record<string, any>,
  path: string,
  value: unknown
): boolean {
  const resolved = resolveParent(obj, path)
  if (resolved === null) return false
  resolved.parent[resolved.key] = value
  return true
}

/**
 * Removes a nested value
 * @param obj - Target object (mutated)
 * @param path - Dot separated path
 * @returns true when something was removed
 */
export function unsetNestedValue (obj: Record<string, any>, path: string): boolean {
  const resolved = resolveParent(obj, path)
  if (resolved === null) return false
  if (!Object.prototype.hasOwnProperty.call(resolved.parent, resolved.key)) {
    return false
  }
  delete resolved.parent[resolved.key]
  return true
}

/**
 * Tells whether a document contains the given path
 * @param doc - Document to inspect
 * @param path - Dot separated path
 * @returns true when the path exists
 */
export function hasNestedValue (doc: unknown, path: string): boolean {
  if (doc === null || doc === undefined) return false
  if (path.length === 0) return true

  let current: any = doc
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return false
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return false
      if (Number(part) >= current.length) return false
      current = current[Number(part)]
      continue
    }
    if (typeof current !== 'object') return false
    if (!Object.prototype.hasOwnProperty.call(current, part)) return false
    current = current[part]
  }
  return true
}

/**
 * Total ordering used by `sort()`: undefined < null < boolean < number <
 * string < Date < array < object. Missing fields always sort first.
 * @param a - First value
 * @param b - Second value
 * @returns Negative, zero or positive
 */
export function compareValues (a: unknown, b: unknown): number {
  if (a === b) return 0

  const rank = (value: unknown): number => {
    if (value === undefined) return 0
    if (value === null) return 1
    if (typeof value === 'boolean') return 2
    if (typeof value === 'number') return 3
    if (typeof value === 'bigint') return 3
    if (typeof value === 'string') return 4
    if (value instanceof Date) return 5
    if (Array.isArray(value)) return 6
    return 7
  }

  const rankA = rank(a)
  const rankB = rank(b)
  if (rankA !== rankB) return rankA - rankB

  switch (rankA) {
    case 0:
    case 1:
      return 0
    case 2:
      return (a === b ? 0 : (a === true ? 1 : -1))
    case 3: {
      const numA = Number(a)
      const numB = Number(b)
      return numA === numB ? 0 : (numA < numB ? -1 : 1)
    }
    case 4: {
      const strA = String(a)
      const strB = String(b)
      return strA === strB ? 0 : (strA < strB ? -1 : 1)
    }
    case 5: {
      const timeA = (a as Date).getTime()
      const timeB = (b as Date).getTime()
      return timeA === timeB ? 0 : (timeA < timeB ? -1 : 1)
    }
    default: {
      const strA = JSON.stringify(a) ?? ''
      const strB = JSON.stringify(b) ?? ''
      return strA === strB ? 0 : (strA < strB ? -1 : 1)
    }
  }
}

export default {
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  hasNestedValue,
  compareValues
}
