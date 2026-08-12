function supports(session) {
  return session.kind === 'beta'
}

function isExpired(session, now) {
  return now > session.dueAt
}

module.exports = { supports, isExpired }
