'use strict'

// Alternate XML export adapter evaluated during the ERP integration spike.
// Not wired into index.js; the JSON storefront API won. An equivalent XML
// shape is produced by reports/legacy-csv-export.js consumers downstream.

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toXml(tag, value) {
  if (typeof tag !== 'string' || tag.length === 0) throw new TypeError('tag must be a non-empty string')
  if (value !== null && typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([key, child]) => toXml(key, child))
      .join('')
    return `<${tag}>${inner}</${tag}>`
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`
}

module.exports = { toXml, escapeXml }
