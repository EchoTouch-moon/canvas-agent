'use strict'

// Composition root: seeds a store, builds the three repositories, exposes the
// router. Nothing is cached today.

const { createMemoryStore } = require('./store')
const { createUserRepository } = require('./repositories/user-repository')
const { createProductRepository } = require('./repositories/product-repository')
const { createOrderRepository } = require('./repositories/order-repository')
const { createRouter } = require('./router')

const DEFAULT_SEED = {
  users: [
    { id: 'u1', name: 'Alice', email: 'alice@example.com' },
    { id: 'u2', name: 'Bob', email: 'bob@example.com' }
  ],
  products: [
    { id: 'p1', title: 'Keyboard', price: 45.5, currency: 'USD' },
    { id: 'p2', title: 'Mouse', price: 19.99, currency: 'USD' }
  ],
  orders: [
    {
      id: 'o1',
      userId: 'u1',
      status: 'open',
      items: [
        { sku: 'p1', quantity: 1, price: 45.5 },
        { sku: 'p2', quantity: 2, price: 19.99 }
      ]
    }
  ]
}

function createApp({ seed = DEFAULT_SEED } = {}) {
  const store = createMemoryStore(seed)
  const repositories = {
    users: createUserRepository({ store }),
    products: createProductRepository({ store }),
    orders: createOrderRepository({ store })
  }
  const router = createRouter({ repositories })
  return { store, repositories, router }
}

module.exports = { createApp, DEFAULT_SEED }
