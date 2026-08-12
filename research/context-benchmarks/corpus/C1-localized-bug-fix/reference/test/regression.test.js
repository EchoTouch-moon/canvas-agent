const test = require('node:test')
const assert = require('node:assert/strict')
const { applyDiscount } = require('../src/discount')

test('rejects non-finite discount inputs', () => {
  assert.throws(() => applyDiscount(Number.NaN, 10), TypeError)
  assert.throws(() => applyDiscount(10, Number.POSITIVE_INFINITY), TypeError)
})
