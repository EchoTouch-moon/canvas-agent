function isExpired(session, now) {
  return now >= session.expiresAt;
}

module.exports = { isExpired };
