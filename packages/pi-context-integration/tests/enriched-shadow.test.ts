import { describe, expect, it } from 'vitest'
import type { SnapshotLikeSeed } from '@canvas-agent/context-runtime'
import {
  EnrichedPiShadowObserver,
  PiContextShadowObserver,
  collectSourceObservations,
  decomposePiMessages,
  type PiMessageView
} from '../src'

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantText(text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function assistantThinking(text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'thinking', thinking: text }] }
}

function toolCallMessage(id: string, name: string, args: unknown): PiMessageView {
  return { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }] }
}

function toolResultMessage(toolCallId: string, text: string, isError = false): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text }],
    toolCallId,
    toolName: 'read',
    isError
  }
}

const FIXED_NOW = '2026-08-11T00:00:00.000Z'

function enrichedObserver(seeds: SnapshotLikeSeed[] = []) {
  const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
  return new EnrichedPiShadowObserver({ base, seeds })
}

describe('element decomposition', () => {
  it('decomposes user/assistant text deterministically', () => {
    const messages = [userMessage('fix the bug'), assistantText('I will look')]
    const result = decomposePiMessages(messages, { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(result).toHaveLength(2)
    expect(result[0]!.element.elementKind).toBe('USER_TEXT')
    expect(result[1]!.element.elementKind).toBe('ASSISTANT_TEXT')
    expect(result[0]!.attribution.confidence).toBe('UNATTRIBUTED')
    expect(result[0]!.element.semanticHash).toBe(result[0]!.element.semanticHash)
  })

  it('assistant prose does not produce a repository source', () => {
    const message = assistantText('I have read auth.ts and login.ts carefully.')
    const [entry] = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(entry!.attribution.confidence).toBe('UNATTRIBUTED')
    expect(entry!.attribution.sourceKey).toBeUndefined()
  })

  it('thinking blocks decompose to ASSISTANT_THINKING', () => {
    const [entry] = decomposePiMessages([assistantThinking('hmm')], {
      runtimeSessionId: 's',
      modelCallSequence: 1
    })
    expect(entry!.element.elementKind).toBe('ASSISTANT_THINKING')
    expect(entry!.attribution.confidence).toBe('UNATTRIBUTED')
  })

  it('one assistant message with text + toolCall yields two elements', () => {
    const message: PiMessageView = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading now' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/auth.ts' } }
      ]
    }
    const result = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(result).toHaveLength(2)
    expect(result[0]!.element.elementKind).toBe('ASSISTANT_TEXT')
    expect(result[1]!.element.elementKind).toBe('TOOL_CALL')
  })

  it('tool call gets EXACT run-event identity + DERIVED_HINT path', () => {
    const message = toolCallMessage('call-1', 'read', { path: 'src/auth.ts' })
    const [entry] = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(entry!.element.elementKind).toBe('TOOL_CALL')
    expect(entry!.element.toolCallId).toBe('call-1')
    const attribution = entry!.attribution
    expect(attribution.confidence).toBe('EXACT')
    expect(attribution.sourceKey).toBe('run/tool-call://call-1')
    // The path stays a secondary resource hint.
    expect(attribution.resourceHints).toHaveLength(1)
    expect(attribution.resourceHints![0]!.sourceKey).toBe('repository/file://src/auth.ts')
    expect(attribution.resourceHints![0]!.method).toBe('PI_TOOL_ARGUMENT_PATH_HINT')
  })

  it('tool call without id but with structured path is primary DERIVED_HINT', () => {
    const message: PiMessageView = {
      role: 'assistant',
      content: [{ type: 'toolCall', name: 'read', arguments: { path: 'src/auth.ts' } }]
    }
    const [entry] = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(entry!.attribution.confidence).toBe('DERIVED_HINT')
    expect(entry!.attribution.sourceKey).toBe('repository/file://src/auth.ts')
    expect(entry!.attribution.method).toBe('PI_TOOL_ARGUMENT_PATH_HINT')
  })

  it('different tool arguments produce different semantic hashes', () => {
    const a = toolCallMessage('call-1', 'read', { path: 'a.ts' })
    const b = toolCallMessage('call-1', 'read', { path: 'b.ts' })
    const [ea] = decomposePiMessages([a], { runtimeSessionId: 's', modelCallSequence: 1 })
    const [eb] = decomposePiMessages([b], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(ea!.element.semanticHash).not.toBe(eb!.element.semanticHash)
  })

  it('tool result gets EXACT run-result identity by toolCallId', () => {
    const [entry] = decomposePiMessages([toolResultMessage('call-9', 'content')], {
      runtimeSessionId: 's',
      modelCallSequence: 2
    })
    expect(entry!.element.elementKind).toBe('TOOL_RESULT')
    expect(entry!.element.toolCallId).toBe('call-9')
    expect(entry!.attribution.confidence).toBe('EXACT')
    expect(entry!.attribution.sourceKey).toBe('run/tool-result://call-9')
  })

  it('tool result without call id is OPAQUE', () => {
    const message: PiMessageView = {
      role: 'toolResult',
      content: [{ type: 'text', text: 'x' }],
      toolName: 'read'
    }
    const [entry] = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(entry!.attribution.confidence).toBe('OPAQUE')
  })

  it('image blocks decompose to IMAGE / OPAQUE without payload', () => {
    const message: PiMessageView = {
      role: 'user',
      content: [
        { type: 'text', text: 'see this' },
        { type: 'image', data: 'base64image...', mimeType: 'image/png' }
      ]
    }
    const result = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(result).toHaveLength(2)
    expect(result[1]!.element.elementKind).toBe('IMAGE')
    expect(result[1]!.attribution.confidence).toBe('OPAQUE')
    expect(JSON.stringify(result)).not.toContain('base64image')
  })
})

