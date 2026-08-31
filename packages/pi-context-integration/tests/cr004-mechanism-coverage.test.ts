import { describe, expect, it } from 'vitest'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { PiMessageView } from '../src'
import {
  createActiveRewriteExtension,
  createRunKillSwitch,
  detectReReads,
  estimatePiMessagesTokenEstimate,
  InMemoryActiveRewriteEvidenceCollector,
  readTargetHashOf,
  scanDuplicateReads,
  scanEditReadStructure,
  type ActiveRewriteEventEvidence
} from '../src/experimental'
import { C0ScenarioExecutor } from '../src/smoke/c0-scenarios'

// CR-004 M7 zero-provider mechanism coverage.
//
// This suite deliberately drives the real Active extension and the real
// policy-v0 planner with trace-shaped Pi messages. It explores exposure and
// measurement boundaries without changing policy-v0, fixtures, or product
// defaults. Provider calls: 0.

const FIXED_NOW = '2026-08-30T00:00:00.000Z'
const RUN_ID = 'cr004-m7-20260830-01234567'
const PROMPT = 'Refactor the module per the task manifest.'
const P1 = 'src/alpha.ts'
const P2 = 'src/beta.ts'
const P3 = 'src/gamma.ts'

type ContextHandler = (event: ContextEvent) => Promise<{ messages: unknown[] } | undefined>

function register(factory: ExtensionFactory): {
  dispatch: (messages: readonly PiMessageView[]) => Promise<{ messages: unknown[] } | undefined>
} {
  let handler: ContextHandler | undefined
  const pi = {
    on: (event: 'context', registered: ContextHandler) => {
      if (event === 'context') handler = registered
    }
  } as unknown as ExtensionAPI
  factory(pi)
  if (handler === undefined) throw new Error('factory registered no context handler')
  return {
    dispatch: async (messages) =>
      handler!({
        type: 'context',
        messages: messages as unknown as ContextEvent['messages']
      })
  }
}

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function textMessage(text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function readPair(
  callId: string,
  path: string,
  resultText: string,
  label = `Reading ${path}.`
): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: label },
        { type: 'toolCall', id: callId, name: 'read', arguments: { path } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: resultText }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function editPair(callId: string, path: string): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: `Editing ${path}.` },
        { type: 'toolCall', id: callId, name: 'edit', arguments: { path } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: `edited ${path}` }],
      toolCallId: callId,
      toolName: 'edit',
      isError: false
    }
  ]
}

function textsOf(messages: readonly PiMessageView[]): string {
  return messages
    .flatMap((message) =>
      typeof message.content === 'string' ? [message.content] : (message.content ?? [])
    )
    .map((block) =>
      typeof block === 'string'
        ? block
        : (((block as { text?: unknown }).text as string | undefined) ?? '')
    )
    .join('\n')
}

