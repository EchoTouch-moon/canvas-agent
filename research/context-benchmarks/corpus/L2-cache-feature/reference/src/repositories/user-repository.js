'use strict'

// User repository. Reads flow through the shared TTL cache in src/cache.js;
// writes invalidate this table's cached entries.

const { createTtlCache } = require('../cache')

const DEFAULT_TTL_MS = 30000

function createUserRepository({ store, ttlMs = DEFAULT_TTL_MS, clock = { now: () => Date.now() } }) {
  if (store === null || typeof store !== 'object') throw new TypeError('store is required')
  const table = 'users'
  const cache = createTtlCache({ ttlMs, clock })

  function findById(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    return cache.get(`${table}:id:${id}`, () => store.get(table, id))
  }

  function list() {
    return [...cache.get(`${table}:list`, () => store.list(table))]
  }

  function create(record) {
    if (record === null || typeof record !== 'object') throw new TypeError('record must be an object')
    const saved = store.put(table, record)
    cache.invalidatePrefix(`${table}:`)
    return saved
  }

  function update(id, patch) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    const saved = store.update(table, id, patch)
    cache.invalidatePrefix(`${table}:`)
    return saved
  }

  function remove(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    const removed = store.delete(table, id)
    cache.invalidatePrefix(`${table}:`)
    return removed
  }

  return { findById, list, create, update, remove }
}

module.exports = { createUserRepository }
