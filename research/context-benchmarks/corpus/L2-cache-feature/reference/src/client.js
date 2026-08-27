'use strict'

// Transport-agnostic API client. The transport is injected so tests can
// record requests instead of performing I/O.

function createApiClient({ transport, basePath = '' }) {
  if (transport === null || typeof transport !== 'object' || typeof transport.request !== 'function') {
    throw new TypeError('transport with a request() function is required')
  }
  if (typeof basePath !== 'string') throw new TypeError('basePath must be a string')
  return {
    basePath,
    buildPath(...parts) {
      const path = `/${parts.map((part) => String(part)).join('/')}`
      return `${this.basePath}${path}`
    },
    get(...parts) {
      return transport.request('GET', this.buildPath(...parts))
    },
    post(body, ...parts) {
      return transport.request('POST', this.buildPath(...parts), body)
    }
  }
}

function createRecordingTransport() {
  const calls = []
  return {
    calls,
    async request(method, path, body) {
      const response = { method, path, body: body ?? null }
      calls.push(response)
      return response
    }
  }
}

module.exports = { createApiClient, createRecordingTransport }
