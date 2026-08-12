const { DEFAULT_GREETING, DEFAULT_PUNCTUATION } = require('./config')

function makeGreeting(name, options = {}) {
  const punctuation = options.formal === true ? DEFAULT_PUNCTUATION : ''
  return `${DEFAULT_GREETING}, ${name}${punctuation}`
}

module.exports = { makeGreeting }
