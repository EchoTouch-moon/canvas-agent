'use strict'

const { formatPrice } = require('../utils/format')

function createCart({ currency }) {
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new TypeError('currency must be a non-empty string')
  }
  const items = []
  return {
    currency,
    addItem({ sku, name, unitPrice, quantity }) {
      if (!Number.isFinite(unitPrice)) throw new TypeError('unitPrice must be a finite number')
      if (!Number.isInteger(quantity) || quantity < 1) throw new TypeError('quantity must be a positive integer')
      items.push({ sku, name, unitPrice, quantity })
      return items.length
    },
    lineTotal(item) {
      return item.unitPrice * item.quantity
    },
    total() {
      return items.reduce((sum, item) => sum + this.lineTotal(item), 0)
    },
    receipt() {
      const rows = items.map((item) => {
        const lineText = formatPrice(this.lineTotal(item), this.currency)
        return `  ${item.name} x${item.quantity} ${lineText}`
      })
      const totalText = formatPrice(this.total(), this.currency)
      return ['Cart receipt', ...rows, 'Total ' + totalText].join('\n')
    }
  }
}

module.exports = { createCart }
