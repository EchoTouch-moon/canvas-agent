'use strict'

// Audit trail writer used by the compliance team. Reads amounts from the
// ledger export, never writes to the storefront.

const { parseAmount, toMinorUnits } = require('../utils/money')

function createAuditTrailWriter({ currency }) {
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new TypeError('currency must be a non-empty string')
  }
  const entries = []
  return {
    currency,
    entry(actor, action, amountText) {
      const amount = parseAmount(amountText)
      entries.push({
        actor,
        action,
        currency: this.currency,
        minor: toMinorUnits(amount)
      })
      return entries.length
    },
    lines() {
      return entries.map((e) => `${e.actor}|${e.action}|${e.currency}|${e.minor}`)
    }
  }
}

module.exports = { createAuditTrailWriter }
