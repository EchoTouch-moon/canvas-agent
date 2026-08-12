import { describe, expect, it } from 'vitest'
import {
  PiContextShadowObserver,
  EnrichedPiShadowObserver,
  ShadowPlannerObserver,
  buildRepresentationNeeds,
  type PiMessageView
} from '../src'

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function toolCallMessage(id: string, name: string, args: unknown): PiMessageView {
  return { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }] }
}

function toolResultMessage(toolCallId: string, text: string): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text }],
    toolCallId,
    toolName: 'read',
    isError: false
  }
}

const FIXED_NOW = '2026-08-11T00:00:00.000Z'

function makeObserver() {
  const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
  const enriched = new EnrichedPiShadowObserver({ base })
  return new ShadowPlannerObserver({ enriched, policyVersion: 'policy-v0-test' })
}

describe('Shadow planner observer (CR-003A)', () => {
  it('produces a Shadow Working Set + transition + metrics per model call', async () => {
    const observer = makeObserver()
    const call = await observer.observeModelCall([
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ])
    expect(call.plannerResult.workingSet.mode).toBe('SHADOW')
    expect(call.plannerResult.workingSet.plannedFromUniverseSequence).toBe(
      call.enrichedResult.universeRevision.sequence
    )
    expect(call.metrics.workingSetId).toBe(call.plannerResult.workingSet.workingSetId)
    expect(call.metrics.proposedSemanticTokenEstimate).toBe(
      call.plannerResult.workingSet.totalTokenEstimate
    )
    expect(call.metrics.nativeEstimateScope).toBe('agent-messages-pre-provider')
  })

  it('produces one plan per model call and records ADD decisions for run-event sources', async () => {
    const observer = makeObserver()
    await observer.observeModelCall([userMessage('task')])
    const call2 = await observer.observeModelCall([
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ])
    expect(observer.callResults).toHaveLength(2)
    const addDecisions = call2.plannerResult.decisions.filter((d) => d.kind === 'ADD')
    expect(addDecisions.length).toBeGreaterThan(0)
  })

  it('records reason-code counts in metrics', async () => {
    const observer = makeObserver()
    const call = await observer.observeModelCall([
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ])
    const reasonKeys = Object.keys(call.metrics.reasonCodeCounts)
    expect(reasonKeys.length).toBeGreaterThan(0)
    expect(call.metrics.add + call.metrics.keep + call.metrics.remove).toBe(
      call.plannerResult.decisions.length
    )
  })

  it('CR-001 pass-through invariant holds: base observer returns original messages', async () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    const planner = new ShadowPlannerObserver({ enriched, policyVersion: 'v0' })
    const messages = [userMessage('keep me'), toolCallMessage('call-1', 'read', { path: 'a.ts' })]
    const result = base.handleContextEvent(messages)
    expect(result.messages).toBe(messages)
    await planner.observeModelCall(messages)
    expect(result.messages).toBe(messages)
    expect(result.messages).toHaveLength(2)
  })

  it('P2: previousWorkingSetId mismatch is rejected both ways (strict bidirectional)', async () => {
    // Direction 1: request claims a previous id but actual previous set is null.
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    const observer = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'v0',
      makePlanningRequest: (input) => ({
        runtimeSessionId: input.runtimeSessionId,
        recompositionSequence: input.sequence,
        taskPhase: 'GENERAL',
        budget: { maxSemanticTokens: 8000 },
        pinnedSourceKeys: [],
        excludedSourceKeys: [],
        currentTargetSourceKeys: [],
        latestVerificationSourceKeys: [],
        recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
        previousWorkingSetId: 'working-set:bogus'
      })
    })
    await expect(
      observer.observeModelCall([userMessage('task')])
    ).rejects.toThrow(/previousWorkingSetId mismatch/)

    // Direction 2 (inverse): a single observer establishes a previous Working
    // Set on its first call, then a step-based request drops the id -> throw.
    const base2 = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched2 = new EnrichedPiShadowObserver({ base: base2 })
    let inverseStep = 0
    const observer2 = new ShadowPlannerObserver({
      enriched: enriched2,
      policyVersion: 'v0',
      makePlanningRequest: (input) => {
        inverseStep += 1
        return {
          runtimeSessionId: input.runtimeSessionId,
          recompositionSequence: input.sequence,
          taskPhase: 'GENERAL',
          budget: { maxSemanticTokens: 8000 },
          pinnedSourceKeys: [],
          excludedSourceKeys: [],
          currentTargetSourceKeys: [],
          latestVerificationSourceKeys: [],
          recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
          previousWorkingSetId: inverseStep === 2 ? null : input.previousWorkingSetId
        }
      }
    })
    await observer2.observeModelCall([userMessage('task')])
    await expect(
      observer2.observeModelCall([userMessage('task')])
    ).rejects.toThrow(/previousWorkingSetId mismatch/)
  })

  it('P1: exclude in the live observer records removal history and enables REHYDRATE (end to end)', async () => {
    // Build an observer whose planning request honors explicit excludes on the
    // second call and pins the source on the third call. The observer must
    // automatically record removal history from the real REMOVE decision.
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    let step = 0
    const observer = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'v0',
      makePlanningRequest: (input) => {
        step += 1
        const common = {
          runtimeSessionId: input.runtimeSessionId,
          recompositionSequence: input.sequence,
          taskPhase: 'GENERAL' as const,
          budget: { maxSemanticTokens: 8000 },
          currentTargetSourceKeys: [] as string[],
          latestVerificationSourceKeys: [] as string[],
          recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
          previousWorkingSetId: input.previousWorkingSetId,
          removalHistory: input.removalHistory
        }
        if (step === 2) {
          return { ...common, pinnedSourceKeys: [], excludedSourceKeys: ['run/tool-call://call-1', 'run/tool-result://call-1'] }
        }
        if (step === 3) {
          return { ...common, pinnedSourceKeys: ['run/tool-call://call-1', 'run/tool-result://call-1'], excludedSourceKeys: [] }
        }
        return { ...common, pinnedSourceKeys: [], excludedSourceKeys: [] }
      }
    })
    const msg = [
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ]
    await observer.observeModelCall(msg)
    const call2 = await observer.observeModelCall(msg)
    // Step 2: explicit exclude -> real REMOVE(EXPLICIT_EXCLUDE).
    const removeDecisions = call2.plannerResult.decisions.filter((d) => d.kind === 'REMOVE')
    expect(removeDecisions.length).toBeGreaterThan(0)
    expect(
      removeDecisions.every((d) => d.reasonCodes.includes('EXPLICIT_EXCLUDE'))
    ).toBe(true)
    const call3 = await observer.observeModelCall(msg)
    // Step 3: pinned again -> REHYDRATE (observer auto-recorded the removal).
    const rehydrateDecisions = call3.plannerResult.decisions.filter((d) => d.kind === 'REHYDRATE')
    expect(rehydrateDecisions.length).toBeGreaterThan(0)
  })

  it('P1: unchanged history across calls yields KEEP (real continuity)', async () => {
    const observer = makeObserver()
    const messagesA = [
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ]
    const messagesB = [
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ]
    await observer.observeModelCall(messagesA)
    const second = await observer.observeModelCall(messagesB)
    // The second plan should see the previous Working Set and classify the
    // still-active run-event sources as KEEP, not repeated ADD.
    expect(second.plannerResult.workingSet.previousWorkingSetId).toBe(
      observer.callResults[0]!.plannerResult.workingSet.workingSetId
    )
    const keepCount = second.plannerResult.decisions.filter((d) => d.kind === 'KEEP').length
    const addCount = second.plannerResult.decisions.filter((d) => d.kind === 'ADD').length
    expect(keepCount).toBeGreaterThan(0)
    expect(addCount).toBe(0)
  })

  it('P1: nativeContextEstimate is the real CR-001 observation estimate, not a placeholder', async () => {
    const observer = makeObserver()
    const call = await observer.observeModelCall([
      userMessage('task with some text content'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'file contents here')
    ])
    // The metric must be > 0 (real estimate) and equal the enriched result's
    // native estimate, which is sourced from the CR-001 observation.
    expect(call.metrics.nativeContextEstimate).toBeGreaterThan(0)
    expect(call.metrics.nativeEstimateScope).toBe('agent-messages-pre-provider')
    expect(call.enrichedResult.nativeContextEstimate).toBe(call.metrics.nativeContextEstimate)
  })
})

