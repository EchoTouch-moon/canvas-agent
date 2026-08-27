'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemoryStore } = require('../src/store')
const { createUserRepository } = require('../src/repositories/user-repository')
const { createProductRepository } = require('../src/repositories/product-repository')
const { createOrderRepository } = require('../src/repositories/order-repository')
const { createApp } = require('../src/app')

const SEED = {
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

test('repeated findById within the TTL reaches the store exactly once', () => {
  let now = 1000
  const clock = { now: () => now }
  const store = createMemoryStore(SEED)
  const users = createUserRepository({ store, ttlMs: 1000, clock })

  const before = store.readCount
  const first = users.findById('u1')
  users.findById('u1')
  users.findById('u1')
  assert.equal(store.readCount - before, 1)
  assert.deepEqual(first, { id: 'u1', name: 'Alice', email: 'alice@example.com' })
  assert.deepEqual(users.findById('u1'), first)
})

test('entries expire after the TTL and re-enter the store', () => {
  let now = 1000
  const clock = { now: () => now }
  const store = createMemoryStore(SEED)
  const users = createUserRepository({ store, ttlMs: 1000, clock })

  const before = store.readCount
  users.findById('u1')
  assert.equal(store.readCount - before, 1)

  now = 1500
  users.findById('u1')
  assert.equal(store.readCount - before, 1)

  now = 2501
  users.findById('u1')
  assert.equal(store.readCount - before, 2)
})

test('repeated list() within the TTL reaches the store exactly once', () => {
  const clock = { now: () => 1000 }
  const store = createMemoryStore(SEED)
  const products = createProductRepository({ store, ttlMs: 1000, clock })

  const before = store.readCount
  const first = products.list()
  products.list()
  assert.equal(store.readCount - before, 1)
  assert.equal(first.length, 2)
  assert.deepEqual(products.list(), first)
})

test('each repository caches independently over one store', () => {
  const clock = { now: () => 1000 }
  const store = createMemoryStore(SEED)
  const users = createUserRepository({ store, ttlMs: 1000, clock })
  const products = createProductRepository({ store, ttlMs: 1000, clock })
  const orders = createOrderRepository({ store, ttlMs: 1000, clock })

  const before = store.readCount
  users.findById('u1')
  users.findById('u1')
  orders.findById('o1')
  orders.findById('o1')
  assert.equal(store.readCount - before, 2)
  products.findById('p1')
  assert.equal(store.readCount - before, 3)
})

test('update() invalidates cached reads', () => {
  const clock = { now: () => 1000 }
  const store = createMemoryStore(SEED)
  const users = createUserRepository({ store, ttlMs: 1000, clock })

  users.findById('u1')
  const before = store.readCount
  users.update('u1', { name: 'Alicia' })
  const fresh = users.findById('u1')
  assert.deepEqual(fresh, { id: 'u1', name: 'Alicia', email: 'alice@example.com' })
  assert.equal(store.readCount - before, 1)
})

test('remove() invalidates cached reads', () => {
  const clock = { now: () => 1000 }
  const store = createMemoryStore(SEED)
  const orders = createOrderRepository({ store, ttlMs: 1000, clock })

  orders.findById('o1')
  const before = store.readCount
  assert.equal(orders.remove('o1'), true)
  assert.equal(orders.findById('o1'), undefined)
  assert.equal(store.readCount - before, 1)
})

test('router reads are cached end-to-end and writes stay visible', () => {
  let now = 1000
  const clock = { now: () => now }
  const app = createApp({ seed: SEED, ttlMs: 1000, clock })
  const { router, store } = app

  const before = store.readCount
  const first = router.resolve('GET', '/users/u1')
  const second = router.resolve('GET', '/users/u1')
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.deepEqual(JSON.parse(second.body), JSON.parse(first.body))
  assert.equal(store.readCount - before, 1)

  const created = router.resolve('POST', '/users', { name: 'Cara', email: 'cara@example.com' })
  assert.equal(created.status, 201)
  const fetched = router.resolve('GET', '/users/u3')
  assert.equal(fetched.status, 200)
  assert.equal(JSON.parse(fetched.body).display, 'Cara <cara@example.com>')
})
