import { describe, expect, it } from 'vitest'
import {
  buildObservation,
  InMemoryObservationSink,
  ESTIMATE_SCOPE_AGENT_MESSAGES
} from '@canvas-agent/context-runtime'
import {
  PiContextShadowObserver,
  createPiContextShadowExtension,
  buildMessageFingerprint,
  mapPiMessage,
  mapPiMessages,
  stableSerializeArguments,
  type PiMessageView
} from '../src'

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantMessage(text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function toolCallMessage(name: string, id: string, args: unknown): PiMessageView {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', name, id, arguments: args }]
  }
}

function toolResultMessage(
  toolName: string,
  text: string,
  isError = false,
  toolCallId = 'call-1'
): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text }],
    toolName,
    toolCallId,
    isError
  }
}

const FIXED_NOW = '2026-08-11T00:00:00.000Z'

describe('pi message mapper', () => {
  it('maps user/assistant text deterministically', () => {
    expect(mapPiMessage(userMessage('hello')).category).toBe('USER')
    expect(mapPiMessage(assistantMessage('hi')).category).toBe('ASSISTANT')
    expect(mapPiMessage(userMessage('hello')).fingerprintText).toBe('hello')
    expect(mapPiMessage(userMessage('hello'))).toEqual(mapPiMessage(userMessage('hello')))
  })

  it('maps tool results with tool name, call id and error flag', () => {
    const mapped = mapPiMessage(toolResultMessage('read', 'content of file', false, 'call-9'))
    expect(mapped.category).toBe('TOOL_RESULT')
    expect(mapped.toolName).toBe('read')
    expect(mapped.toolCallId).toBe('call-9')
    expect(mapped.isError).toBe(false)
    const failed = mapPiMessage(toolResultMessage('bash', 'error', true))
    expect(failed.isError).toBe(true)
  })

  it('different tool result content from the same tool produces a different fingerprint', () => {
    const a = mapPiMessage(toolResultMessage('bash', 'success output'))
    const b = mapPiMessage(toolResultMessage('bash', 'different output'))
    expect(a.fingerprintText).not.toBe(b.fingerprintText)
    const da = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages: [a] })
    const db = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages: [b] })
    expect(da.messageDescriptors[0]!.contentHash).not.toBe(db.messageDescriptors[0]!.contentHash)
  })

  it('different tool-call arguments produce different fingerprints', () => {
    const a = mapPiMessage(toolCallMessage('read', 'call-1', { path: 'a.ts' }))
    const b = mapPiMessage(toolCallMessage('read', 'call-1', { path: 'b.ts' }))
    expect(a.fingerprintText).not.toBe(b.fingerprintText)
    const da = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages: [a] })
    const db = buildObservation({ runtimeSessionId: 's', sequence: 1, observedAt: 't', harness: 'PI', messages: [b] })
    expect(da.messageDescriptors[0]!.contentHash).not.toBe(db.messageDescriptors[0]!.contentHash)
  })

  it('tool-call name/id/arguments participate in the fingerprint', () => {
    const fingerprint = buildMessageFingerprint(toolCallMessage('edit', 'call-42', { file: 'a.ts', edits: [1, 2] })).fingerprintText
    expect(fingerprint).toContain('toolCall:edit:call-42')
    expect(fingerprint).toContain('file')
  })

  it('stableSerializeArguments is deterministic regardless of key order', () => {
    const a = stableSerializeArguments({ b: 1, a: 2 })
    const b = stableSerializeArguments({ a: 2, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":2,"b":1}')
  })

  it('image blocks are fingerprint/size accounted as type + bytes + hash, no payload', () => {
    const message: PiMessageView = {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', data: 'base64imagestring', mimeType: 'image/png' }
      ]
    }
    const mapped = mapPiMessage(message)
    expect(mapped.binaryBlocks).toBeDefined()
    expect(mapped.binaryBlocks![0]!.type).toBe('image')
    expect(mapped.binaryBlocks![0]!.mimeType).toBe('image/png')
    expect(mapped.binaryBlocks![0]!.byteLength).toBeGreaterThan(0)
    expect(mapped.binaryBlocks![0]!.contentHash).toMatch(/^[0-9a-f]{64}$/)
    // The raw payload must not appear in the fingerprint or the mapped input.
    expect(mapped.fingerprintText).not.toContain('base64imagestring')
    expect(JSON.stringify(mapped)).not.toContain('base64imagestring')
  })

  it('unknown/custom messages map to OTHER', () => {
    const mapped = mapPiMessage({ role: 'customRole', content: [], customType: 'artifact' })
    expect(mapped.category).toBe('OTHER')
    expect(mapped.contentType).toBe('artifact')
  })
})

describe('estimate scope', () => {
  it('observations carry an explicit agent-messages-pre-provider scope', () => {
    const observation = buildObservation({
      runtimeSessionId: 's',
      sequence: 1,
      observedAt: FIXED_NOW,
      harness: 'PI',
      messages: mapPiMessages([userMessage('hello')])
    })
    expect(observation.estimateScope).toBe(ESTIMATE_SCOPE_AGENT_MESSAGES)
    expect(observation.estimateScope).toBe('agent-messages-pre-provider')
  })
})

