'use strict'

const { formatPrice } = require('../utils/format')

function createProduct({ sku, name, price, currency, quantity }) {
  if (typeof sku !== 'string' || sku.length === 0) throw new TypeError('sku must be a non-empty string')
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('name must be a non-empty string')
  if (!Number.isFinite(price)) throw new TypeError('price must be a finite number')
  if (!Number.isInteger(quantity) || quantity < 0) throw new TypeError('quantity must be a non-negative integer')
  return {
    sku,
    name,
    price,
    currency,
    quantity,
    describe(locale) {
      const priceText = formatPrice(this.price, this.currency, { locale })
      return `${this.sku} ${this.name} x${this.quantity} ${priceText}`
    }
  }
}

module.exports = { createProduct }
