function tokenize(expression) {
  return expression.match(/\d+|[()+*/-]/g) ?? [];
}

module.exports = { tokenize };
