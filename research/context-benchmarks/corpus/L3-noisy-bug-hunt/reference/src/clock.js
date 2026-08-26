'use strict'

// Injectable clocks. Production code uses the system clock; tests inject
// the fake clock so time advances only when the test says so.

function createSystemClock() {
  return { now: () => Date.now() }
}

function createFakeClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('ms must be a non-negative number')
      current += ms
      return current
    }
  }
}

module.exports = { createSystemClock, createFakeClock }
