import { describe, expect, it } from 'vitest'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import {
  createRunKillSwitch,
  createActiveRewriteExtension,
  InMemoryActiveRewriteEvidenceCollector,
  readTargetHashOf,
  scanEditReadStructure,
  type ActiveRemovalPolicy,
  type ActiveRewriteEventEvidence,
  type PiMessageView
} from '../src'
import { C0ScenarioExecutor } from '../src/smoke/c0-scenarios'

// CR-004 removal policy v2 ('v2-retain-latest-coarse') tests — the M2
// ACTIVE_V2 arm semantics. Offline, credential-free, network-free: the
// extension is driven through REAL message sequences and the REAL policy-v0
// planner (same harness shape as cr004-matrix.test.ts). Provider calls: 0.
//
// Motivation (docs/verification/cr004-matrix-run-analysis-2026-08-27.md):
// M1's one-block-per-edit removal left 23/31 boundaries with no net context
// drop and induced 11 re-reads of removed targets (L2: 5/6). v2 sweeps ALL
// edited paths at each boundary and retains the LATEST read per swept path.

const FIXED_NOW = '2026-08-27T00:00:00.000Z'
const RUN_ID = 'cr004-m2-20260827-01234567'

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
      handler!({ type: 'context', messages: messages as unknown as ContextEvent['messages'] })
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
  label: string
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

function editPair(
  callId: string,
  path: string,
  label: string
): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: label },
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
    .flatMap((message) => (typeof message.content === 'string' ? [message.content] : message.content ?? []))
    .map((block) =>
      typeof block === 'string' ? block : ((block as { text?: unknown }).text as string | undefined) ?? ''
    )
    .join('\n')
}

