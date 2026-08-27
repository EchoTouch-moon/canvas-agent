'use strict'

const { formatPrice } = require('../utils/format')
const { applyRate } = require('../utils/money')

const MARGIN_RATE = 0.25

function createPricingService({ marginRate = MARGIN_RATE } = {}) {
  if (!Number.isFinite(marginRate)) throw new TypeError('marginRate must be a finite number')
  return {
    marginRate,
    quote(amount, currency) {
      if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
      const quoted = applyRate(amount, this.marginRate)
      return formatPrice(quoted, currency)
    }
  }
}

module.exports = { createPricingService, MARGIN_RATE }
