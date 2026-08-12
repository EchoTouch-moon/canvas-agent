function applyDiscount(amount, percent) {
  if (!Number.isFinite(amount) || !Number.isFinite(percent)) {
    throw new TypeError('amount and percent must be finite numbers')
  }
  return amount - percent
}

module.exports = { applyDiscount }
