import { describe, expect, it } from 'vitest'
import { c1CompositionBasis, c1ToolPairFingerprint } from '../src/c1-carried-removals'
import { createC1ObservedReadTrace } from '../src/c1-live-preflight'

describe('C1 carried removal provenance', () => {
  const observation = createC1ObservedReadTrace({
    observationId: 'carry',
    prompt: 'synthetic',
    fixtureFiles: ['README.md', 'file.js']
  })
  const id = 'c1-observation-carry-1'
  const removal = {
    toolCallId: id,
    pairFingerprint: c1ToolPairFingerprint(observation.messages, id),
    removalTransitionId: 'previous-sent-transition'
  }
  it('carries only the exact previously removed pair and keeps the current pair', () => {
    const basis = c1CompositionBasis(observation.messages, [removal], new Set())
    expect(basis.messages).toHaveLength(observation.messages.length - 2)
    expect(basis.removedSourceKeys).toEqual([`run/tool-call://${id}`, `run/tool-result://${id}`])
    expect(observation.messages).toHaveLength(5)
  })
  it('allows explicit restoration of both original source identities', () => {
    const basis = c1CompositionBasis(
      observation.messages,
      [removal],
      new Set([`run/tool-call://${id}`, `run/tool-result://${id}`])
    )
    expect(basis.messages).toBe(observation.messages)
    expect(basis.removedSourceKeys).toEqual([])
  })
  it('rejects one-sided restoration', () => {
    expect(() =>
      c1CompositionBasis(observation.messages, [removal], new Set([`run/tool-call://${id}`]))
    ).toThrow('membership changed')
  })
  it('rejects changed content under a reused call identity', () => {
    const changed = observation.messages.map((message) =>
      message.toolCallId === id
        ? { ...message, content: [{ type: 'text', text: 'different version' }] }
        : message
    )
    expect(() => c1CompositionBasis(changed, [removal], new Set())).toThrow('provenance')
  })
  it('rejects missing or ambiguous historical pairs', () => {
    expect(() =>
      c1CompositionBasis(observation.messages.slice(1), [removal], new Set())
    ).not.toThrow()
    expect(() => c1CompositionBasis(observation.messages.slice(2), [removal], new Set())).toThrow(
      'unambiguous'
    )
    expect(() =>
      c1CompositionBasis([...observation.messages, observation.messages[2]!], [removal], new Set())
    ).toThrow('unambiguous')
  })
})
