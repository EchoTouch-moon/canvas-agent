'use strict'

// Deprecated category-based tax table. Superseded by the margin/tax logic in
// services/pricing.js and services/billing.js; do not add new callers.

const TAX_TABLE = Object.freeze({
  books: 0,
  food: 0.05,
  electronics: 0.2,
  default: 0.1
})

function taxRateFor(category) {
  if (typeof category !== 'string' || category.length === 0) {
    throw new TypeError('category must be a non-empty string')
  }
  return TAX_TABLE[category] ?? TAX_TABLE.default
}

function taxFor(amount, category) {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
  return amount * taxRateFor(category)
}

module.exports = { taxRateFor, taxFor, TAX_TABLE }
