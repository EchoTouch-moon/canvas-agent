import { describe, expect, it } from 'vitest'
import {
  RuntimeSession,
  RawCaptureBudget,
  buildObservation,
  countCategories,
  countToolResults,
  estimateTokens,
  hashNormalizedMessage,
  normalizeMessage,
  containsKnownCredential,
  redactSensitive,
  type NormalizedMessageInput
} from '../src'

function userMessage(text: string): NormalizedMessageInput {
  return { role: 'user', category: 'USER', contentType: 'text', text }
}

function assistantMessage(text: string): NormalizedMessageInput {
  return { role: 'assistant', category: 'ASSISTANT', contentType: 'text', text }
}

function toolResult(toolName: string, text: string): NormalizedMessageInput {
  return {
    role: 'toolResult',
    category: 'TOOL_RESULT',
    contentType: 'toolResult',
    text,
    toolName
  }
}

describe('token estimate', () => {
  it('matches the documented whitespace-collapsed 4-char heuristic', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('a   b')).toBe(1)
  })
})

describe('deterministic normalization', () => {
  it('same normalized input -> same hash and descriptor', () => {
    const a = normalizeMessage(userMessage('hello world'), 0)
    const b = normalizeMessage(userMessage('hello world'), 0)
    expect(a).toEqual(b)
    expect(a.contentHash).toBe(hashNormalizedMessage('hello world'))
    expect(a.estimatedTokens).toBe(estimateTokens('hello world'))
  })

  it('different text -> different hash', () => {
    const a = normalizeMessage(userMessage('hello'), 0)
    const b = normalizeMessage(userMessage('hello '), 0)
    expect(a.contentHash).not.toBe(b.contentHash)
  })

  it('tool result descriptor carries tool name and error flag', () => {
    const descriptor = normalizeMessage(
      { role: 'toolResult', category: 'TOOL_RESULT', contentType: 'toolResult', text: 'out', toolName: 'bash', isError: true },
      0
    )
    expect(descriptor.toolName).toBe('bash')
    expect(descriptor.isError).toBe(true)
  })
})

describe('category counting', () => {
  it('counts categories and tool results', () => {
    const messages = [userMessage('u'), assistantMessage('a'), toolResult('read', 'x'), toolResult('bash', 'y')]
    const counts = countCategories(messages)
    expect(counts.USER).toBe(1)
    expect(counts.ASSISTANT).toBe(1)
    expect(counts.TOOL_RESULT).toBe(2)
    expect(counts.OTHER).toBe(0)
    expect(countToolResults(messages)).toBe(2)
  })
})

describe('buildObservation determinism and growth', () => {
  it('same input + same raw budget -> identical observation', () => {
    const messages = [userMessage('fix the test'), assistantMessage('I will check the code.'), toolResult('read', 'file contents...')]
    const a = buildObservation({ runtimeSessionId: 's-1', sequence: 3, observedAt: '2026-08-11T00:00:00.000Z', harness: 'PI', messages }, RawCaptureBudget.disabled())
    const b = buildObservation({ runtimeSessionId: 's-1', sequence: 3, observedAt: '2026-08-11T00:00:00.000Z', harness: 'PI', messages }, RawCaptureBudget.disabled())
    expect(a).toEqual(b)
  })

  it('produces a timeline across sequences', () => {
    const base = { runtimeSessionId: 's-1', observedAt: '2026-08-11T00:00:00.000Z', harness: 'PI' as const }
    const obs1 = buildObservation({ ...base, sequence: 1, messages: [userMessage('hi')] })
    const obs2 = buildObservation({
      ...base,
      sequence: 2,
      messages: [userMessage('hi'), assistantMessage('hello'), toolResult('ls', 'a.txt b.txt')]
    })
    expect(obs1.sequence).toBe(1)
    expect(obs2.sequence).toBe(2)
    expect(obs1.messageCount).toBe(1)
    expect(obs2.messageCount).toBe(3)
    expect(obs2.toolResultCount).toBe(1)
    expect(obs2.nativeContextEstimate).toBeGreaterThan(obs1.nativeContextEstimate)
  })

  it('raw capture off by default; no rawPreview present', () => {
    const messages = [userMessage('sensitive: sk-secret-value-that-must-not-leak')]
    const observation = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages })
    expect(observation.messageDescriptors[0]?.rawPreview).toBeUndefined()
  })

  it('raw capture opt-in is bounded and redacted', () => {
    const messages = [userMessage('prefix sk-myapikey123456789 suffix and more content beyond limit')]
    const budget = new RawCaptureBudget(60, 200)
    const observation = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages }, budget)
    const rawPreview = observation.messageDescriptors[0]?.rawPreview
    expect(rawPreview).toBeDefined()
    expect(rawPreview!.length).toBeLessThanOrEqual(60)
    expect(rawPreview).not.toContain('sk-myapikey123456789')
    expect(rawPreview).toContain('REDACTED')
  })

  it('raw capture per-run total is capped across observations', () => {
    const budget = new RawCaptureBudget(50, 30)
    const first = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages: [userMessage('a'.repeat(50))] }, budget)
    const second = buildObservation({ runtimeSessionId: 's', sequence: 2, observedAt: 't', harness: 'PI', messages: [userMessage('b'.repeat(50))] }, budget)
    // First consumes 30 of 30; second has zero budget left.
    expect(first.messageDescriptors[0]?.rawPreview).toBeDefined()
    expect(second.messageDescriptors[0]?.rawPreview).toBeUndefined()
  })
})

describe('RuntimeSession sequence', () => {
  it('sequence is monotonic across claims', () => {
    const session = new RuntimeSession('session-001')
    expect(session.currentSequence()).toBe(0)
    const first = session.nextSequence()
    const second = session.nextSequence()
    const third = session.nextSequence()
    expect([first, second, third]).toEqual([1, 2, 3])
    expect(session.sequenceTimeline()).toEqual([1, 2, 3])
  })

  it('sequence restarts at the provided starting value', () => {
    const session = new RuntimeSession('session-abc', 5)
    expect(session.nextSequence()).toBe(5)
    expect(session.nextSequence()).toBe(6)
  })
})

describe('redaction', () => {
  it('redacts known credential patterns', () => {
    const input = 'Authorization: Bearer abcd1234 and key=sk-abcdefghijklmnop'
    const redacted = redactSensitive(input)
    expect(redacted).not.toContain('sk-abcdefghijklmnop')
    expect(redacted).not.toContain('abcd1234')
    expect(containsKnownCredential(input)).toBe(true)
  })

  it('fully scrubbed text no longer reports a known credential', () => {
    const input = 'sk-abcdefghijklmnop'
    const redacted = redactSensitive(input)
    expect(redacted).toContain('REDACTED')
    expect(redacted).not.toContain('abcdefghijklmnop')
    expect(containsKnownCredential(redacted)).toBe(false)
  })
})
