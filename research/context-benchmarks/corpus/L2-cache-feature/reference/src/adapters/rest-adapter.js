'use strict'

// REST adapter from the first integration attempt. The storefront went with
// the plain router in src/router.js instead; kept for reference.

function toRestRequest(method, path, body) {
  if (typeof method !== 'string' || typeof path !== 'string') {
    throw new TypeError('method and path must be strings')
  }
  return { method, path, body: body ?? null, requestId: `req-${method}-${path}` }
}

function toRestResponse(status, payload) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RangeError('status must be a 3-digit integer')
  }
  return { status, body: JSON.stringify(payload) }
}

module.exports = { toRestRequest, toRestResponse }
