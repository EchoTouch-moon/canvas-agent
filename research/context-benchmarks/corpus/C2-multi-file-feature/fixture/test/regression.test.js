const test = require('node:test')
const assert = require('node:assert/strict')
const { greetProfile } = require('../src')

test('keeps the public default greeting stable for another name', () => {
  assert.equal(greetProfile({ name: 'Grace' }), 'Hello, Grace')
})
