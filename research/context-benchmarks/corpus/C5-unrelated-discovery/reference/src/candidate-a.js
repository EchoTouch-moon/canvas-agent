function supports(session) {
  return session.kind === 'alpha'
}

function isExpired(session, now) {
  return now > session.expiresAt
}

module.exports = { supports, isExpired }
