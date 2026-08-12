const assert = require("node:assert/strict");
const test = require("node:test");

const { isExpired } = require("../src/session-expiry");

test("the selected session policy expires at its boundary", () => {
  assert.equal(isExpired({ kind: "delta", expiresAt: 100 }, 100), true);
  assert.equal(isExpired({ kind: "delta", expiresAt: 100 }, 99), false);
});
