// Redaction for research shadow output. Raw message text is off by default;
// when a debug opt-in enables bounded raw capture, known credential-bearing
// patterns are scrubbed before anything is written.

const KEY_PATTERNS: readonly RegExp[] = [
  // sk-... API keys (OpenAI-style), sk-ant-..., sk-proj-...
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Authorization / Proxy-Authorization headers
  /("?authorization"?\s*[:=]\s*)[^\s,;"']+/gi,
  // DeepSeek / Anthropic / OpenAI style keys after an assignment
  /(\b(?:api[_-]?key|apiKey|secret|token|password)\b\s*[:=]\s*)[^\s,;"']+/gi
]

const REDACTED = '***REDACTED***'

export function redactSensitive(text: string): string {
  let out = text
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) => {
      return prefix !== undefined ? `${prefix}${REDACTED}` : REDACTED
    })
  }
  return out
}

export function containsKnownCredential(text: string): boolean {
  // A value that is already fully redacted is not an open credential. Ignore
  // the redaction marker before testing so a scrubbed header does not trigger a
  // false positive.
  const withoutRedacted = text.split(REDACTED).join('')
  return KEY_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(withoutRedacted)
  })
}
