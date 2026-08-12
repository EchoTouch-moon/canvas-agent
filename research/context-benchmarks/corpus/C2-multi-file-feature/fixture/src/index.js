const { makeGreeting } = require('./greeting')

function greetProfile(profile) {
  return makeGreeting(profile.name)
}

module.exports = { greetProfile }
