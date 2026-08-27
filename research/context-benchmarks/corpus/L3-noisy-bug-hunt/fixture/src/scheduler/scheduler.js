'use strict'

// Scheduler: registers jobs and processes the pending queue one paginator
// page at a time. The pending snapshot is taken before any job runs, so a
// page never shifts under the executor.

const { createJob } = require('./job')
const { createJobRegistry } = require('./registry')
const { paginate } = require('./paginator')

function createScheduler({ executor }) {
  if (typeof executor !== 'function') throw new TypeError('executor must be a function')
  const registry = createJobRegistry()

  function schedule({ type, payload, priority }) {
    const job = createJob({ type, payload, priority })
    registry.add(job)
    return job.id
  }

  function pending() {
    return registry.pending()
  }

  function runPendingPage(pageSize) {
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new RangeError('pageSize must be a positive integer')
    }
    const page = paginate(registry.pending(), 1, pageSize)
    const processed = []
    for (const job of page.items) {
      const result = executor(job)
      registry.complete(job.id)
      processed.push({ id: job.id, type: job.type, result })
    }
    return {
      processed,
      remaining: registry.pendingCount(),
      page: { page: page.page, pageSize: page.pageSize, total: page.total }
    }
  }

  return { schedule, pending, runPendingPage, registry }
}

module.exports = { createScheduler }
