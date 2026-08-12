function applyDiscount(amount, percent) {
  if (!Number.isFinite(amount) || !Number.isFinite(percent)) {
    throw new TypeError('amount and percent must be finite numbers')
  }
  return amount * (1 - percent / 100)
}

module.exports = { applyDiscount }
