function isExpired(invoice, now) {
  return now > invoice.dueAt;
}

module.exports = { isExpired };
