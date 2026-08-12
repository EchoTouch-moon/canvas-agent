const test = require('node:test')
const assert = require('node:assert/strict')
const { createCache } = require('../src/cache')

test('returns the cached value without rerunning the factory', () => {
  const cache = createCache()
  let calls = 0
  const factory = () => {
    calls += 1
    return { value: 'ready' }
  }

  assert.deepEqual(cache.getOrSet('status', factory), { value: 'ready' })
  assert.deepEqual(cache.getOrSet('status', factory), { value: 'ready' })
  assert.equal(calls, 1)
})
