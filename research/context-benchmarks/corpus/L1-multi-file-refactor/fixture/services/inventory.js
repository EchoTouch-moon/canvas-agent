'use strict'

const { formatPrice } = require('../utils/format')

// CSV export for stock takes lives in reports/legacy-csv-export.js.

function createInventory({ currency }) {
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new TypeError('currency must be a non-empty string')
  }
  const items = []
  return {
    currency,
    restock(name, unitPrice, quantity) {
      if (typeof name !== 'string' || name.length === 0) throw new TypeError('name must be a non-empty string')
      if (!Number.isFinite(unitPrice)) throw new TypeError('unitPrice must be a finite number')
      if (!Number.isInteger(quantity) || quantity < 0) throw new TypeError('quantity must be a non-negative integer')
      items.push({ name, unitPrice, quantity })
      return items.length
    },
    listItems() {
      return items.map((item) => ({ name: item.name, unitPrice: item.unitPrice, quantity: item.quantity }))
    },
    totalValue() {
      return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    },
    valuation() {
      const valueText = formatPrice(this.totalValue(), this.currency)
      return `Inventory value ${valueText}`
    }
  }
}

module.exports = { createInventory }
