'use strict'

// Stable string hashing and bucket assignment used by the sharding tools.
// The radix-31 rolling hash keeps bucket assignment stable across runs; the
// defensive modulo keeps negative intermediate hashes in range.

const HASH_RADIX = 31
const HASH_MODULUS = 2147483647

function hashKey(key) {
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('key must be a non-empty string')
  let hash = 0
  for (const ch of key) {
    hash = (hash * HASH_RADIX + ch.codePointAt(0)) % HASH_MODULUS
  }
  return hash
}

function bucketFor(key, buckets) {
  if (!Number.isInteger(buckets) || buckets < 1) throw new RangeError('buckets must be a positive integer')
  const normalized = hashKey(key) % buckets
  return normalized < 0 ? normalized + buckets : normalized
}

module.exports = { hashKey, bucketFor }