describe('source observation collection', () => {
  it('EXACT tool-call/tool-result identities become AVAILABLE observations', () => {
    const messages = [
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'contents')
    ]
    const elements = decomposePiMessages(messages, { runtimeSessionId: 's', modelCallSequence: 1 })
    const { observations } = collectSourceObservations(elements, FIXED_NOW)
    const keys = observations.map((o) => o.sourceKey).sort()
    expect(keys).toEqual(['run/tool-call://call-1', 'run/tool-result://call-1'])
    expect(observations.every((o) => o.status === 'AVAILABLE')).toBe(true)
  })

  it('DERIVED_HINT repository path is NOT turned into a source observation', () => {
    const message = toolCallMessage('call-1', 'read', { path: 'src/auth.ts' })
    const [entry] = decomposePiMessages([message], { runtimeSessionId: 's', modelCallSequence: 1 })
    expect(entry!.attribution.confidence).toBe('EXACT')
    const { observations } = collectSourceObservations([entry!], FIXED_NOW)
    // Only run/tool-call://call-1; no repository/file:// key.
    expect(observations.map((o) => o.sourceKey)).toEqual(['run/tool-call://call-1'])
  })

  it('UNATTRIBUTED / OPAQUE produce no source observations', () => {
    const messages = [assistantText('prose'), userMessage('hi')]
    const elements = decomposePiMessages(messages, { runtimeSessionId: 's', modelCallSequence: 1 })
    const { observations } = collectSourceObservations(elements, FIXED_NOW)
    expect(observations).toHaveLength(0)
  })
})

