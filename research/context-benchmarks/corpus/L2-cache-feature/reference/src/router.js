'use strict'

// Minimal exact-match router over the repositories. Paths look like
// /health, /users, /users/u1, /products/p1, /orders, /orders/o1.

const { serializeUser, serializeProduct, serializeOrder } = require('./serializers')

function json(status, payload) {
  return { status, body: JSON.stringify(payload) }
}

function createRouter({ repositories }) {
  if (repositories === null || typeof repositories !== 'object') {
    throw new TypeError('repositories are required')
  }
  const { users, products, orders } = repositories

  function notFound() {
    return json(404, { error: 'not found' })
  }

  function resolve(method, path, body) {
    if (typeof method !== 'string' || typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('method and absolute path are required')
    }
    const segments = path.slice(1).split('/').filter((segment) => segment.length > 0)

    if (method === 'GET' && path === '/health') return json(200, { ok: true })

    if (method === 'GET' && segments[0] === 'users' && segments.length === 1) {
      return json(200, users.list().map(serializeUser))
    }
    if (method === 'GET' && segments[0] === 'users' && segments.length === 2) {
      const user = users.findById(segments[1])
      return user === undefined ? notFound() : json(200, serializeUser(user))
    }
    if (method === 'POST' && segments[0] === 'users' && segments.length === 1) {
      return json(201, serializeUser(users.create(body)))
    }

    if (method === 'GET' && segments[0] === 'products' && segments.length === 1) {
      return json(200, products.list().map(serializeProduct))
    }
    if (method === 'GET' && segments[0] === 'products' && segments.length === 2) {
      const product = products.findById(segments[1])
      return product === undefined ? notFound() : json(200, serializeProduct(product))
    }

    if (method === 'GET' && segments[0] === 'orders' && segments.length === 1) {
      return json(200, orders.list().map(serializeOrder))
    }
    if (method === 'GET' && segments[0] === 'orders' && segments.length === 2) {
      const order = orders.findById(segments[1])
      return order === undefined ? notFound() : json(200, serializeOrder(order))
    }
    if (method === 'POST' && segments[0] === 'orders' && segments.length === 1) {
      return json(201, serializeOrder(orders.create(body)))
    }

    return notFound()
  }

  return { resolve }
}

module.exports = { createRouter }
