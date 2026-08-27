'use strict'

// Exponential retry backoff. attempt is 0-based: the delay before the FIRST
// retry is baseMs * multiplier^1, so computeBackoff(profile, 0) is the delay
// before the first attempt (always baseMs).

function computeBackoff({ baseMs = 100, multiplier = 2, capMs = 60000 } = {}, attempt) {
  if (!Number.isFinite(baseMs) || baseMs < 1) throw new RangeError('baseMs must be >= 1')
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new RangeError('multiplier must be >= 1')
  if (!Number.isFinite(capMs) || capMs < baseMs) throw new RangeError('capMs must be >= baseMs')
  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('attempt is 0-based')
  let delay = baseMs
  for (let i = 0; i < attempt; i += 1) {
    delay = Math.min(capMs, delay * multiplier)
  }
  return delay
}

module.exports = { computeBackoff }