function createHarness(options: {
  readonly removalPolicy?: ActiveRemovalPolicy
  readonly maxBlocksPerIntervention?: number
  readonly maxInterventions?: number
  readonly maxAttempts?: number
}) {
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${RUN_ID}:policy-v2-test`,
    now: () => FIXED_NOW
  })
  const collector = new InMemoryActiveRewriteEvidenceCollector()
  const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
  const factory = createActiveRewriteExtension({
    runId: RUN_ID,
    systemInstruction: 'You are a careful coding agent.',
    executor,
    killSwitch,
    evidence: collector,
    ...(options.removalPolicy !== undefined ? { removalPolicy: options.removalPolicy } : {}),
    ...(options.maxBlocksPerIntervention !== undefined
      ? { maxBlocksPerIntervention: options.maxBlocksPerIntervention }
      : {}),
    ...(options.maxInterventions !== undefined ? { maxInterventions: options.maxInterventions } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {})
  })
  return { dispatch: register(factory).dispatch, collector, killSwitch }
}

const PROMPT = 'Refactor the module per the task manifest.'
const P1 = 'src/alpha.ts'
const P2 = 'src/beta.ts'

describe('scanEditReadStructure (pure v2 sweep input)', () => {
  it('collects edits in scan order and groups result-present reads per path', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha first', 'Reading alpha.'),
      ...readPair('r2', P2, 'beta first', 'Reading beta.'),
      ...readPair('r3', P1, 'alpha second', 'Re-reading alpha.'),
      ...editPair('e1', P1, 'Editing alpha.'),
      ...editPair('e2', P2, 'Editing beta.')
    ]
    const view = scanEditReadStructure(messages)
    expect(view.edits).toEqual([
      { toolCallId: 'e1', path: P1 },
      { toolCallId: 'e2', path: P2 }
    ])
    const alpha = view.readsByPath.find((entry) => entry.path === P1)!
    expect(alpha.reads.map((read) => read.callId)).toEqual(['r1', 'r3'])
    expect(alpha.reads[1]!.order).toBeGreaterThan(alpha.reads[0]!.order)
    const beta = view.readsByPath.find((entry) => entry.path === P2)!
    expect(beta.reads.map((read) => read.callId)).toEqual(['r2'])
    // A read whose toolResult is not yet present is not supersedeable evidence.
    const inFlight: readonly PiMessageView[] = [
      ...messages,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Reading again.' }, { type: 'toolCall', id: 'r4', name: 'read', arguments: { path: P1 } }]
      }
    ]
    const withInFlight = scanEditReadStructure(inFlight)
    expect(
      withInFlight.readsByPath.find((entry) => entry.path === P1)!.reads.map((read) => read.callId)
    ).toEqual(['r1', 'r3'])
  })
})

describe('removal policy v2 (retain-latest coarse, real planner, offline)', () => {
  it('(a) one file read 3x then edited once: ONE intervention removes the 2 older read pairs and keeps the latest', async () => {
    const harness = createHarness({ removalPolicy: 'v2-retain-latest-coarse' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha content v1', 'Reading alpha first.'),
      ...readPair('r2', P1, 'alpha content v2', 'Reading alpha second.'),
      ...readPair('r3', P1, 'alpha content v3 LATEST', 'Reading alpha latest.'),
      ...editPair('e1', P1, 'Editing alpha.')
    ]
    // Event 1: prompt only. Event 2: all traffic at once — the fresh read
    // pairs are not yet in a planned Working Set, so no attempt fires yet.
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    // Event 3: the working set now holds the read pairs; the edit observed at
    // event 2 is a NEW trigger -> one coarse sweep over every edited path.
    const fired = await harness.dispatch([...base, textMessage('Continuing.')])
    const firedMessages = fired!.messages as readonly PiMessageView[]

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    const attempt = attempts[0]!
    expect(attempt.sentRewrite).toBe(true)
    expect(attempt.policy).toBe('v2-retain-latest-coarse')
    expect(attempt.candidateBlocks).toBe(2)
    expect(attempt.removedBlocks).toBe(2)
    expect(attempt.removedReadTargetHashes).toEqual([readTargetHashOf(P1), readTargetHashOf(P1)])
    expect(attempt.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    expect(attempt.interventionPath).toBe(P1)

    // The composed rewrite drops the two OLDER read pairs (call blocks +
    // paired results) and KEEPS the latest read content in the model-visible
    // context — the model never needs to re-fetch the file.
    const text = textsOf(firedMessages)
    expect(text).toContain('alpha content v3 LATEST')
    expect(text).not.toContain('alpha content v1')
    expect(text).not.toContain('alpha content v2')
    // 10 native messages at this event (prompt + 3 read pairs + edit pair +
    // trailing text) - 2 dropped toolResults = 8 (mixed read messages keep
    // their text blocks and only lose the removed toolCall blocks).
    expect(firedMessages).toHaveLength(8)

    // The event evidence carries the same policy telemetry.
    const sentEvent = harness.collector.events.find(
      (event) => event.interventionAttempted
    ) as ActiveRewriteEventEvidence
    expect(sentEvent.policy).toBe('v2-retain-latest-coarse')
    expect(sentEvent.candidateBlocks).toBe(2)
    expect(sentEvent.removedBlocks).toBe(2)
    expect(sentEvent.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    // No further boundary appears: the only edit was attempted and the latest
    // read is retained, so nothing is supersedeable.
    const idle = await harness.dispatch([...base, textMessage('Wrapping up.')])
    expect(harness.collector.interventions).toHaveLength(1)
    expect((idle!.messages as readonly PiMessageView[]).length).toBeLessThan(base.length + 2)
  })

  it('(b) two files each read twice, only one edited: only the edited file loses its older read', async () => {
    const harness = createHarness({ removalPolicy: 'v2-retain-latest-coarse' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('a1', P1, 'alpha older', 'Reading alpha first.'),
      ...readPair('a2', P1, 'alpha latest', 'Reading alpha again.'),
      ...readPair('b1', P2, 'beta older', 'Reading beta first.'),
      ...readPair('b2', P2, 'beta latest', 'Reading beta again.'),
      ...editPair('e1', P1, 'Editing alpha only.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    const fired = await harness.dispatch([...base, textMessage('Continuing.')])
    const firedMessages = fired!.messages as readonly PiMessageView[]

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.removedBlocks).toBe(1)
    expect(attempts[0]!.candidateBlocks).toBe(1)
    expect(attempts[0]!.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    expect(attempts[0]!.removedReadTargetHashes).toEqual([readTargetHashOf(P1)])

    // Conservative rule: the UNEDITED file's reads are untouched (both beta
    // reads stay, older AND latest); the edited file keeps only its latest.
    const text = textsOf(firedMessages)
    expect(text).not.toContain('alpha older')
    expect(text).toContain('alpha latest')
    expect(text).toContain('beta older')
    expect(text).toContain('beta latest')
  })

  it('(c) cap: 15 stale reads -> removes the OLDEST 12, the next boundary gets the rest', async () => {
    const harness = createHarness({ removalPolicy: 'v2-retain-latest-coarse' })
    const reads: PiMessageView[] = []
    for (let index = 1; index <= 16; index += 1) {
      const marker = String(index).padStart(2, '0')
      reads.push(
        ...readPair(
          `r${marker}`,
          P1,
          `alpha bulk content ${marker}`,
          `Bulk read ${marker}.`
        )
      )
    }
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...reads,
      ...editPair('e1', P1, 'Editing alpha.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    // Boundary 1: 15 candidates (r01..r15; r16 is the retained latest), cap 12
    // => the OLDEST 12 removed, r13..r15 wait for the next boundary.
    const first = await harness.dispatch([...base, textMessage('Continuing.')])
    const firstText = textsOf(first!.messages as readonly PiMessageView[])
    const firstAttempt = harness.collector.interventions[0]!
    expect(firstAttempt.candidateBlocks).toBe(15)
    expect(firstAttempt.removedBlocks).toBe(12)
    expect(firstAttempt.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    expect(firstAttempt.sentRewrite).toBe(true)
    for (let index = 1; index <= 12; index += 1) {
      expect(firstText).not.toContain(`alpha bulk content ${String(index).padStart(2, '0')}`)
    }
    for (let index = 13; index <= 16; index += 1) {
      expect(firstText).toContain(`alpha bulk content ${String(index).padStart(2, '0')}`)
    }
    // Boundary 2: a NEW edit of the same path re-triggers the sweep; the 3
    // leftovers from the capped sweep are removed now.
    const secondBase: readonly PiMessageView[] = [
      ...base,
      textMessage('Continuing.'),
      ...editPair('e2', P1, 'Editing alpha again.')
    ]
    const second = await harness.dispatch(secondBase)
    const secondText = textsOf(second!.messages as readonly PiMessageView[])
    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(2)
    expect(attempts[1]!.sentRewrite).toBe(true)
    expect(attempts[1]!.candidateBlocks).toBe(3)
    expect(attempts[1]!.removedBlocks).toBe(3)
    expect(harness.collector.sendsUsed).toBe(2)
    for (let index = 13; index <= 15; index += 1) {
      expect(secondText).not.toContain(`alpha bulk content ${String(index).padStart(2, '0')}`)
    }
    // The retained LATEST read survives every sweep.
    expect(secondText).toContain('alpha bulk content 16')
  })

  it('(d) explicit v1-per-edit option behaves exactly as the default (regression): no retention, trigger path only', async () => {
    const runOnce = async (policyOption: ActiveRemovalPolicy | 'default') => {
      const harness = createHarness(
        policyOption === 'default' ? {} : { removalPolicy: policyOption }
      )
      const base: readonly PiMessageView[] = [
        userMessage(PROMPT),
        ...readPair('a1', P1, 'alpha content v1', 'Reading alpha first.'),
        ...readPair('a2', P1, 'alpha content v2 LATEST', 'Reading alpha latest.'),
        ...readPair('b1', P2, 'beta content', 'Reading beta.'),
        ...editPair('e1', P1, 'Editing alpha.')
      ]
      await harness.dispatch(base.slice(0, 1))
      await harness.dispatch(base)
      const fired = await harness.dispatch([...base, textMessage('Continuing.')])
      const attempt = harness.collector.interventions[0]!
      return {
        attempt,
        messages: fired!.messages as readonly PiMessageView[],
        text: textsOf(fired!.messages as readonly PiMessageView[])
      }
    }
    const explicit = await runOnce('v1-per-edit')
    const byDefault = await runOnce('default')

    for (const result of [explicit, byDefault]) {
      // v1 semantics: the boundary removes EVERY still-active earlier read of
      // the trigger path — including the latest — and retains nothing.
      expect(result.attempt.policy).toBe('v1-per-edit')
      expect(result.attempt.removedBlocks).toBe(2)
      expect(result.attempt.candidateBlocks).toBe(2)
      expect(result.attempt.retainedLatestReadTargets).toEqual([])
      expect(result.attempt.interventionPath).toBe(P1)
      expect(result.text).not.toContain('alpha content v1')
      expect(result.text).not.toContain('alpha content v2 LATEST')
      // The untouched path's read survives under v1 too (no edit for P2).
      expect(result.text).toContain('beta content')
    }
    // Byte-identical shapes: same removal telemetry, same composed length.
    expect(explicit.attempt.removedReadTargetHashes).toEqual(
      byDefault.attempt.removedReadTargetHashes
    )
    expect(explicit.messages).toHaveLength(byDefault.messages.length)
  })
})
