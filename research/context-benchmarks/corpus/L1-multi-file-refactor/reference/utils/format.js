'use strict'

// Shared formatting helpers for the inventory/order system.
// formatPrice uses the options-based contract: formatPrice(amount, currency,
// options) where options is a REQUIRED object carrying the locale and optional
// formatting flags. Every call site passes it explicitly.

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥'
}

const CURRENCY_DECIMALS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0
}

const LOCALES = {
  'en-US': { decimal: '.', group: ',', symbolFirst: true, symbolGap: '' },
  'de-DE': { decimal: ',', group: '.', symbolFirst: false, symbolGap: ' ' },
  'fr-FR': { decimal: ',', group: ' ', symbolFirst: false, symbolGap: ' ' }
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

function formatPrice(amount, currency, options) {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new TypeError('currency must be a non-empty string')
  }
  const symbol = CURRENCY_SYMBOLS[currency]
  if (!symbol) throw new TypeError(`unsupported currency: ${currency}`)
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('formatPrice requires an options object')
  }
  const localeName = options.locale
  if (typeof localeName !== 'string' || localeName.length === 0) {
    throw new TypeError('formatPrice requires options.locale')
  }
  const locale = LOCALES[localeName]
  if (!locale) throw new TypeError(`unsupported locale: ${localeName}`)

  const omitDecimals = options.omitDecimals === true
  const minorDigits = omitDecimals ? 0 : CURRENCY_DECIMALS[currency]
  const abs = Math.abs(amount)
  const rounded = minorDigits === 0 ? Math.round(abs) : Number(abs.toFixed(minorDigits))
  const [intPart, decimals] = rounded.toFixed(minorDigits).split('.')
  const sign = amount < 0 ? '-' : ''
  const digits = groupDigits(intPart, locale.group) + (decimals ? locale.decimal + decimals : '')
  return locale.symbolFirst
    ? `${sign}${symbol}${locale.symbolGap}${digits}`
    : `${sign}${digits}${locale.symbolGap}${symbol}`
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
