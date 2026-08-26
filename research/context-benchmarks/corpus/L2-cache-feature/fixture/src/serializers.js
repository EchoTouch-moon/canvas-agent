'use strict'

// Wire-format serializers for the three entities. Pure functions; the shapes
// here are part of the public API contract.

function serializeUser(user) {
  if (user === null || typeof user !== 'object') throw new TypeError('user must be an object')
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    display: `${user.name} <${user.email}>`
  }
}

function serializeProduct(product) {
  if (product === null || typeof product !== 'object') throw new TypeError('product must be an object')
  return {
    id: product.id,
    title: product.title,
    price: { amount: product.price, currency: product.currency }
  }
}

function serializeOrder(order) {
  if (order === null || typeof order !== 'object') throw new TypeError('order must be an object')
  const items = Array.isArray(order.items) ? order.items : []
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    total: Math.round(total * 100) / 100
  }
}

module.exports = { serializeUser, serializeProduct, serializeOrder }
