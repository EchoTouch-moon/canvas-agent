const assert = require("node:assert/strict");
const test = require("node:test");

const { isExpired } = require("../src/security/session");

test("security sessions expire at their boundary", () => {
  assert.equal(isExpired({ expiresAt: 100 }, 100), true);
  assert.equal(isExpired({ expiresAt: 100 }, 99), false);
});
