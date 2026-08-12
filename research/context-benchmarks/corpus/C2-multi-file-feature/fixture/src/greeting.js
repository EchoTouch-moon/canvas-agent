const { DEFAULT_GREETING } = require('./config')

function makeGreeting(name) {
  return `${DEFAULT_GREETING}, ${name}`
}

module.exports = { makeGreeting }
