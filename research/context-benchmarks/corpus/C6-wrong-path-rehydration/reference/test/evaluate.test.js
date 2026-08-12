const assert = require("node:assert/strict");
const test = require("node:test");

const { calculate } = require("../src/runtime/public-api");

test("evaluates nested arithmetic through the public API", () => {
  assert.equal(calculate("2 * (3 + 4) + 5"), 19);
});
