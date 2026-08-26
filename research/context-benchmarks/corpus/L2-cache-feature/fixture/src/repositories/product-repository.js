'use strict'

// Product repository. Every read goes straight to the store today.

function createProductRepository({ store }) {
  if (store === null || typeof store !== 'object') throw new TypeError('store is required')
  const table = 'products'

  function findById(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    return store.get(table, id)
  }

  function list() {
    return [...store.list(table)]
  }

  function create(record) {
    if (record === null || typeof record !== 'object') throw new TypeError('record must be an object')
    return store.put(table, record)
  }

  function update(id, patch) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    return store.update(table, id, patch)
  }

  function remove(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
    return store.delete(table, id)
  }

  return { findById, list, create, update, remove }
}

module.exports = { createProductRepository }
