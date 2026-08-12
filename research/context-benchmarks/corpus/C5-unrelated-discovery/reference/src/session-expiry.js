const handlers = Object.freeze([
  require('./candidate-a'),
  require('./candidate-b'),
  require('./candidate-c'),
  require('./candidate-d')
])

function isExpired(session, now) {
  const handler = handlers.find((candidate) => candidate.supports(session))
  if (handler === undefined) throw new TypeError('unknown session strategy')
  return handler.isExpired(session, now)
}

module.exports = { isExpired }
