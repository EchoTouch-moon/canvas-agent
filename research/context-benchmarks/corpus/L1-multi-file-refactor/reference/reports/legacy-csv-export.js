'use strict'

// Legacy CSV export for stock takes. Not wired into the storefront; kept for
// warehouse operators that still import CSV feeds.
// TODO: once formatPrice in utils/format.js settles on its new options
// contract, decide whether CSV exports need locale-aware columns too.

function escapeCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function rowsToCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  const lines = rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','))
  return [columns.join(','), ...lines].join('\n')
}

module.exports = { rowsToCsv, escapeCell }
