function normalizeDisplayName(value) {
  return value.trim().replace(/\s+/g, " ");
}

module.exports = { normalizeDisplayName };
