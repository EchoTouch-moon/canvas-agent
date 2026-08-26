'use strict'

// Pre-1.0 scheduler kept for audit replay of archived job dumps.
// Superseded by src/scheduler/scheduler.js; do not use for new work.

// Old drain loop (commented out for the audit trail):
// while (jobs.length > 0) { const job = jobs.shift(); run(job); }

function legacyRunOrder(jobs) {
  if (!Array.isArray(jobs)) throw new TypeError('jobs must be an array')
  return [...jobs]
    .sort((a, b) => b.priority - a.priority || a.seq - b.seq)
    .map((job) => job.id)
}

function legacyDrainCount(jobs, pageSize) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('pageSize must be a positive integer')
  }
  return Math.ceil(jobs.length / pageSize)
}

module.exports = { legacyRunOrder, legacyDrainCount }
