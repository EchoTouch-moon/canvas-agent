const { makeGreeting } = require('./greeting')

function greetProfile(profile) {
  return makeGreeting(profile.name, { formal: profile.formal === true })
}

module.exports = { greetProfile }
