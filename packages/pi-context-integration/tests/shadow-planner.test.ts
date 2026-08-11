import { describe, expect, it } from 'vitest'
import {
  PiContextShadowObserver,
  EnrichedPiShadowObserver,
  ShadowPlannerObserver,
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
  it('produces a Shadow Working Set + transition + metrics per model call', () => {
    const observer = makeObserver()
    const call = observer.observeModelCall([
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

  it('produces one plan per model call and records ADD decisions for run-event sources', () => {
    const observer = makeObserver()
    observer.observeModelCall([userMessage('task')])
    const call2 = observer.observeModelCall([
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ])
    expect(observer.callResults).toHaveLength(2)
    const addDecisions = call2.plannerResult.decisions.filter((d) => d.kind === 'ADD')
    expect(addDecisions.length).toBeGreaterThan(0)
  })

  it('records reason-code counts in metrics', () => {
    const observer = makeObserver()
    const call = observer.observeModelCall([
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

  it('CR-001 pass-through invariant holds: base observer returns original messages', () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    const planner = new ShadowPlannerObserver({ enriched, policyVersion: 'v0' })
    const messages = [userMessage('keep me'), toolCallMessage('call-1', 'read', { path: 'a.ts' })]
    const result = base.handleContextEvent(messages)
    expect(result.messages).toBe(messages)
    void planner.observeModelCall(messages)
    expect(result.messages).toBe(messages)
    expect(result.messages).toHaveLength(2)
  })

  it('P2: previousWorkingSetId mismatch is rejected both ways (strict bidirectional)', () => {
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
    expect(() =>
      observer.observeModelCall([userMessage('task')])
    ).toThrow(/previousWorkingSetId mismatch/)

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
    observer2.observeModelCall([userMessage('task')])
    expect(() =>
      observer2.observeModelCall([userMessage('task')])
    ).toThrow(/previousWorkingSetId mismatch/)
  })

  it('P1: exclude in the live observer records removal history and enables REHYDRATE (end to end)', () => {
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
    observer.observeModelCall(msg)
    const call2 = observer.observeModelCall(msg)
    // Step 2: explicit exclude -> real REMOVE(EXPLICIT_EXCLUDE).
    const removeDecisions = call2.plannerResult.decisions.filter((d) => d.kind === 'REMOVE')
    expect(removeDecisions.length).toBeGreaterThan(0)
    expect(
      removeDecisions.every((d) => d.reasonCodes.includes('EXPLICIT_EXCLUDE'))
    ).toBe(true)
    const call3 = observer.observeModelCall(msg)
    // Step 3: pinned again -> REHYDRATE (observer auto-recorded the removal).
    const rehydrateDecisions = call3.plannerResult.decisions.filter((d) => d.kind === 'REHYDRATE')
    expect(rehydrateDecisions.length).toBeGreaterThan(0)
  })

  it('P1: unchanged history across calls yields KEEP (real continuity)', () => {
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
    observer.observeModelCall(messagesA)
    const second = observer.observeModelCall(messagesB)
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

  it('P1: nativeContextEstimate is the real CR-001 observation estimate, not a placeholder', () => {
    const observer = makeObserver()
    const call = observer.observeModelCall([
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
