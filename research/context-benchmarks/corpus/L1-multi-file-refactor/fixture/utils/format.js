'use strict'

// Shared formatting helpers for the inventory/order system.
// NOTE: test/ is written against the NEW options-based contract for
// formatPrice(amount, currency, options). This module still implements the
// legacy two-argument signature; callers across models/ and services/ must be
// migrated together with it.

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥'
}

function groupDigits(intPart, separator) {
  let result = ''
  let count = 0
  for (let i = intPart.length - 1; i >= 0; i -= 1) {
    result = intPart[i] + result
    count += 1
    if (count % 3 === 0 && i > 0) result = separator + result
  }
  return result
}

function formatPrice(amount, currency) {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new TypeError('currency must be a non-empty string')
  }
  const symbol = CURRENCY_SYMBOLS[currency]
  if (!symbol) throw new TypeError(`unsupported currency: ${currency}`)
  const fixed = Math.abs(amount).toFixed(2)
  const [intPart, decimals] = fixed.split('.')
  const sign = amount < 0 ? '-' : ''
  return `${currency} ${sign}${groupDigits(intPart, ',')}.${decimals}`
}

function formatPercent(value) {
  if (!Number.isFinite(value)) throw new TypeError('value must be a finite number')
  return `${(value * 100).toFixed(1)}%`
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) throw new TypeError('ms must be a non-negative finite number')
  if (ms < 1000) return `${Math.floor(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
}

module.exports = { formatPrice, formatPercent, formatDuration }
