import { describe, expect, it } from 'vitest'
import { applyC1DuplicateReadPolicy } from '../src/c1-duplicate-read-policy'
import { createC1ObservedReadTrace } from '../src/c1-live-preflight'
import { runC1InterventionProbe } from '../src/c1-intervention-probe'
import { resolve } from 'node:path'

function observation(files = ['README.md', 'README.md']) {
  return createC1ObservedReadTrace({
    observationId: 'duplicate-test',
    prompt: 'synthetic probe',
    fixtureFiles: files
  })
}

describe('experimental duplicate-read policy', () => {
  it('excludes only the older matching call/result pair, retaining immutable input', () => {
    const input = observation()
    const original = JSON.stringify(input)
    const output = applyC1DuplicateReadPolicy(input, new Set(input.currentTargetSourceKeys))
    expect(output.excludedSourceKeys).toHaveLength(2)
    expect(output.excludedSourceKeys.every((key) => key.endsWith('-1'))).toBe(true)
    expect(output.sourceLifecycleSignals?.map((signal) => signal.kind)).toEqual([
      'SUPERSEDED',
      'SUPERSEDED'
    ])
    expect(
      output.currentTargetSourceKeys.every((key) => !output.excludedSourceKeys.includes(key))
    ).toBe(true)
    expect(output.messages).toBe(input.messages)
    expect(JSON.stringify(input)).toBe(original)
  })

  it('does not exclude duplicates that have never been committed', () => {
    const input = observation()
    expect(applyC1DuplicateReadPolicy(input)).toBe(input)
  })

  it.each([
    'different-path',
    'changed-content',
    'error',
    'mixed-assistant',
    'opaque-result',
    'extra-argument',
    'protected',
    'duplicate-id'
  ])('keeps %s observations without inventing a duplicate signal', (variant) => {
    let input = observation(
      variant === 'different-path' ? ['README.md', 'src/target.js'] : undefined
    )
    const messages = input.messages.map((message) => ({ ...message }))
    if (variant === 'changed-content')
      messages[4]!.content = [{ type: 'text', text: 'new version' }]
    if (variant === 'error') messages[4]!.isError = true
    if (variant === 'mixed-assistant')
      messages[3]!.content = [
        ...(messages[3]!.content as unknown[]),
        { type: 'thinking', thinking: 'opaque reasoning' }
      ]
    if (variant === 'opaque-result') messages[4]!.content = [{ type: 'image', data: 'opaque' }]
    if (variant === 'extra-argument')
      messages[3]!.content = [
        {
          ...(messages[3]!.content as Record<string, unknown>[])[0],
          arguments: { path: 'README.md', limit: 10 }
        }
      ]
    if (variant === 'duplicate-id') messages.push(messages[4]!)
    input = {
      ...input,
      messages,
      ...(variant === 'protected'
        ? { latestVerificationSourceKeys: [input.currentTargetSourceKeys[0]!] }
        : {})
    }
    expect(applyC1DuplicateReadPolicy(input, new Set(input.currentTargetSourceKeys))).toBe(input)
  })

  it('demonstrates matched-input baseline retention and candidate removal through formal factories', async () => {
    const result = await runC1InterventionProbe(resolve(import.meta.dirname, '../../..'))
    expect(result.status).toBe('PASS')
    expect(result.providerCalls).toBe(0)
    expect(result.variants.map((variant) => variant.changedCalls)).toEqual([[], [2, 3]])
    expect(result.variants.every((variant) => variant.inputMessageFingerprintsEqual)).toBe(true)
    expect(result.existingLifecycleReadiness).toBe('PASS')
  }, 30000)
})
