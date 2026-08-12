const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { formatUser } = require("../src/domain/user");

test("preserves display-name behavior", () => {
  assert.equal(formatUser({ firstName: " Ada ", lastName: "Lovelace" }), "Ada Lovelace");
});

test("domain does not depend on the CLI layer", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/domain/user.js"), "utf8");
  assert.doesNotMatch(source, /\.\.\/cli\//);
});
