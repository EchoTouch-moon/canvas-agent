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
})
