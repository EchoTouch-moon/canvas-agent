'use strict'

// Console logger variant kept for CLI smoke runs. The app itself does not
// configure a logger; wire this in only when debugging locally.

const LEVELS = ['debug', 'info', 'warn', 'error']

function createConsoleLogger({ level = 'info' } = {}) {
  if (!LEVELS.includes(level)) throw new TypeError(`level must be one of ${LEVELS.join('/')}`)
  const threshold = LEVELS.indexOf(level)
  return {
    level,
    log(messageLevel, message) {
      if (!LEVELS.includes(messageLevel)) throw new TypeError(`level must be one of ${LEVELS.join('/')}`)
      if (LEVELS.indexOf(messageLevel) >= threshold) {
        return `[${messageLevel}] ${message}`
      }
      return null
    }
  }
}

module.exports = { createConsoleLogger }
