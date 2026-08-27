'use strict'

// Executes a job through an injected executor, retrying deterministic
// failures up to maxAttempts. Returns the outcome without sleeping.

function executeWithRetries(job, executor, { maxAttempts = 3 } = {}) {
  if (job === null || typeof job !== 'object') throw new TypeError('job must be an object')
  if (typeof executor !== 'function') throw new TypeError('executor must be a function')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer')
  }
  let attempts = 0
  let lastError = null
  while (attempts < maxAttempts) {
    attempts += 1
    try {
      const result = executor(job)
      return { ok: true, attempts, result }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return { ok: false, attempts, error: lastError }
}

module.exports = { executeWithRetries }
