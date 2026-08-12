const assert = require('node:assert/strict')
const test = require('node:test')
const { isExpired } = require('../src/auth/session')

test('auth sessions remain expired after their deadline', () => {
  assert.equal(isExpired({ expiresAt: 100 }, 101), true)
})
