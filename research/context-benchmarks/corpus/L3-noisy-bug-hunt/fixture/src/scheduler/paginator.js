'use strict'

// 1-based pagination over a snapshot array. Page windows are half-open
// [start, end) over the input.

function paginate(items, page, pageSize) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array')
  if (!Number.isInteger(page) || page < 1) throw new RangeError('page is 1-based')
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer')
  const total = items.length
  const pageCount = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  const end = start + pageSize - 1
  return {
    items: items.slice(start, end),
    page,
    pageSize,
    total,
    pageCount,
    hasNextPage: page < pageCount
  }
}

module.exports = { paginate }
