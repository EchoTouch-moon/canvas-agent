'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { paginate } = require('../src/scheduler/paginator')
const { createScheduler } = require('../src/scheduler/scheduler')
const { resetSeq } = require('../src/scheduler/job')

test('paginate returns full windows for every page', () => {
  const items = [1, 2, 3, 4, 5, 6, 7]
  assert.deepEqual(paginate(items, 1, 2).items, [1, 2])
  assert.deepEqual(paginate(items, 2, 2).items, [3, 4])
  assert.deepEqual(paginate(items, 3, 2).items, [5, 6])
  assert.deepEqual(paginate(items, 4, 2).items, [7])
})

test('paginate reports totals and hasNextPage', () => {
  const page1 = paginate([1, 2, 3, 4, 5], 1, 2)
  assert.equal(page1.total, 5)
  assert.equal(page1.pageCount, 3)
  assert.equal(page1.hasNextPage, true)
  const page3 = paginate([1, 2, 3, 4, 5], 3, 2)
  assert.deepEqual(page3.items, [5])
  assert.equal(page3.hasNextPage, false)
  const empty = paginate([], 1, 3)
  assert.deepEqual(empty.items, [])
  assert.equal(empty.pageCount, 0)
  assert.equal(empty.hasNextPage, false)
})

test('paginate validates its inputs', () => {
  assert.throws(() => paginate('nope', 1, 2), TypeError)
  assert.throws(() => paginate([], 0, 2), RangeError)
  assert.throws(() => paginate([], 1, 0), RangeError)
})

test('runPendingPage processes exactly one full page, highest priority first', () => {
  resetSeq()
  const executed = []
  const scheduler = createScheduler({ executor: (job) => executed.push(job.id) })
  scheduler.schedule({ type: 'cleanup', priority: 1 })
  scheduler.schedule({ type: 'index', priority: 5 })
  scheduler.schedule({ type: 'mirror', priority: 5 })
  scheduler.schedule({ type: 'report', priority: 2 })

  const batch = scheduler.runPendingPage(2)
  assert.deepEqual(
    batch.processed.map((entry) => entry.id),
    ['job-1', 'job-2']
  )
  assert.deepEqual(executed, ['job-1', 'job-2'])
  assert.equal(batch.remaining, 2)
  assert.deepEqual(batch.page, { page: 1, pageSize: 2, total: 4 })
})

test('runPendingPage keeps draining from where the last page stopped', () => {
  resetSeq()
  const scheduler = createScheduler({ executor: (job) => job.type })
  scheduler.schedule({ type: 'cleanup', priority: 1 })
  scheduler.schedule({ type: 'index', priority: 5 })
  scheduler.schedule({ type: 'mirror', priority: 5 })
  scheduler.schedule({ type: 'report', priority: 2 })

  const first = scheduler.runPendingPage(2)
  const second = scheduler.runPendingPage(2)
  assert.deepEqual(
    first.processed.map((entry) => entry.id),
    ['job-1', 'job-2']
  )
  assert.deepEqual(
    second.processed.map((entry) => entry.id),
    ['job-3', 'job-0']
  )
  assert.equal(second.remaining, 0)
})

test('draining the queue processes every job exactly once in full pages', () => {
  resetSeq()
  const executed = []
  const scheduler = createScheduler({ executor: (job) => executed.push(job.id) })
  scheduler.schedule({ type: 'cleanup', priority: 1 })
  scheduler.schedule({ type: 'index', priority: 5 })
  scheduler.schedule({ type: 'mirror', priority: 5 })
  scheduler.schedule({ type: 'report', priority: 2 })
  scheduler.schedule({ type: 'audit', priority: 3 })

  let batches = 0
  let batch = { remaining: 1 }
  while (batch.remaining > 0 && batches < 50) {
    batch = scheduler.runPendingPage(2)
    batches += 1
  }
  assert.equal(batch.remaining, 0)
  assert.equal(batches, 3)
  assert.deepEqual(executed, ['job-1', 'job-2', 'job-4', 'job-3', 'job-0'])
})
