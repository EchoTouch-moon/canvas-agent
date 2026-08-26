'use strict'

// Dead-letter bookkeeping for jobs that keep failing. record() bumps the
// attempt count and flips the status to 'dead' once maxAttempts is reached.

function createDeadLetterQueue({ maxAttempts = 3 } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer')
  }
  const entries = new Map()

  function record(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    const previous = entries.get(id)
    const attempts = (previous?.attempts ?? 0) + 1
    const entry = { id, attempts, status: attempts >= maxAttempts ? 'dead' : 'retrying' }
    entries.set(id, entry)
    return { ...entry }
  }

  function get(id) {
    const entry = entries.get(id)
    return entry === undefined ? undefined : { ...entry }
  }

  function size() {
    return entries.size
  }

  return { record, get, size }
}

module.exports = { createDeadLetterQueue }
