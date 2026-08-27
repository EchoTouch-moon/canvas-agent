'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { formatPrice } = require('../utils/format')
const { createProduct } = require('../models/product')
const { createOrder } = require('../models/order')
const { createShipment } = require('../models/shipment')
const { createCart } = require('../services/cart')
const { createPricingService } = require('../services/pricing')
const { createInventory } = require('../services/inventory')
const { createBillingService } = require('../services/billing')
const { renderQuote } = require('../index')

// --- formatPrice contract -------------------------------------------------

test('formatPrice requires an options object', () => {
  assert.throws(() => formatPrice(10, 'USD'), TypeError)
  assert.throws(() => formatPrice(10, 'USD', null), TypeError)
  assert.throws(() => formatPrice(10, 'USD', 'en-US'), TypeError)
  assert.throws(() => formatPrice(10, 'USD', ['en-US']), TypeError)
})

test('formatPrice requires a known locale', () => {
  assert.throws(() => formatPrice(10, 'USD', {}), TypeError)
  assert.throws(() => formatPrice(10, 'USD', { locale: '' }), TypeError)
  assert.throws(() => formatPrice(10, 'USD', { locale: 'xx-XX' }), TypeError)
})

test('en-US formats with prefixed symbol, comma grouping, dot decimals', () => {
  assert.equal(formatPrice(1234.56, 'USD', { locale: 'en-US' }), '$1,234.56')
  assert.equal(formatPrice(0, 'GBP', { locale: 'en-US' }), '£0.00')
})

test('de-DE formats with suffixed symbol, dot grouping, comma decimals', () => {
  assert.equal(formatPrice(1234.56, 'EUR', { locale: 'de-DE' }), '1.234,56 €')
})

test('fr-FR formats with space grouping and suffixed symbol', () => {
  assert.equal(formatPrice(1234.56, 'EUR', { locale: 'fr-FR' }), '1 234,56 €')
})

test('JPY has no minor units', () => {
  assert.equal(formatPrice(1234.5, 'JPY', { locale: 'en-US' }), '¥1,235')
})

test('omitDecimals drops minor units for any currency', () => {
  assert.equal(formatPrice(1234.56, 'USD', { locale: 'de-DE', omitDecimals: true }), '1.235 $')
})

test('negative amounts keep the sign before the digits', () => {
  assert.equal(formatPrice(-98.5, 'USD', { locale: 'en-US' }), '-$98.50')
  assert.equal(formatPrice(-98.5, 'EUR', { locale: 'fr-FR' }), '-98,50 €')
})

// --- migrated call sites --------------------------------------------------

test('product.describe formats through the new contract', () => {
  const product = createProduct({
    sku: 'SKU-0417',
    name: 'Studio Desk',
    price: 1234.56,
    currency: 'EUR',
    quantity: 2
  })
  assert.equal(product.describe('de-DE'), 'SKU-0417 Studio Desk x2 1.234,56 €')
})

test('order.summary formats every line through the new contract', () => {
  const order = createOrder({
    id: 'ORD-1001',
    currency: 'EUR',
    lines: [
      { sku: 'A1', name: 'Cable', unitPrice: 10.5, quantity: 2 },
      { sku: 'B2', name: 'Adapter', unitPrice: 4.25, quantity: 4 }
    ]
  })
  assert.equal(
    order.summary('de-DE'),
    [
      'Order ORD-1001',
      '  Cable x2 21,00 €',
      '  Adapter x4 17,00 €',
      '  Subtotal 38,00 €',
      '  Rounded subtotal 38 €'
    ].join('\n')
  )
})

test('shipment.label formats through the new contract', () => {
  const shipment = createShipment({
    id: 'SHP-77',
    orderId: 'ORD-1001',
    carrier: 'RailShip',
    insuredValue: 2500,
    currency: 'GBP'
  })
  assert.equal(shipment.label('en-US'), 'Shipment SHP-77 via RailShip insured £2,500.00')
})

test('cart.receipt formats through the new contract', () => {
  const cart = createCart({ currency: 'USD' })
  cart.addItem({ sku: 'N1', name: 'Notebook', unitPrice: 3.5, quantity: 3 })
  cart.addItem({ sku: 'M1', name: 'Mug', unitPrice: 12, quantity: 1 })
  assert.equal(
    cart.receipt('en-US'),
    ['Cart receipt', '  Notebook x3 $10.50', '  Mug x1 $12.00', 'Total $22.50'].join('\n')
  )
})

test('pricing.quote formats through the new contract', () => {
  const pricing = createPricingService()
  assert.equal(pricing.quote(80, 'USD', 'fr-FR'), '100,00 $')
})

test('inventory.valuation formats a rounded total through the new contract', () => {
  const inventory = createInventory({ currency: 'USD' })
  inventory.restock('Bolt', 4.99, 3)
  inventory.restock('Panel', 25, 2)
  assert.equal(inventory.valuation('en-US'), 'Inventory value $65')
})

test('billing.invoiceLine formats through the new contract', () => {
  const billing = createBillingService()
  const line = billing.invoiceLine({ description: 'Support plan', amount: 100, currency: 'EUR' }, 'de-DE')
  assert.equal(line, 'INVOICE Support plan 108,00 €')
})

test('renderQuote facade formats through the new contract', () => {
  assert.equal(renderQuote(9.99, 'GBP', 'fr-FR'), 'Quote: 9,99 £')
})
