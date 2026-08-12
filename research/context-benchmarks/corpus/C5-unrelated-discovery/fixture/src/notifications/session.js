function isExpired(notification, now) {
  return now > notification.expiresAt;
}

module.exports = { isExpired };
