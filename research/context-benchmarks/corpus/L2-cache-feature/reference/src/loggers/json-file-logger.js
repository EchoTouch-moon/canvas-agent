'use strict'

// JSON-line logger variant for the observability spike. Not wired into the
// app; produces formatted lines only and never touches the filesystem unless
// a caller persists them.

function formatLine(at, level, message) {
  if (!Number.isFinite(at)) throw new TypeError('at must be a finite timestamp')
  if (typeof message !== 'string') throw new TypeError('message must be a string')
  return JSON.stringify({ at, level, message })
}

function createJsonFileLogger({ levels = ['info', 'error'] } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) throw new TypeError('levels must be a non-empty array')
  const lines = []
  return {
    levels: [...levels],
    log(level, message, at) {
      if (!this.levels.includes(level)) return null
      const line = formatLine(at ?? 0, level, message)
      lines.push(line)
      return line
    },
    all() {
      return [...lines]
    }
  }
}

module.exports = { createJsonFileLogger, formatLine }
