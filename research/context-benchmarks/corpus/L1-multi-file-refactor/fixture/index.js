'use strict'

// Composition root for the inventory/order storefront.

const { createInventory } = require('./services/inventory')
const { createCart } = require('./services/cart')
const { createPricingService } = require('./services/pricing')
const { createBillingService } = require('./services/billing')
const { formatPrice } = require('./utils/format')

function createStorefront({ currency }) {
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new TypeError('currency must be a non-empty string')
  }
  return {
    currency,
    inventory: createInventory({ currency }),
    cart: createCart({ currency }),
    pricing: createPricingService(),
    billing: createBillingService()
  }
}

function renderQuote(amount, currency) {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
  const priceText = formatPrice(amount, currency)
  return `Quote: ${priceText}`
}

module.exports = { createStorefront, renderQuote }
