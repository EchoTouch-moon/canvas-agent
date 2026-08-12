const assert = require('node:assert/strict')
const test = require('node:test')
const { formatUser } = require('../src/domain/user')

test('normalization collapses internal whitespace', () => {
  assert.equal(formatUser({ firstName: 'Ada  ', lastName: '  Lovelace' }), 'Ada Lovelace')
})
