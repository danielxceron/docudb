/**
 * Creates a deep copy preserving Date objects
 * @param {Object} obj - Object to copy
 * @returns {Object} - Deep copy with preserved Date objects
 * @private
 */
const deepCopy = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item))
  }

  const copy = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      copy[key] = deepCopy(obj[key])
    }
  }
  return copy
}

module.exports = deepCopy
