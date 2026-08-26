'use strict'

// TTL read-through cache shared by every repository. Time comes from the
// injected clock so behavior stays deterministic; entries live while
// now() - storedAt < ttlMs and are dropped afterwards.

function createTtlCache({ ttlMs, clock }) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive number')
  if (clock === null || typeof clock !== 'object' || typeof clock.now !== 'function') {
    throw new TypeError('clock with a now() function is required')
  }
  const entries = new Map()

  function get(key, loader) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('key must be a non-empty string')
    if (typeof loader !== 'function') throw new TypeError('loader must be a function')
    const now = clock.now()
    const entry = entries.get(key)
    if (entry !== undefined && now - entry.storedAt < ttlMs) {
      return entry.value
    }
    const value = loader()
    entries.set(key, { value, storedAt: now })
    return value
  }

  function invalidate(key) {
    return entries.delete(key)
  }

  function invalidatePrefix(prefix) {
    if (typeof prefix !== 'string' || prefix.length === 0) throw new TypeError('prefix must be a non-empty string')
    let removed = 0
    for (const key of [...entries.keys()]) {
      if (key.startsWith(prefix)) {
        entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  function clear() {
    entries.clear()
  }

  function size() {
    return entries.size
  }

  return { get, invalidate, invalidatePrefix, clear, size }
}

module.exports = { createTtlCache }
