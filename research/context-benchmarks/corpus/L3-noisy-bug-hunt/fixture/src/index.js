'use strict'

// Public entry point: wires a scheduler with a recording executor.

const { createScheduler } = require('./scheduler/scheduler')

function createTrackedScheduler({ onProcess } = {}) {
  const processed = []
  const executor = (job) => {
    const result = typeof onProcess === 'function' ? onProcess(job) : job.type
    processed.push(job.id)
    return result
  }
  const scheduler = createScheduler({ executor })
  return {
    ...scheduler,
    processed: () => [...processed]
  }
}

module.exports = { createTrackedScheduler, createScheduler }
