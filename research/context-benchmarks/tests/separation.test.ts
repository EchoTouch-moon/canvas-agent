import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  ShadowPlannerObserver,
  createShadowPlannerPiExtension
} from '@canvas-agent/pi-context-integration'
import type { ContextEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
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

  it('runs the real Shadow extension and returns the exact original messages array', async () => {
    const messages: ContextEvent['messages'] = []
    const base = new PiContextShadowObserver({ runtimeSessionId: 'cr005-shadow-pass-through' })
    const enriched = new EnrichedPiShadowObserver({ base })
    const observer = new ShadowPlannerObserver({ enriched })
    const extension = createShadowPlannerPiExtension({ observer })
    let contextHandler: ((event: ContextEvent, context: unknown) => Promise<{ messages: ContextEvent['messages'] }>) | undefined
    const register = extension as unknown as (api: Pick<ExtensionAPI, 'on'>) => void
    register({
      on: (_event, handler) => {
        contextHandler = handler as unknown as (event: ContextEvent, context: unknown) => Promise<{ messages: ContextEvent['messages'] }>
      }
    })
    if (contextHandler === undefined) throw new Error('Shadow extension did not register a context handler')

    const result = await contextHandler({ type: 'context', messages }, {})
    expect(result.messages).toBe(messages)
    expect(observer.callResults).toHaveLength(1)
  })
})
