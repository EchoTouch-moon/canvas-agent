const { normalizeDisplayName } = require("./normalize");

function formatUser(user) {
  return normalizeDisplayName(`${user.firstName} ${user.lastName}`);
}

module.exports = { formatUser };
