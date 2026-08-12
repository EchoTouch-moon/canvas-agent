import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PiContextShadowObserver } from '@canvas-agent/pi-context-integration'
import { benchmarkManifestSchema, loadManifests } from '../src/manifest'

const researchRoot = resolve(import.meta.dirname, '..')

describe('CR-005 Native/Shadow separation', () => {
  it('returns the exact original Pi message array from the observation seam', () => {
    const messages = Object.freeze([
      Object.freeze({ role: 'user', content: 'Inspect the fixture and run the oracle.' })
    ])
    const observer = new PiContextShadowObserver({ runtimeSessionId: 'cr005-separation-test' })
    const result = observer.handleContextEvent(messages)

    expect(result.messages).toBe(messages)
    expect(observer.inMemory.observations).toHaveLength(1)
    expect(JSON.stringify(observer.inMemory.observations)).not.toContain('Inspect the fixture')
  })

  it('does not expose ACTIVE or DYNAMIC as benchmark context strategies', async () => {
    const manifest = (await loadManifests(researchRoot))[0]
    if (manifest === undefined) throw new Error('missing benchmark manifest')
    expect(() =>
      benchmarkManifestSchema.parse({ ...manifest, contextStrategies: ['ACTIVE', 'SHADOW'] })
    ).toThrow()
  })
})
