'use strict'

const { formatPrice } = require('../utils/format')

function createOrder({ id, currency, lines }) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('id must be a non-empty string')
  if (!Array.isArray(lines) || lines.length === 0) throw new TypeError('lines must be a non-empty array')
  return {
    id,
    currency,
    lines,
    lineTotal(line) {
      return line.unitPrice * line.quantity
    },
    subtotal() {
      return this.lines.reduce((sum, line) => sum + this.lineTotal(line), 0)
    },
    summary(locale) {
      const rows = this.lines.map((line) => {
        const lineText = formatPrice(this.lineTotal(line), this.currency, { locale })
        return `  ${line.name} x${line.quantity} ${lineText}`
      })
      const subtotalText = formatPrice(this.subtotal(), this.currency, { locale })
      const roundedText = formatPrice(this.subtotal(), this.currency, { locale, omitDecimals: true })
      return ['Order ' + this.id, ...rows, '  Subtotal ' + subtotalText, '  Rounded subtotal ' + roundedText].join('\n')
    }
  }
}

module.exports = { createOrder }
