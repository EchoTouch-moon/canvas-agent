import { createHash } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

// Deterministic, canonical hash of a normalized message. Input is the already
// normalized provider-neutral text representation; the same normalized input
// always yields the same hash.
export function hashNormalizedMessage(normalizedText: string): string {
  return sha256Hex(`v1|${normalizedText}`)
}
