const assert = require('node:assert/strict')
const test = require('node:test')
const { calculate } = require('../src/runtime/public-api')

test('operator precedence remains stable for a flat expression', () => {
  assert.equal(calculate('2 + 3 * 4'), 14)
})