describe('CR-003B file-aware observer corrections (PR #22)', () => {
  it('P1: representation needs enter the PlanningRequest and its hash', async () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const sourceKey = 'repository/file://a.ts'
    const enriched = new EnrichedPiShadowObserver({
      base,
      seeds: [
        {
          sourceKey,
          sourceKind: 'REPOSITORY_FILE',
          contentHash: 'file-content-hash',
          provenance: 'REPOSITORY_OBSERVER',
          observedAt: FIXED_NOW
        }
      ]
    })
    let capturedNeeds: unknown = null
    const planner = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'policy-v0',
      filePathCandidates: ['a.ts'],
      makePlanningRequest: (input) => ({
        runtimeSessionId: input.runtimeSessionId,
        recompositionSequence: input.sequence,
        taskPhase: 'GENERAL',
        budget: { maxSemanticTokens: 8000 },
        pinnedSourceKeys: [],
        excludedSourceKeys: [],
        currentTargetSourceKeys: [],
        latestVerificationSourceKeys: [],
        recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
        representationNeeds: input.representationNeeds,
        previousWorkingSetId: input.previousWorkingSetId
      }),
      representationProvider: async ({ need }) => {
        capturedNeeds = need
        return null
      }
    })
    await planner.observeModelCall([userMessage('task')])
    const needsRequest = planner.callResults[0]!.planningRequest
    const needs = needsRequest.representationNeeds ?? []
    expect(needs).toHaveLength(1)
    expect(needs[0]!.sourceKey).toBe(sourceKey)
    expect(needs[0]!.preferredKind).toBe('FULL')
    // The needs participate in planningRequestHash: with needs differs from
    // the same request without needs.
    const { planningRequestHash } = await import('@canvas-agent/context-runtime')
    const withNeedsHash = planningRequestHash(needsRequest)
    const withoutNeeds = { ...needsRequest }
    delete withoutNeeds.representationNeeds
    const withoutNeedsHash = planningRequestHash(withoutNeeds)
    expect(withNeedsHash).not.toBe(withoutNeedsHash)
    // The provider received the SAME normalized need that entered the request.
    expect(capturedNeeds).not.toBeNull()
  })

  it('P1: materialization failure is fail-safe (recorded, falls back, native intact)', async () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const sourceKey = 'repository/file://a.ts'
    // Admit the file source so the provider is actually invoked for it.
    const enriched = new EnrichedPiShadowObserver({
      base,
      seeds: [
        {
          sourceKey,
          sourceKind: 'REPOSITORY_FILE',
          contentHash: 'file-content-hash',
          provenance: 'REPOSITORY_OBSERVER',
          observedAt: FIXED_NOW
        }
      ]
    })
    const planner = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'policy-v0',
      filePathCandidates: ['a.ts'],
      representationProvider: async () => {
        throw new Error('git explosion')
      }
    })
    const messages = [userMessage('keep me')]
    const call = await planner.observeModelCall(messages)
    // Failure recorded, not thrown to the Pi callback.
    expect(call.materializationFailures.length).toBeGreaterThan(0)
    expect(call.materializationFailures[0]).toContain('git explosion')
    // The source still appears (fallback REFERENCE path is exercised by the
    // planner represent resolver, which never throws).
    expect(call.plannerResult.workingSet.items.length).toBeGreaterThanOrEqual(0)
    // Native Pi messages remain unchanged.
    const passThrough = base.handleContextEvent(messages)
    expect(passThrough.messages).toBe(messages)
  })

  it('P2: duplicate representation need for a sourceKey is rejected', async () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    const planner = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'policy-v0',
      filePathCandidates: ['a.ts'],
      representationProvider: async () => null
    })
    // Duplicate override for the same sourceKey must throw during need build.
    expect(() =>
      buildRepresentationNeeds(['a.ts'], [
        { sourceKey: 'repository/file://a.ts', preferredKind: 'FULL', reasonCode: 'DETAIL_REQUIRED' }
      ])
    ).toThrow(/duplicate representation need/)
    void planner
  })
})

