/**
 * Main utility module
 * Exports all utility functions available in the project
 */

import fileUtils from './fileUtils.js'
import deepCopy from './deepCopy.js'

export default { ...fileUtils, deepCopy }