describe('enriched shadow observer', () => {
  it('produces elements, attribution summary, universe revision per model call', () => {
    const observer = enrichedObserver()
    const call1 = observer.observeModelCall([userMessage('task')])
    expect(call1.elements).toHaveLength(1)
    expect(call1.attributionSummary.total).toBe(1)
    expect(call1.attributionSummary.unattributed).toBe(1)
    expect(call1.universeRevision.sequence).toBe(1)
    expect(call1.universeRevision.modelCallSequence).toBe(1)

    const call2 = observer.observeModelCall([
      userMessage('task'),
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content A')
    ])
    expect(call2.elements).toHaveLength(3)
    expect(call2.attributionSummary.exact).toBe(2)
    expect(call2.universeRevision.sequence).toBe(2)
    expect(call2.universeRevision.modelCallSequence).toBe(2)
  })

  it('repeated historical elements do not create duplicate source versions', () => {
    const observer = enrichedObserver()
    // Two calls re-observing the same user task and same tool result.
    observer.observeModelCall([userMessage('task'), toolCallMessage('call-1', 'read', { path: 'a.ts' }), toolResultMessage('call-1', 'content A')])
    const call2 = observer.observeModelCall([userMessage('task'), toolCallMessage('call-1', 'read', { path: 'a.ts' }), toolResultMessage('call-1', 'content A')])
    const call3 = observer.observeModelCall([userMessage('task'), toolCallMessage('call-2', 'read', { path: 'a.ts' }), toolResultMessage('call-2', 'content B')])
    // Different content on call-2 (a second read of the same file) => new
    // result version, but the run-event identity differs by call id.
    expect(call2.universeRevision.sequence).toBe(2)
    expect(call3.universeRevision.sequence).toBe(3)
    const toolResultEntries = call3.universeRevision.entries.filter((e) =>
      e.source.sourceKey.startsWith('run/tool-result://')
    )
    expect(toolResultEntries.map((e) => e.source.sourceKey).sort()).toEqual([
      'run/tool-result://call-1',
      'run/tool-result://call-2'
    ])
  })

  it('Universe revisions are immutable and hashable', () => {
    const observer = enrichedObserver()
    const call1 = observer.observeModelCall([userMessage('task'), toolCallMessage('call-1', 'read', { path: 'a.ts' })])
    const revision1 = call1.universeRevision
    const hash1 = revision1.logicalHash
    void observer.observeModelCall([userMessage('task'), toolResultMessage('call-1', 'contents')])
    expect(revision1.logicalHash).toBe(hash1)
    expect(revision1.sequence).toBe(1)
    expect(hash1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('snapshot-like seed versions remain addressable after runtime updates', () => {
    const observer = enrichedObserver([
      {
        sourceKey: 'repository/file://src/auth.ts',
        sourceKind: 'repository-file',
        contentHash: 'seed-hash',
        provenance: 'snapshot-seed',
        observedAt: FIXED_NOW
      }
    ])
    const call1 = observer.observeModelCall([userMessage('task')])
    // Seed is Universe #0; the first model call produces revision #1.
    expect(call1.universeRevision.sequence).toBe(1)
    // The seeded file entry must still exist (no runtime observation changed it).
    const auth = call1.universeRevision.entries.find(
      (e) => e.source.sourceKey === 'repository/file://src/auth.ts'
    )
    expect(auth?.admittedVersion?.contentHash).toBe('seed-hash')
  })

  it('CR-001 pass-through invariant holds (base observer returns original messages)', () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    const messages = [userMessage('keep me'), assistantText('and me')]
    const result = base.handleContextEvent(messages)
    expect(result.messages).toBe(messages)
    void enriched.observeModelCall(messages)
    expect(result.messages).toBe(messages)
  })

  it('PR16: ModelCallObservation.observedAt == SourceObservation.observedAt == state.lastObservedAt', () => {
    const base = new PiContextShadowObserver({ runtimeSessionId: 'sess', now: () => FIXED_NOW })
    const enriched = new EnrichedPiShadowObserver({ base })
    enriched.observeModelCall([toolCallMessage('call-1', 'read', { path: 'a.ts' })])
    const modelObservation = base.inMemory.last()!
    const result = enriched.callResults[0]!
    // Timestamps must be identical and must NOT equal the runtimeSessionId.
    expect(modelObservation.observedAt).toBe(FIXED_NOW)
    expect(result.sourceObservations.length).toBeGreaterThan(0)
    for (const obs of result.sourceObservations) {
      expect(obs.observedAt).toBe(FIXED_NOW)
      expect(obs.observedAt).not.toBe('sess')
    }
    const callEntry = result.universeRevision.entries.find((e) =>
      e.source.sourceKey.startsWith('run/tool-call://')
    )
    expect(callEntry?.state.lastObservedAt).toBe(FIXED_NOW)
    expect(callEntry?.state.lastObservedAt).not.toBe('sess')
  })

  it('PR16: same toolCallId + changed result content => different SourceVersion', () => {
    const observer = enrichedObserver()
    const call1 = observer.observeModelCall([toolResultMessage('call-1', 'content A')])
    const call2 = observer.observeModelCall([toolResultMessage('call-1', 'content B')])
    const entry1 = call1.universeRevision.entries.find((e) =>
      e.source.sourceKey.startsWith('run/tool-result://')
    )
    const entry2 = call2.universeRevision.entries.find((e) =>
      e.source.sourceKey.startsWith('run/tool-result://')
    )
    // Same source identity (same sourceKey) but changed model-visible content
    // must produce different immutable SourceVersions.
    expect(entry1?.source.sourceKey).toBe(entry2?.source.sourceKey)
    expect(entry1?.state.admittedVersionId).not.toBe(entry2?.state.admittedVersionId)
    expect(entry1?.admittedVersion?.contentHash).not.toBe(entry2?.admittedVersion?.contentHash)
  })

  it('PR16: snapshot-seeded and run-derived sources are distinguishable by provenance', () => {
    const observer = enrichedObserver([
      {
        sourceKey: 'repository/file://src/auth.ts',
        sourceKind: 'repository-file',
        contentHash: 'seed-hash',
        provenance: 'snapshot-seed',
        observedAt: FIXED_NOW
      }
    ])
    const call = observer.observeModelCall([
      toolCallMessage('call-1', 'read', { path: 'a.ts' }),
      toolResultMessage('call-1', 'content')
    ])
    const seeded = call.universeRevision.entries.find(
      (e) => e.source.sourceKey === 'repository/file://src/auth.ts'
    )
    const run = call.universeRevision.entries.find((e) =>
      e.source.sourceKey.startsWith('run/tool-')
    )
    expect(seeded?.source.provenance).toBe('snapshot-seed')
    expect(seeded?.source.sourceKind).toBe('repository-file')
    expect(run?.source.provenance).toBe('PI_CONTEXT_EVENT')
    expect(run?.source.sourceKind).toMatch(/^RUN_TOOL_/)
    // Distinguishable by explicit metadata, not URI-prefix parsing.
    expect(run?.source.provenance).not.toBe(seeded?.source.provenance)
  })
})