function createHarness(options: {
  readonly minCandidateBlocks?: number
  readonly maxBlocksPerIntervention?: number
}) {
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${RUN_ID}:mechanism-coverage`,
    now: () => FIXED_NOW
  })
  const collector = new InMemoryActiveRewriteEvidenceCollector()
  const factory = createActiveRewriteExtension({
    runId: RUN_ID,
    systemInstruction: 'You are a careful coding agent.',
    executor,
    killSwitch: createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW }),
    evidence: collector,
    removalPolicy: 'v4-batched-retain-latest',
    ...(options.minCandidateBlocks !== undefined
      ? { minCandidateBlocks: options.minCandidateBlocks }
      : {}),
    ...(options.maxBlocksPerIntervention !== undefined
      ? { maxBlocksPerIntervention: options.maxBlocksPerIntervention }
      : {})
  })
  return { dispatch: register(factory).dispatch, collector, executor }
}

async function primeAndDispatch(
  harness: ReturnType<typeof createHarness>,
  messages: readonly PiMessageView[]
): Promise<{ messages: unknown[] } | undefined> {
  await harness.dispatch(messages.slice(0, 1))
  await harness.dispatch(messages)
  return harness.dispatch([...messages, textMessage('Continue.')])
}

describe('M7 trace coverage: pure structure scans', () => {
  it('keeps multi-path ordering, normalizes paths, and excludes an in-flight read', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('a1', './src/alpha.ts', 'alpha older'),
      ...readPair('a2', P1, 'alpha latest'),
      ...readPair('b1', P2, 'beta latest'),
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: P3 } }]
      },
      ...editPair('ea', P1),
      ...editPair('eb', P2)
    ]
    const view = scanEditReadStructure(messages)
    expect(view.edits).toEqual([
      { toolCallId: 'ea', path: P1 },
      { toolCallId: 'eb', path: P2 }
    ])
    expect(view.readsByPath).toEqual([
      {
        path: P1,
        reads: [
          { callId: 'a1', order: 1 },
          { callId: 'a2', order: 2 }
        ]
      },
      { path: P2, reads: [{ callId: 'b1', order: 3 }] }
    ])
    expect(view.readsByPath.some((entry) => entry.path === P3)).toBe(false)
  })

  it('only treats identical same-path content as duplicate and preserves edit-separated history', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('a1', P1, 'same content'),
      ...readPair('b1', P2, 'same content'),
      ...readPair('a2', P1, 'same content'),
      ...readPair('a3', P1, 'changed content'),
      ...editPair('ea', P1),
      ...readPair('a4', P1, 'same content')
    ]
    const view = scanDuplicateReads(messages)
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]!.path).toBe(P1)
    expect(view.entries[0]!.duplicates.map((read) => read.callId)).toEqual(['a1'])
    expect(view.triggerReadCalls.map((read) => read.callId)).toEqual(['a2'])
    // The later a4 is not allowed to dedup a read across the edit boundary.
    expect(view.entries[0]!.duplicates).not.toContainEqual(
      expect.objectContaining({ callId: 'a3' })
    )
  })
})

describe('M7 trace coverage: batched exposure and measurement', () => {
  it.each([1, 2, 3, 4])(
    'honors the fixed candidate threshold %i without changing retain-latest semantics',
    async (threshold) => {
      const harness = createHarness({ minCandidateBlocks: threshold })
      const reads: PiMessageView[] = [userMessage(PROMPT)]
      for (let index = 1; index <= threshold + 1; index += 1) {
        reads.push(...readPair(`threshold-r${index}`, P1, `threshold content ${index}`))
      }
      reads.push(...editPair('threshold-e1', P1))

      const fired = await primeAndDispatch(harness, reads)
      const output = fired!.messages as readonly PiMessageView[]
      const attempt = harness.collector.interventions[0]!
      expect(attempt.candidateBlocks).toBe(threshold)
      expect(attempt.removedBlocks).toBe(threshold)
      expect(textsOf(output)).toContain(`threshold content ${threshold + 1}`)
      for (let index = 1; index <= threshold; index += 1) {
        expect(textsOf(output)).not.toContain(`threshold content ${index}`)
      }
    }
  )

  it('defers below threshold 3, then sends once three stale pairs are eligible', async () => {
    const harness = createHarness({ minCandidateBlocks: 3 })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha v1'),
      ...readPair('r2', P1, 'alpha v2'),
      ...readPair('r3', P1, 'alpha v3'),
      ...editPair('e1', P1)
    ]

    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    const deferredInput: readonly PiMessageView[] = [...base, textMessage('Waiting.')]
    await harness.dispatch(deferredInput)
    const deferred = harness.collector.events.find(
      (event) => event.deferredByBatchThreshold === true
    )!
    expect(deferred.candidateBlocks).toBe(2)
    expect(deferred.batchThreshold).toBe(3)
    expect(harness.collector.attemptsUsed).toBe(0)

    const firedInput: readonly PiMessageView[] = [
      ...base,
      textMessage('Waiting.'),
      ...readPair('r4', P1, 'alpha v4 latest')
    ]
    const fired = await harness.dispatch(firedInput)
    const output = fired!.messages as readonly PiMessageView[]
    const attempt = harness.collector.interventions[0]!
    expect(attempt.sentRewrite).toBe(true)
    expect(attempt.candidateBlocks).toBe(3)
    expect(attempt.removedBlocks).toBe(3)
    expect(textsOf(output)).not.toContain('alpha v1')
    expect(textsOf(output)).not.toContain('alpha v2')
    expect(textsOf(output)).not.toContain('alpha v3')
    expect(textsOf(output)).toContain('alpha v4 latest')

    const sentEvent = harness.collector.events.find((event) => event.sentRewrite)!
    const before = estimatePiMessagesTokenEstimate(firedInput)
    const after = estimatePiMessagesTokenEstimate(output)
    expect(sentEvent.modelVisibleBeforeTokenEstimate).toBe(before)
    expect(sentEvent.modelVisibleAfterTokenEstimate).toBe(after)
    expect(sentEvent.netModelVisibleTokenReduction).toBe(before - after)
    expect(sentEvent.netModelVisibleTokenReduction).toBeGreaterThan(0)
  })

  it('sweeps multiple edited paths but never removes the latest or an unedited path', async () => {
    const harness = createHarness({ minCandidateBlocks: 2 })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('a1', P1, 'alpha old'),
      ...readPair('a2', P1, 'alpha latest'),
      ...readPair('b1', P2, 'beta old 1'),
      ...readPair('b2', P2, 'beta old 2'),
      ...readPair('b3', P2, 'beta latest'),
      ...readPair('c1', P3, 'gamma old'),
      ...readPair('c2', P3, 'gamma latest'),
      ...editPair('ea', P1),
      ...editPair('eb', P2)
    ]
    const fired = await primeAndDispatch(harness, base)
    const output = fired!.messages as readonly PiMessageView[]
    const attempt = harness.collector.interventions[0]!
    expect(attempt.candidateBlocks).toBe(3)
    expect(attempt.removedBlocks).toBe(3)
    expect(attempt.retainedLatestReadTargets).toEqual([readTargetHashOf(P1), readTargetHashOf(P2)])
    const text = textsOf(output)
    expect(text).not.toContain('alpha old')
    expect(text).toContain('alpha latest')
    expect(text).not.toContain('beta old 1')
    expect(text).not.toContain('beta old 2')
    expect(text).toContain('beta latest')
    expect(text).toContain('gamma old')
    expect(text).toContain('gamma latest')
    expect(harness.collector.events.filter((event) => event.sentRewrite)).toHaveLength(1)
  })

  it('retains re-read evidence as demand/candidate evidence without claiming confirmed false removal', () => {
    const removedHash = readTargetHashOf(P1)
    const events: readonly ActiveRewriteEventEvidence[] = [
      {
        sequence: 1,
        observedTokenEstimate: 100,
        boundaryReached: true,
        interventionAttempted: true,
        interventionIndex: 1,
        compositionVerdict: 'REWRITE_READY',
        guardVerdict: 'PASS',
        sentRewrite: true,
        killSwitchTripped: false,
        toolBlocksRemoved: 1,
        removedReadTargetHashes: [removedHash]
      },
      {
        sequence: 2,
        observedTokenEstimate: 60,
        boundaryReached: false,
        interventionAttempted: false,
        compositionVerdict: 'NOT_ATTEMPTED',
        guardVerdict: 'NOT_ATTEMPTED',
        sentRewrite: false,
        killSwitchTripped: false,
        toolBlocksRemoved: 0,
        readTargets: [{ toolCallId: 'r2', readTargetHash: removedHash }]
      }
    ]
    const analysis = detectReReads(events)
    expect(analysis.matches).toEqual([
      { afterInterventionIndex: 1, readTargetHash: removedHash, sequence: 2 }
    ])
    // A re-read is a rehydrate-demand / false-removal-candidate signal. With
    // telemetry alone there is no oracle evidence that proves the removal was
    // wrong, so this suite intentionally makes no confirmed-error claim.
    expect(analysis.matches).toHaveLength(1)
  })
})
