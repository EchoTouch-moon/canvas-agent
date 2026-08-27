'use strict'

// Job registry: insertion order is preserved; pending() returns a snapshot
// sorted by descending priority, then ascending scheduling order.

function createJobRegistry() {
  const jobs = new Map()

  function add(job) {
    if (job === null || typeof job !== 'object' || typeof job.id !== 'string') {
      throw new TypeError('job with a string id is required')
    }
    jobs.set(job.id, { ...job })
    return job.id
  }

  function get(id) {
    const job = jobs.get(id)
    return job === undefined ? undefined : { ...job }
  }

  function complete(id) {
    const job = jobs.get(id)
    if (job === undefined) return false
    job.status = 'done'
    return true
  }

  function pending() {
    return [...jobs.values()]
      .filter((job) => job.status === 'pending')
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq)
      .map((job) => ({ ...job }))
  }

  function pendingCount() {
    return [...jobs.values()].filter((job) => job.status === 'pending').length
  }

  function size() {
    return jobs.size
  }

  return { add, get, complete, pending, pendingCount, size }
}

module.exports = { createJobRegistry }
