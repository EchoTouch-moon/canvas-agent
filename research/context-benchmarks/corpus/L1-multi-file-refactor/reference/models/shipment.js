'use strict'

const { formatPrice } = require('../utils/format')

function createShipment({ id, orderId, carrier, insuredValue, currency }) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
  if (typeof carrier !== 'string' || carrier.length === 0) throw new TypeError('carrier must be a non-empty string')
  if (!Number.isFinite(insuredValue)) throw new TypeError('insuredValue must be a finite number')
  return {
    id,
    orderId,
    carrier,
    insuredValue,
    currency,
    label(locale) {
      const valueText = formatPrice(this.insuredValue, this.currency, { locale })
      return `Shipment ${this.id} via ${this.carrier} insured ${valueText}`
    }
  }
}

module.exports = { createShipment }
