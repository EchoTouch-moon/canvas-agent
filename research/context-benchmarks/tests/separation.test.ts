import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  ShadowPlannerObserver,
  createShadowPlannerPiExtension
} from '@canvas-agent/pi-context-integration'
import { buildShadowFilePathCandidates } from '../src/live-runner'
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

  it('keeps evaluator annotations out of Shadow planner inputs', async () => {
    const manifest = (await loadManifests(researchRoot)).find((entry) => entry.category === 'C5-unrelated-discovery')
    if (manifest === undefined) throw new Error('missing C5 benchmark manifest')
    const observedFilePaths = ['src/candidate-d.js', 'src/session-expiry.js']
    const annotationVariants = [
      {
        knownCandidatePaths: manifest.knownCandidatePaths,
        knownRelevantPaths: manifest.knownRelevantPaths,
        knownIrrelevantPaths: manifest.knownIrrelevantPaths
      },
      {
        knownCandidatePaths: ['src/evaluator-answer.js'],
        knownRelevantPaths: ['src/evaluator-answer.js'],
        knownIrrelevantPaths: ['src/candidate-d.js']
      }
    ]
    const candidatePaths = annotationVariants.map((evaluatorAnnotations) =>
      buildShadowFilePathCandidates({ observedFilePaths, evaluatorAnnotations })
    )

    const createPlanner = (filePathCandidates: readonly string[]) => {
      const base = new PiContextShadowObserver({ runtimeSessionId: 'cr005-annotation-invariance' })
      const enriched = new EnrichedPiShadowObserver({ base })
      enriched.queueExternalSeeds([{
        sourceKey: 'repository/file://src/session-expiry.js',
        sourceKind: 'REPOSITORY_FILE',
        provenance: 'REPOSITORY_OBSERVER',
        contentHash: 'a'.repeat(64),
        observedAt: '2026-01-01T00:00:00.000Z'
      }])
      return new ShadowPlannerObserver({
        enriched,
        filePathCandidates
      })
    }
    const firstCandidates = candidatePaths[0]
    const secondCandidates = candidatePaths[1]
    if (firstCandidates === undefined || secondCandidates === undefined) {
      throw new Error('missing annotation-invariance candidate paths')
    }
    const first = await createPlanner(firstCandidates).observeModelCall([])
    const second = await createPlanner(secondCandidates).observeModelCall([])

    expect(candidatePaths[1]).toEqual(candidatePaths[0])
    expect(JSON.stringify(firstCandidates)).not.toContain('evaluator-answer')
    expect(second.planningRequest).toEqual(first.planningRequest)
    expect(second.plannerResult.workingSet.logicalHash).toBe(first.plannerResult.workingSet.logicalHash)
    expect(second.plannerResult.transition.logicalHash).toBe(first.plannerResult.transition.logicalHash)
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