describe('PiContextShadowObserver', () => {
  it('1) each context callback produces exactly one observation', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    observer.handleContextEvent([userMessage('a')])
    observer.handleContextEvent([userMessage('b')])
    expect(observer.inMemory.count).toBe(2)
  })

  it('2) sequence is monotonic within a Runtime Session', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    observer.handleContextEvent([userMessage('a')])
    observer.handleContextEvent([userMessage('b')])
    observer.handleContextEvent([userMessage('c')])
    const sequences = observer.inMemory.observations.map((o) => o.sequence)
    expect(sequences).toEqual([1, 2, 3])
    expect(observer.runtimeSession.sequenceTimeline()).toEqual([1, 2, 3])
  })

  it('3) identical normalized input produces identical descriptors/hashes', () => {
    const a = new PiContextShadowObserver({ runtimeSessionId: 's-a', now: () => FIXED_NOW })
    const b = new PiContextShadowObserver({ runtimeSessionId: 's-b', now: () => FIXED_NOW })
    const messages = [userMessage('same text'), assistantMessage('reply')]
    a.handleContextEvent(messages)
    b.handleContextEvent(messages)
    const oa = a.inMemory.last()!
    const ob = b.inMemory.last()!
    expect(oa.messageDescriptors).toEqual(ob.messageDescriptors)
    expect(oa.observedMessageTokenEstimate).toBe(ob.observedMessageTokenEstimate)
  })

  it('4) returned messages are the same array, semantically unchanged', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    const messages = [userMessage('keep me'), assistantMessage('and me')]
    const result = observer.handleContextEvent(messages)
    // Identity: the exact same array is returned, not a copy.
    expect(result.messages).toBe(messages)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toBe(messages[0])
    expect(result.messages[1]).toBe(messages[1])
  })

  it('5) default serialized observation contains no credentials and no raw content', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    const secret = 'sk-supersecret-abcdef1234567890'
    observer.handleContextEvent([userMessage(secret)])
    const raw = JSON.stringify(observer.inMemory.last())
    expect(raw).not.toContain(secret)
    expect(raw).not.toContain('sk-supersecret')
  })

  it('6) raw capture is disabled by default', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    observer.handleContextEvent([userMessage('plain content that should not persist')])
    const last = observer.inMemory.last()!
    expect(last.messageDescriptors[0]?.rawPreview).toBeUndefined()
  })

  it('7) multiple model calls form a complete timeline', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    observer.handleContextEvent([userMessage('instruct')])
    observer.handleContextEvent([userMessage('instruct'), assistantMessage('calls read')])
    observer.handleContextEvent([
      userMessage('instruct'),
      assistantMessage('calls read'),
      toolResultMessage('read', 'contents')
    ])
    const observations = observer.inMemory.observations
    expect(observations.map((o) => o.sequence)).toEqual([1, 2, 3])
    expect(observations[0]!.messageCount).toBe(1)
    expect(observations[1]!.messageCount).toBe(2)
    expect(observations[2]!.messageCount).toBe(3)
    expect(observations[2]!.toolResultCount).toBe(1)
    expect(observations[0]!.observedMessageTokenEstimate).toBeLessThan(
      observations[2]!.observedMessageTokenEstimate
    )
  })

  it('8) the extension handler returns original messages unchanged', async () => {
    // When the integration is wired, the Pi `context` handler must be a pure
    // pass-through. Simulate the Pi extension factory contract.
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    const extension = createPiContextShadowExtension({ observer })
    let capturedResult: { messages: readonly PiMessageView[] } | undefined
    let capturedMessages: readonly PiMessageView[] | undefined
    const dispatch = extension as (
      pi: { on: (event: 'context', handler: (event: unknown, ctx: unknown) => unknown) => void }
    ) => void
    await new Promise<void>((resolve) => {
      dispatch({
        on: (_event, handler) => {
          const messages = [userMessage('native context')]
          capturedMessages = messages
          void Promise.resolve(handler({ messages }, {})).then((result) => {
            capturedResult = result as { messages: readonly PiMessageView[] }
            resolve()
          })
        }
      })
    })
    expect(capturedResult).toBeDefined()
    expect(capturedResult!.messages).toBe(capturedMessages)
    expect(capturedResult!.messages).toHaveLength(1)
    expect(observer.inMemory.count).toBe(1)
  })

  it('9) the observer records a provider-neutral harness identifier', () => {
    const observer = new PiContextShadowObserver({ now: () => FIXED_NOW })
    observer.handleContextEvent([userMessage('x')])
    expect(observer.inMemory.last()!.harness).toBe('PI')
  })
})

describe('integration with the Context Runtime core', () => {
  it('the observer records through an in-memory sink usable by the core', () => {
    const sink = new InMemoryObservationSink()
    const observer = new PiContextShadowObserver({
      runtimeSessionId: 'session-001',
      now: () => FIXED_NOW,
      sinks: { inMemory: sink }
    })
    observer.handleContextEvent([userMessage('hello'), assistantMessage('world')])
    expect(sink.count).toBe(1)
    const observation = buildObservation({
      runtimeSessionId: observer.runtimeSession.runtimeSessionId,
      sequence: 1,
      observedAt: FIXED_NOW,
      harness: 'PI',
      messages: mapPiMessages([userMessage('hello'), assistantMessage('world')])
    })
    expect(observation.messageCount).toBe(2)
    expect(observation.categoryCounts.USER).toBe(1)
    expect(observation.categoryCounts.ASSISTANT).toBe(1)
    expect(observation.estimateScope).toBe('agent-messages-pre-provider')
  })
})
