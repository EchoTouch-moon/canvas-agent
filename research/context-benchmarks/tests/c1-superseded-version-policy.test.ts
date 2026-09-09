import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  applyC1SupersededVersionPolicy,
  C1_SUPERSEDED_VERSION_POLICY_ID,
  type C1LifecycleUnknown
} from '../src/c1-superseded-version-policy'
import type { C1AgentObservation } from '../src/c1-live-preflight'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const V1 = 'export const page = 1\n'
const V2 = 'export const page = 2\n'
const READ_ID = 'read-a-1'
const EDIT_ID = 'edit-a-1'
const READ_KEYS = [`run/tool-call://${READ_ID}`, `run/tool-result://${READ_ID}`]

function readPair(id: string, path: string, text: string): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id, name: 'read', arguments: { path } }]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text }],
      toolCallId: id,
      toolName: 'read',
      isError: false
    }
  ]
}

function editPair(id: string, path: string, isError = false): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id, name: 'edit', arguments: { path, oldText: 'a', newText: 'b' } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: isError ? 'failed' : `edited ${path}` }],
      toolCallId: id,
      toolName: 'edit',
      isError
    }
  ]
}

function observation(
  messages: PiMessageView[],
  extra: Partial<C1AgentObservation> = {}
): C1AgentObservation {
  const keys = messages.flatMap((message) => {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const block = message.content[0] as { type?: string; id?: string } | undefined
      if (block?.type === 'toolCall' && typeof block.id === 'string')
        return [`run/tool-call://${block.id}`]
    }
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string')
      return [`run/tool-result://${message.toolCallId}`]
    return []
  })
  return {
    observationId: 'sv-test',
    messages: Object.freeze(messages),
    taskPhase: 'INVESTIGATE',
    currentTargetSourceKeys: keys,
    excludedSourceKeys: [],
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys: [],
    previousWorkingSetId: null,
    ...extra
  }
}

const committed = (obs: C1AgentObservation) => new Set(obs.currentTargetSourceKeys)
const probeV2 = (path: string) => (path === 'src/a.js' ? sha256(V2) : undefined)

