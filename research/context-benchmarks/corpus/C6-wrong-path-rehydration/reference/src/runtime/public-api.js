const { evaluate } = require("../parser/evaluate");

function calculate(expression) {
  return evaluate(expression);
}

module.exports = { calculate };
