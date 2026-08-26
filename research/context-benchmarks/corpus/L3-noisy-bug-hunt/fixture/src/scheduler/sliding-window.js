'use strict'

// Sliding-window rate limiter. A hit expires once now - hitTime >= windowMs,
// so the window covers [now - windowMs, now].

function createSlidingWindowLimiter({ limit, windowMs }, clock) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer')
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be positive')
  if (clock === null || typeof clock !== 'object' || typeof clock.now !== 'function') {
    throw new TypeError('clock with a now() function is required')
  }
  const hits = []

  function evictExpired(now) {
    while (hits.length > 0 && now - hits[0] >= windowMs) hits.shift()
  }

  function allow() {
    const now = clock.now()
    evictExpired(now)
    if (hits.length >= limit) return false
    hits.push(now)
    return true
  }

  return {
    allow,
    utilization: () => hits.length
  }
}

module.exports = { createSlidingWindowLimiter }