describe('SUPERSEDED_VERSION lifecycle policy', () => {
  it('evicts the stale read pair after a successful edit changed the version', () => {
    const input = observation([
      { role: 'user', content: [{ type: 'text', text: 'fix' }] },
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/a.js')
    ])
    const original = JSON.stringify(input)
    const output = applyC1SupersededVersionPolicy(input, committed(input), {
      versionProbe: probeV2
    })
    expect(output.excludedSourceKeys).toEqual(READ_KEYS)
    expect(output.currentTargetSourceKeys).toEqual([
      `run/tool-call://${EDIT_ID}`,
      `run/tool-result://${EDIT_ID}`
    ])
    expect(output.sourceLifecycleSignals?.map((s) => s.kind)).toEqual(['SUPERSEDED', 'SUPERSEDED'])
    expect(
      output.sourceLifecycleSignals?.every((s) =>
        s.evidenceRef?.startsWith('superseded-version-sha256:')
      )
    ).toBe(true)
    expect(output.messages).toBe(input.messages)
    expect(JSON.stringify(input)).toBe(original)
    expect(C1_SUPERSEDED_VERSION_POLICY_ID).toBe('C1_SUPERSEDED_VERSION_V1')
  })

  it('keeps the read pair when the edit happened before the read', () => {
    const input = observation([
      ...editPair(EDIT_ID, 'src/a.js'),
      ...readPair(READ_ID, 'src/a.js', V2)
    ])
    expect(applyC1SupersededVersionPolicy(input, committed(input), { versionProbe: probeV2 })).toBe(
      input
    )
  })

  it('keeps the read pair when the mutation failed', () => {
    const input = observation([
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/a.js', true)
    ])
    expect(applyC1SupersededVersionPolicy(input, committed(input), { versionProbe: probeV2 })).toBe(
      input
    )
  })

  it('reports NOT_SUPERSEDED for a no-op edit whose version is unchanged', () => {
    const input = observation([
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/a.js')
    ])
    const sink: C1LifecycleUnknown[] = []
    const output = applyC1SupersededVersionPolicy(input, committed(input), {
      versionProbe: () => sha256(V1),
      unknownSink: sink
    })
    expect(output).toBe(input)
    expect(sink).toEqual([
      {
        status: 'NOT_SUPERSEDED',
        reason: 'VERSION_UNCHANGED',
        path: 'src/a.js',
        readCallId: READ_ID
      }
    ])
  })

  it('reports UNKNOWN and keeps the pair when the after-version is unobservable', () => {
    const input = observation([
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/a.js')
    ])
    const sink: C1LifecycleUnknown[] = []
    const output = applyC1SupersededVersionPolicy(input, committed(input), {
      unknownSink: sink
    })
    expect(output).toBe(input)
    expect(sink).toEqual([
      {
        status: 'UNKNOWN',
        reason: 'AFTER_VERSION_UNOBSERVABLE',
        path: 'src/a.js',
        readCallId: READ_ID
      }
    ])
  })

  it('keeps the read pair when the edit targeted a different path', () => {
    const input = observation([
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/b.js')
    ])
    expect(applyC1SupersededVersionPolicy(input, committed(input), { versionProbe: probeV2 })).toBe(
      input
    )
  })

  it('never evicts an uncommitted read pair', () => {
    const input = observation([
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/a.js')
    ])
    expect(applyC1SupersededVersionPolicy(input, new Set(), { versionProbe: probeV2 })).toBe(input)
  })

  it('never evicts protected evidence', () => {
    const input = observation(
      [...readPair(READ_ID, 'src/a.js', V1), ...editPair(EDIT_ID, 'src/a.js')],
      { latestVerificationSourceKeys: [READ_KEYS[0]!] }
    )
    expect(applyC1SupersededVersionPolicy(input, committed(input), { versionProbe: probeV2 })).toBe(
      input
    )
  })

  it('evicts only the stale pair when other reads stay current', () => {
    const other = readPair('read-b-1', 'src/b.js', 'b-content\n')
    const input = observation([
      ...readPair(READ_ID, 'src/a.js', V1),
      ...editPair(EDIT_ID, 'src/a.js'),
      ...other
    ])
    const output = applyC1SupersededVersionPolicy(input, committed(input), {
      versionProbe: probeV2
    })
    expect(output.excludedSourceKeys).toEqual(READ_KEYS)
    expect(output.currentTargetSourceKeys).toContain('run/tool-call://read-b-1')
    expect(output.currentTargetSourceKeys).toContain('run/tool-result://read-b-1')
  })

  it.each([
    [
      'read result isError',
      (msgs: PiMessageView[]) => ((msgs[1] = { ...msgs[1]!, isError: true }), msgs)
    ],
    [
      'read has extra argument',
      (msgs: PiMessageView[]) => (
        ((msgs[0]!.content as Record<string, unknown>[])[0]!['arguments'] = {
          path: 'src/a.js',
          limit: 5
        }),
        msgs
      )
    ],
    [
      'assistant message mixes text and toolCall',
      (msgs: PiMessageView[]) => (
        (msgs[0]!.content as unknown[]).push({ type: 'text', text: 'thinking aloud' }),
        msgs
      )
    ],
    [
      'read result is opaque',
      (msgs: PiMessageView[]) => (
        (msgs[1] = { ...msgs[1]!, content: [{ type: 'image', data: 'x' }] }),
        msgs
      )
    ],
    ['edit id is ambiguous', (msgs: PiMessageView[]) => (msgs.push(msgs[3]!), msgs)],
    [
      'edit message carries two toolCalls',
      (msgs: PiMessageView[]) => (
        (msgs[2]!.content as unknown[]).push({
          type: 'toolCall',
          id: 'edit-a-2',
          name: 'edit',
          arguments: { path: 'src/a.js', oldText: 'x', newText: 'y' }
        }),
        msgs
      )
    ]
  ])('keeps the pair under guard: %s', (_name, mutate) => {
    const messages = [...readPair(READ_ID, 'src/a.js', V1), ...editPair(EDIT_ID, 'src/a.js')]
    const input = observation(mutate(messages))
    expect(applyC1SupersededVersionPolicy(input, committed(input), { versionProbe: probeV2 })).toBe(
      input
    )
  })

  it.each(['/abs/path.js', '../escape.js', 'a/./b.js', 'a\\b.js'])(
    'rejects unsafe edit path %s',
    (badPath) => {
      const input = observation([
        ...readPair(READ_ID, 'src/a.js', V1),
        ...editPair(EDIT_ID, badPath)
      ])
      expect(
        applyC1SupersededVersionPolicy(input, committed(input), { versionProbe: probeV2 })
      ).toBe(input)
    }
  )

  it('treats a successful write as a mutation too', () => {
    const messages = [...readPair(READ_ID, 'src/a.js', V1), ...editPair(EDIT_ID, 'src/a.js')]
    const writeCall = {
      ...(messages[2]!.content as Record<string, unknown>[])[0]!,
      name: 'write'
    }
    messages[2] = { ...messages[2]!, content: [writeCall] }
    messages[3] = { ...messages[3]!, toolName: 'write' }
    const input = observation(messages)
    const output = applyC1SupersededVersionPolicy(input, committed(input), {
      versionProbe: probeV2
    })
    expect(output.excludedSourceKeys).toEqual(READ_KEYS)
  })
})