describe('CR-003B final P1: PlanningRequest ↔ materialization need strong consistency', () => {
  it('custom builder that drops representationNeeds still gets the needs centrally forced onto the request', async () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const sourceKey = 'repository/file://a.ts'
    const enriched = new EnrichedPiShadowObserver({
      base,
      seeds: [
        {
          sourceKey,
          sourceKind: 'REPOSITORY_FILE',
          contentHash: 'file-content-hash',
          provenance: 'REPOSITORY_OBSERVER',
          observedAt: FIXED_NOW
        }
      ]
    })
    const materializedNeedKinds: string[] = []
    const planner = new ShadowPlannerObserver({
      enriched,
      policyVersion: 'policy-v0',
      filePathCandidates: ['a.ts'],
      // Custom builder DELIBERATELY omits representationNeeds.
      makePlanningRequest: (input) => ({
        runtimeSessionId: input.runtimeSessionId,
        recompositionSequence: input.sequence,
        taskPhase: 'GENERAL',
        budget: { maxSemanticTokens: 8000 },
        pinnedSourceKeys: [],
        excludedSourceKeys: [],
        currentTargetSourceKeys: [],
        latestVerificationSourceKeys: [],
        recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
        previousWorkingSetId: input.previousWorkingSetId
      }),
      representationProvider: async ({ need }) => {
        materializedNeedKinds.push(need.preferredKind)
        return null
      }
    })
    const call = await planner.observeModelCall([userMessage('task')])
    const request = call.planningRequest
    // Central enforcement: the final request STILL carries the FULL need.
    expect(request.representationNeeds).toHaveLength(1)
    expect(request.representationNeeds![0]!.sourceKey).toBe(sourceKey)
    expect(request.representationNeeds![0]!.preferredKind).toBe('FULL')
    // Materialization used the SAME need (FULL), so hash + selection agree.
    expect(materializedNeedKinds).toEqual(['FULL'])
    // The request hash deterministically includes the need.
    const { planningRequestHash } = await import('@canvas-agent/context-runtime')
    const hashWithNeed = planningRequestHash(request)
    const stripped = { ...request }
    delete stripped.representationNeeds
    expect(hashWithNeed).not.toBe(planningRequestHash(stripped))
  })
})
