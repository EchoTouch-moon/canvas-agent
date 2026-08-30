import { describe, expect, it } from 'vitest'
import {
  collectSourceObservations,
  decomposePiMessages,
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  type PiMessageView
} from '../src'

const FIXED_NOW = '2026-08-30T00:00:00.000Z'
const PATH = 'src/reopen-a.ts'
const CONTENT = 'export const value = "reopen-a:v3"'

function toolCall(callId: string, path = PATH): PiMessageView {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: callId, name: 'read', arguments: { path } }]
  }
}

function toolResult(callId: string, content = CONTENT): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text: content }],
    toolCallId: callId,
    toolName: 'read',
    isError: false
  }
}

function observer(runtimeSessionId: string): EnrichedPiShadowObserver {
  return new EnrichedPiShadowObserver({
    base: new PiContextShadowObserver({
      runtimeSessionId,
      now: () => FIXED_NOW
    })
  })
}

function resultEntry(
  revision: {
    readonly entries: readonly {
      readonly source: { readonly sourceKey: string }
      readonly admittedVersion?: { readonly contentHash: string } | null
    }[]
  },
  callId: string
) {
  return revision.entries.find((entry) => entry.source.sourceKey === `run/tool-result://${callId}`)
}

describe('LC1 Pi source-identity seam observation', () => {
  it('keeps a stable path hint while repeated reads remain distinct run-event sources', () => {
    const first = decomposePiMessages([toolCall('call-1'), toolResult('call-1')], {
      runtimeSessionId: 'session',
      modelCallSequence: 1
    })
    const second = decomposePiMessages([toolCall('call-2'), toolResult('call-2')], {
      runtimeSessionId: 'session',
      modelCallSequence: 2
    })

    const firstCall = first.find((entry) => entry.element.elementKind === 'TOOL_CALL')!
    const secondCall = second.find((entry) => entry.element.elementKind === 'TOOL_CALL')!
    const firstResult = first.find((entry) => entry.element.elementKind === 'TOOL_RESULT')!
    const secondResult = second.find((entry) => entry.element.elementKind === 'TOOL_RESULT')!

    expect(firstCall.attribution.resourceHints?.map((hint) => hint.sourceKey)).toEqual([
      `repository/file://${PATH}`
    ])
    expect(secondCall.attribution.resourceHints?.map((hint) => hint.sourceKey)).toEqual([
      `repository/file://${PATH}`
    ])
    expect(firstResult.attribution.sourceKey).toBe('run/tool-result://call-1')
    expect(secondResult.attribution.sourceKey).toBe('run/tool-result://call-2')

    const collected = collectSourceObservations([...first, ...second], FIXED_NOW)
    expect(collected.observations.map((observation) => observation.sourceKey)).toEqual([
      'run/tool-call://call-1',
      'run/tool-result://call-1',
      'run/tool-call://call-2',
      'run/tool-result://call-2'
    ])
    // The repository path is only a DERIVED_HINT. The current seam does not
    // emit a canonical logical source subject for later REMOVE/REHYDRATE.
    expect(
      collected.observations.some(
        (observation) => observation.sourceKey === `repository/file://${PATH}`
      )
    ).toBe(false)
  })

  it('binds the provisional result hash to the event id, even when path and content repeat', () => {
    const current = observer('session')
    const first = current.observeModelCall([toolCall('call-1'), toolResult('call-1')])
    const second = current.observeModelCall([toolCall('call-2'), toolResult('call-2')])

    const firstEntry = resultEntry(first.universeRevision, 'call-1')
    const secondEntry = resultEntry(second.universeRevision, 'call-2')
    expect(firstEntry?.source.sourceKey).toBe('run/tool-result://call-1')
    expect(secondEntry?.source.sourceKey).toBe('run/tool-result://call-2')
    expect(firstEntry?.admittedVersion?.contentHash).not.toBe(
      secondEntry?.admittedVersion?.contentHash
    )
    expect(firstEntry?.admittedVersion?.contentHash).toBeDefined()
    expect(secondEntry?.admittedVersion?.contentHash).toBeDefined()
  })

  it('does not scope the current run-event source key by runtime session', () => {
    const firstObserver = observer('session-a')
    const secondObserver = observer('session-b')
    const first = firstObserver.observeModelCall([toolResult('reused-call')])
    const second = secondObserver.observeModelCall([toolResult('reused-call')])

    const firstEntry = resultEntry(first.universeRevision, 'reused-call')
    const secondEntry = resultEntry(second.universeRevision, 'reused-call')
    expect(firstEntry?.source.sourceKey).toBe('run/tool-result://reused-call')
    expect(secondEntry?.source.sourceKey).toBe('run/tool-result://reused-call')
    expect(first.elements[0]?.element.observationRef).not.toBe(
      second.elements[0]?.element.observationRef
    )
  })
})
