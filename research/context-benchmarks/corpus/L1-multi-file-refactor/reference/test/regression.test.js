'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { formatPercent, formatDuration } = require('../utils/format')
const { toMinorUnits, fromMinorUnits, parseAmount, applyRate } = require('../utils/money')
const { createInventory } = require('../services/inventory')
const { createCart } = require('../services/cart')

test('formatPercent keeps one decimal', () => {
  assert.equal(formatPercent(0.256), '25.6%')
  assert.equal(formatPercent(0), '0.0%')
  assert.throws(() => formatPercent(Number.NaN), TypeError)
})

test('formatDuration keeps millisecond and minute forms', () => {
  assert.equal(formatDuration(250), '250ms')
  assert.equal(formatDuration(65000), '1m05s')
  assert.throws(() => formatDuration(-1), TypeError)
})

test('money helpers keep their contracts', () => {
  assert.equal(toMinorUnits(12.34), 1234)
  assert.equal(fromMinorUnits(1234), 12.34)
  assert.equal(parseAmount('42.5'), 42.5)
  assert.throws(() => parseAmount('abc'), TypeError)
  assert.equal(applyRate(80, 0.25), 100)
})

test('cart numeric totals are unchanged', () => {
  const cart = createCart({ currency: 'USD' })
  cart.addItem({ sku: 'N1', name: 'Notebook', unitPrice: 3.5, quantity: 3 })
  cart.addItem({ sku: 'M1', name: 'Mug', unitPrice: 12, quantity: 1 })
  assert.equal(cart.total(), 22.5)
})

test('inventory listing keeps insertion order and raw values', () => {
  const inventory = createInventory({ currency: 'USD' })
  inventory.restock('Bolt', 4.99, 3)
  inventory.restock('Panel', 25, 2)
  assert.deepEqual(inventory.listItems(), [
    { name: 'Bolt', unitPrice: 4.99, quantity: 3 },
    { name: 'Panel', unitPrice: 25, quantity: 2 }
  ])
  assert.equal(inventory.totalValue() > 64.96 && inventory.totalValue() < 64.98, true)
})
