'use strict'

// Numeric helpers shared by the services. These are NOT part of the
// formatPrice migration; keep their behavior exactly as-is.

function toMinorUnits(amount) {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
  return Math.round(amount * 100)
}

function fromMinorUnits(minor) {
  if (!Number.isInteger(minor)) throw new TypeError('minor must be an integer')
  return minor / 100
}

function parseAmount(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('text must be a non-empty string')
  }
  const value = Number(text)
  if (!Number.isFinite(value)) throw new TypeError(`not a number: ${text}`)
  return value
}

function applyRate(amount, rate) {
  if (!Number.isFinite(amount)) throw new TypeError('amount must be a finite number')
  if (!Number.isFinite(rate)) throw new TypeError('rate must be a finite number')
  return amount * (1 + rate)
}

module.exports = { toMinorUnits, fromMinorUnits, parseAmount, applyRate }
