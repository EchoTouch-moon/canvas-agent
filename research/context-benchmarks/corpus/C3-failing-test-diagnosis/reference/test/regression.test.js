const test = require('node:test')
const assert = require('node:assert/strict')
const { createCache } = require('../src/cache')

test('clear removes a previously cached value', () => {
  const cache = createCache()
  cache.getOrSet('status', () => 'ready')
  cache.clear()
  assert.equal(cache.getOrSet('status', () => 'fresh'), 'fresh')
})
