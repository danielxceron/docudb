/**
 * Main utility module
 * Exports all utility functions available in the project
 */

const fileUtils = require('./fileUtils')
const deepCopy = require('./deepCopy')

module.exports = {
  ...fileUtils,
  deepCopy
}
