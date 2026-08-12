const { tokenize } = require("./tokenize");

function evaluate(expression) {
  const tokens = tokenize(expression);
  let index = 0;

  function parseExpression() {
    let value = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index];
      index += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index];
      index += 1;
      const right = parseFactor();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseFactor() {
    const token = tokens[index];
    if (token === "(") {
      index += 1;
      const value = parseExpression();
      index += 1;
      return value;
    }
    index += 1;
    return Number(token);
  }

  return parseExpression();
}

module.exports = { evaluate };
