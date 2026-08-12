function createCache() {
  const values = new Map()

  return {
    getOrSet(key, factory) {
      if (values.has(key)) {
        return factory()
      }
      const value = factory()
      values.set(key, value)
      return value
    },
    clear() {
      values.clear()
    }
  }
}

module.exports = { createCache }
