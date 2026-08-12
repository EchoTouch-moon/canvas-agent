function supports(session) {
  return session.kind === 'gamma'
}

function isExpired(session, now) {
  return now > session.expiresAt
}

module.exports = { supports, isExpired }
