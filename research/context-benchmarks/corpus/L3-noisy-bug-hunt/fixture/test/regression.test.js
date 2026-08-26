'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { computeBackoff } = require('../src/scheduler/backoff')
const { createPriorityQueue } = require('../src/scheduler/priority-queue')
const { createSlidingWindowLimiter } = require('../src/scheduler/sliding-window')
const { nextDailyRun } = require('../src/utils/recurrence')
const { hashKey, bucketFor } = require('../src/utils/hash-bucket')
const { createDeadLetterQueue } = require('../src/queue/dead-letter')
const { legacyRunOrder, legacyDrainCount } = require('../src/legacy/old-scheduler')
const { executeWithRetries } = require('../src/scheduler/runner')
const { createJobRegistry } = require('../src/scheduler/registry')
const { createFakeClock } = require('../src/clock')

test('retry backoff stays exponential and capped', () => {
  const profile = { baseMs: 100, multiplier: 2, capMs: 60000 }
  assert.equal(computeBackoff(profile, 0), 100)
  assert.equal(computeBackoff(profile, 1), 200)
  assert.equal(computeBackoff(profile, 5), 3200)
  assert.equal(computeBackoff(profile, 10), 60000)
  assert.throws(() => computeBackoff(profile, -1), RangeError)
})

test('priority queue drains by priority then insertion order', () => {
  const queue = createPriorityQueue()
  queue.push({ id: 'a', priority: 1 })
  queue.push({ id: 'b', priority: 5 })
  queue.push({ id: 'c', priority: 5 })
  queue.push({ id: 'd', priority: 2 })
  assert.equal(queue.size(), 4)
  assert.deepEqual(
    [queue.pop(), queue.pop(), queue.pop(), queue.pop()].map((item) => item.id),
    ['b', 'c', 'd', 'a']
  )
  assert.equal(queue.pop(), undefined)
})

test('sliding window limiter keeps its current behavior', () => {
  const clock = createFakeClock(1000)
  const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 100 }, clock)
  assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), false)
  assert.equal(limiter.utilization(), 2)
  clock.advance(150)
  assert.equal(limiter.allow(), true)
})

test('daily recurrence picks the next strict occurrence', () => {
  assert.equal(nextDailyRun(9, 1000000000000), 1000026000000)
  assert.equal(nextDailyRun(1, 1000000000000), 1000083600000)
  assert.throws(() => nextDailyRun(24, 0), RangeError)
})

test('hash bucketing stays stable', () => {
  assert.equal(hashKey('user:1') > 0, true)
  assert.equal(bucketFor('user:1', 8), 3)
  assert.equal(bucketFor('user:1', 16), bucketFor('user:1', 16))
  assert.equal(bucketFor('user:1', 4) < 4, true)
  assert.throws(() => hashKey(''), TypeError)
})

test('dead letter queue flips to dead at maxAttempts', () => {
  const queue = createDeadLetterQueue({ maxAttempts: 3 })
  assert.deepEqual(queue.record('j1'), { id: 'j1', attempts: 1, status: 'retrying' })
  assert.deepEqual(queue.record('j1'), { id: 'j1', attempts: 2, status: 'retrying' })
  assert.deepEqual(queue.record('j1'), { id: 'j1', attempts: 3, status: 'dead' })
  assert.equal(queue.size(), 1)
  assert.deepEqual(queue.get('j1'), { id: 'j1', attempts: 3, status: 'dead' })
})

test('legacy scheduler ordering stays pinned for audit replay', () => {
  const jobs = [
    { id: 'a', priority: 1, seq: 0 },
    { id: 'b', priority: 5, seq: 1 },
    { id: 'c', priority: 5, seq: 2 }
  ]
  assert.deepEqual(legacyRunOrder(jobs), ['b', 'c', 'a'])
  assert.equal(legacyDrainCount([1, 2, 3, 4, 5, 6, 7], 2), 4)
})

test('runner retries deterministic failures', () => {
  const job = { id: 'j1', type: 'index', priority: 1, payload: {} }
  assert.deepEqual(executeWithRetries(job, () => 'ok'), { ok: true, attempts: 1, result: 'ok' })
  assert.deepEqual(executeWithRetries(job, () => {
    throw new Error('boom')
  }, { maxAttempts: 3 }), { ok: false, attempts: 3, error: 'boom' })
})

test('registry keeps pending order and completion state', () => {
  const registry = createJobRegistry()
  registry.add({ id: 'a', seq: 0, type: 'index', priority: 1, status: 'pending' })
  registry.add({ id: 'b', seq: 1, type: 'audit', priority: 4, status: 'pending' })
  assert.deepEqual(
    registry.pending().map((job) => job.id),
    ['b', 'a']
  )
  assert.equal(registry.complete('a'), true)
  assert.equal(registry.pendingCount(), 1)
  assert.equal(registry.get('a').status, 'done')
})

test('fake clock only advances on demand', () => {
  const clock = createFakeClock(1000)
  assert.equal(clock.now(), 1000)
  assert.equal(clock.advance(50), 1050)
  assert.equal(clock.now(), 1050)
  assert.throws(() => clock.advance(-1), RangeError)
})
