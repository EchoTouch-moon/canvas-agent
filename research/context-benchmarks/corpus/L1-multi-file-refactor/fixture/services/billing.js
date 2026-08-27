'use strict'

const { formatPrice } = require('../utils/format')
const { toMinorUnits } = require('../utils/money')

const TAX_RATE = 0.08

function createBillingService({ taxRate = TAX_RATE } = {}) {
  if (!Number.isFinite(taxRate)) throw new TypeError('taxRate must be a finite number')
  return {
    taxRate,
    invoiceLine({ description, amount, currency }) {
      if (typeof description !== 'string' || description.length === 0) {
        throw new TypeError('description must be a non-empty string')
      }
      if (!Number.isInteger(toMinorUnits(amount))) {
        throw new TypeError('amount must resolve to whole minor units')
      }
      const withTax = amount * (1 + this.taxRate)
      const lineText = formatPrice(withTax, currency)
      return `INVOICE ${description} ${lineText}`
    }
  }
}

module.exports = { createBillingService, TAX_RATE }
