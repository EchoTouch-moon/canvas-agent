const test = require('node:test')
const assert = require('node:assert/strict')
const { applyDiscount } = require('../src/discount')

test('applies a percentage discount', () => {
  assert.equal(applyDiscount(200, 20), 160)
})

test('keeps the original amount for a zero percent discount', () => {
  assert.equal(applyDiscount(35, 0), 35)
})
