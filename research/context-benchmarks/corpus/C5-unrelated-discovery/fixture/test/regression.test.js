const assert = require('node:assert/strict')
const test = require('node:test')
const { isExpired } = require('../src/session-expiry')

test('an existing candidate remains expired after its deadline', () => {
  assert.equal(isExpired({ kind: 'alpha', expiresAt: 100 }, 101), true)
})
