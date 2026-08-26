'use strict'

// GraphQL-shaped adapter explored during the API redesign. Not wired anywhere;
// the flatten function is only used by its own doc examples.

function flattenSelection(selection, prefix = '') {
  if (typeof selection !== 'string' || selection.trim().length === 0) {
    throw new TypeError('selection must be a non-empty string')
  }
  return selection
    .split(/\s+/)
    .filter(Boolean)
    .map((field) => (prefix.length === 0 ? field : `${prefix}.${field}`))
}

function toGraphqlQuery(entity, selection) {
  if (typeof entity !== 'string' || entity.length === 0) {
    throw new TypeError('entity must be a non-empty string')
  }
  return `{ ${entity} { ${flattenSelection(selection).join(' ')} } }`
}

module.exports = { flattenSelection, toGraphqlQuery }
