'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createApiClient, createRecordingTransport } = require('../src/client')
const { serializeUser, serializeProduct, serializeOrder } = require('../src/serializers')
const { createApp } = require('../src/app')

test('api client builds and records requests deterministically', async () => {
  const transport = createRecordingTransport()
  const client = createApiClient({ transport })
  assert.equal(client.buildPath('users', 'u1'), '/users/u1')
  const got = await client.get('users', 'u1')
  assert.deepEqual(got, { method: 'GET', path: '/users/u1', body: null })
  const posted = await client.post({ name: 'Cara' }, 'users')
  assert.deepEqual(posted, { method: 'POST', path: '/users', body: { name: 'Cara' } })
  assert.equal(transport.calls.length, 2)
})

test('serializers keep their wire shapes', () => {
  assert.deepEqual(serializeUser({ id: 'u1', name: 'Alice', email: 'alice@example.com' }), {
    id: 'u1',
    name: 'Alice',
    email: 'alice@example.com',
    display: 'Alice <alice@example.com>'
  })
  assert.deepEqual(serializeProduct({ id: 'p1', title: 'Keyboard', price: 45.5, currency: 'USD' }), {
    id: 'p1',
    title: 'Keyboard',
    price: { amount: 45.5, currency: 'USD' }
  })
  assert.deepEqual(
    serializeOrder({
      id: 'o1',
      userId: 'u1',
      status: 'open',
      items: [
        { sku: 'p1', quantity: 1, price: 45.5 },
        { sku: 'p2', quantity: 2, price: 19.99 }
      ]
    }),
    { id: 'o1', userId: 'u1', status: 'open', itemCount: 3, total: 85.48 }
  )
})

test('router keeps existing health, 404, and read behavior', () => {
  const app = createApp()
  const { router } = app

  const health = router.resolve('GET', '/health')
  assert.equal(health.status, 200)
  assert.deepEqual(JSON.parse(health.body), { ok: true })

  const missing = router.resolve('GET', '/nope')
  assert.equal(missing.status, 404)
  assert.deepEqual(JSON.parse(missing.body), { error: 'not found' })

  const user = router.resolve('GET', '/users/u1')
  assert.equal(user.status, 200)
  assert.deepEqual(JSON.parse(user.body), {
    id: 'u1',
    name: 'Alice',
    email: 'alice@example.com',
    display: 'Alice <alice@example.com>'
  })

  const order = router.resolve('GET', '/orders/o1')
  assert.equal(order.status, 200)
  assert.deepEqual(JSON.parse(order.body), {
    id: 'o1',
    userId: 'u1',
    status: 'open',
    itemCount: 3,
    total: 85.48
  })
})

test('router keeps existing create behavior', () => {
  const app = createApp()
  const { router } = app

  const created = router.resolve('POST', '/users', { name: 'Cara', email: 'cara@example.com' })
  assert.equal(created.status, 201)
  assert.deepEqual(JSON.parse(created.body), {
    id: 'u3',
    name: 'Cara',
    email: 'cara@example.com',
    display: 'Cara <cara@example.com>'
  })

  const listed = router.resolve('GET', '/users')
  assert.equal(listed.status, 200)
  assert.equal(JSON.parse(listed.body).length, 3)
})
