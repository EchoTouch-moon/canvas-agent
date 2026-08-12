const test = require('node:test')
const assert = require('node:assert/strict')
const { greetProfile } = require('../src')

test('preserves the default greeting', () => {
  assert.equal(greetProfile({ name: 'Ada' }), 'Hello, Ada')
})

test('supports the formal profile greeting', () => {
  assert.equal(greetProfile({ name: 'Ada', formal: true }), 'Hello, Ada!')
})
