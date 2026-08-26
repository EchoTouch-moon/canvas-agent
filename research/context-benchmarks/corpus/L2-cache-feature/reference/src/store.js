'use strict'

// In-memory record store with read instrumentation: `readCount` counts every
// get() and list() call, so tests can observe how often reads actually reach
// the store. Writes (put/update/delete) are not counted as reads.

const PREFIXES = { users: 'u', products: 'p', orders: 'o' }

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createMemoryStore(seed = {}) {
  const tables = new Map()
  const counters = new Map()
  let readCount = 0

  for (const [table, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows)) throw new TypeError(`seed.${table} must be an array`)
    tables.set(table, rows.map((row) => clone(row)))
    counters.set(table, rows.length)
  }

  function requireTable(table) {
    if (!PREFIXES[table]) throw new TypeError(`unknown table: ${table}`)
  }

  return {
    get readCount() {
      return readCount
    },
    get(table, id) {
      requireTable(table)
      readCount += 1
      const row = (tables.get(table) ?? []).find((item) => item.id === id)
      return row === undefined ? undefined : clone(row)
    },
    list(table) {
      requireTable(table)
      readCount += 1
      return (tables.get(table) ?? []).map((row) => clone(row))
    },
    put(table, record) {
      requireTable(table)
      const rows = tables.get(table) ?? []
      let id = record.id
      if (id === undefined) {
        const next = counters.get(table) + 1
        counters.set(table, next)
        id = `${PREFIXES[table]}${next}`
      }
      const saved = { ...clone(record), id }
      rows.push(saved)
      tables.set(table, rows)
      return clone(saved)
    },
    update(table, id, patch) {
      requireTable(table)
      const rows = tables.get(table) ?? []
      const index = rows.findIndex((item) => item.id === id)
      if (index === -1) return undefined
      rows[index] = { ...rows[index], ...clone(patch), id }
      return clone(rows[index])
    },
    delete(table, id) {
      requireTable(table)
      const rows = tables.get(table) ?? []
      const index = rows.findIndex((item) => item.id === id)
      if (index === -1) return false
      rows.splice(index, 1)
      return true
    }
  }
}

module.exports = { createMemoryStore }
