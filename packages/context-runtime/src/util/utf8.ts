// Byte-safe UTF-8 truncation for bounded raw previews. JS `slice()` operates on
// code units, which can cut a multi-byte character in half; these helpers
// truncate at whole-code-point boundaries and measure real UTF-8 bytes.

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

// Returns the longest prefix of `text` whose UTF-8 byte length does not exceed
// `maxBytes`. Iterates by code point so surrogate pairs (e.g. emoji) are never
// split.
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let result = ''
  let bytes = 0
  for (const codePoint of text) {
    const codePointBytes = utf8ByteLength(codePoint)
    if (bytes + codePointBytes > maxBytes) {
      break
    }
    result += codePoint
    bytes += codePointBytes
  }
  return result
}
