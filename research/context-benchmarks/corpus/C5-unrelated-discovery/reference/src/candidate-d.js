function supports(session) {
  return session.kind === 'delta'
}

function isExpired(session, now) {
  return now >= session.expiresAt
}

module.exports = { supports, isExpired }
