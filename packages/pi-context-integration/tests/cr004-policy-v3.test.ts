import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { type PiMessageView } from '../src'
import {
  createRunKillSwitch,
  createActiveRewriteExtension,
  estimatePiMessagesTokenEstimate,
  InMemoryActiveRewriteEvidenceCollector,
  isVerificationWindowOpen,
  readContentHashOf,
  readTargetHashOf,
  scanDuplicateReads,
  type ActiveRemovalPolicy,
  type ActiveRewriteEventEvidence
} from '../src/experimental'
import { C0ScenarioExecutor } from '../src/smoke/c0-scenarios'

// CR-004 removal policy v3 ('v3-verify-window-dedup') tests — the M3
// ACTIVE_V3 arm semantics. Offline, credential-free, network-free: the
// extension is driven through REAL message sequences and the REAL policy-v0
// planner (same harness shape as cr004-policy-v2.test.ts). Provider calls: 0.
//
// v3 = v2 (retain-latest coarse sweep) + duplicate-read dedup (a NEW read of
// an already-read path with IDENTICAL tool-result content and no path edit
// between the reads opens an intervention boundary with NO edit in flight) +
// a verification-window deferral (edit-triggered sweeps defer while the last
// K tool events are bash-class; dedup removals still fire).
//
// Motivation (docs/verification/cr004-m2-matrix-analysis-2026-08-27.md): L2
// verification-heavy re-reads of edited files are v2's remaining mass, and
// they happen AFTER editing stops — there may be NO further edit boundary to
// trigger a sweep.

const FIXED_NOW = '2026-08-27T00:00:00.000Z'
const RUN_ID = 'cr004-m3-20260827-01234567'

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

function editPair(callId: string, path: string, label: string): readonly PiMessageView[] {
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

function bashPair(callId: string, command: string, label: string): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: label },
        { type: 'toolCall', id: callId, name: 'bash', arguments: { command } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: `ran ${command}` }],
      toolCallId: callId,
      toolName: 'bash',
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

/**
 * Occurrences of a needle in the composed text. Duplicate reads share
 * IDENTICAL result content, so a dedup removal shows up as the content
 * appearing once fewer (the removed pair's toolResult is dropped; assistant
 * prose labels legitimately stay in context).
 */
function occurrencesOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function createHarness(options: {
  readonly removalPolicy?: ActiveRemovalPolicy
  readonly maxBlocksPerIntervention?: number
  readonly maxInterventions?: number
  readonly maxAttempts?: number
  readonly verifyWindowEvents?: number
  readonly minCandidateBlocks?: number
}) {
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${RUN_ID}:policy-v3-test`,
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
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.verifyWindowEvents !== undefined
      ? { verifyWindowEvents: options.verifyWindowEvents }
      : {}),
    ...(options.minCandidateBlocks !== undefined
      ? { minCandidateBlocks: options.minCandidateBlocks }
      : {})
  })
  return { dispatch: register(factory).dispatch, collector, killSwitch }
}

const PROMPT = 'Refactor the module per the task manifest.'
const P1 = 'src/alpha.ts'
const P2 = 'src/beta.ts'
const ALPHA = 'export const alpha = 1\n'

describe('readContentHashOf (pure)', () => {
  it('is the first 16 hex chars of sha256 over the toolResult text', () => {
    const expected = createHash('sha256').update(ALPHA, 'utf8').digest('hex').slice(0, 16)
    expect(readContentHashOf(ALPHA)).toBe(expected)
    expect(readContentHashOf(ALPHA)).toHaveLength(16)
    expect(readContentHashOf(ALPHA)).not.toBe(readContentHashOf(`${ALPHA}x`))
  })
})

describe('scanDuplicateReads (pure v3 dedup input)', () => {
  it('marks older identical-content reads as duplicates and names the trigger read', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha.'),
      ...readPair('r2', P2, 'beta body', 'Reading beta.'),
      ...readPair('r3', P1, ALPHA, 'Re-reading alpha.'),
      ...readPair('r4', P1, ALPHA, 'Verifying alpha.')
    ]
    const view = scanDuplicateReads(messages)
    const alpha = view.entries.find((entry) => entry.path === P1)!
    expect(alpha.anchorCallId).toBe('r4')
    expect(alpha.duplicates.map((duplicate) => duplicate.callId)).toEqual(['r1', 'r3'])
    expect(view.triggerReadCalls).toEqual([{ callId: 'r4', order: expect.any(Number), path: P1 }])
    // Different path, no duplicate: no entry, no trigger.
    expect(view.entries.find((entry) => entry.path === P2)).toBeUndefined()
  })

  it('does NOT dedup when the content DIFFERED between the reads (file changed)', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha content v1', 'Reading alpha.'),
      ...readPair('r2', P1, 'alpha content v2', 'Re-reading alpha.')
    ]
    const view = scanDuplicateReads(messages)
    expect(view.entries).toHaveLength(0)
    expect(view.triggerReadCalls).toHaveLength(0)
  })

  it('does NOT dedup identical reads when an EDIT of the path sits between them', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha.'),
      ...editPair('e1', P1, 'Editing alpha.'),
      ...readPair('r2', P1, ALPHA, 'Re-reading alpha.')
    ]
    const view = scanDuplicateReads(messages)
    expect(view.entries).toHaveLength(0)
  })

  it('excludes reads whose toolResult is not yet present', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha.'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Re-reading alpha.' },
          { type: 'toolCall', id: 'r2', name: 'read', arguments: { path: P1 } }
        ]
      }
    ]
    const view = scanDuplicateReads(messages)
    expect(view.entries).toHaveLength(0)
  })
})

describe('isVerificationWindowOpen (pure)', () => {
  it('opens when the last K (default 2) tool calls are ALL bash-class', () => {
    const withBashTail: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha.'),
      ...bashPair('b1', 'npm test', 'Running the oracle.'),
      ...bashPair('b2', 'npm test -- --grep new', 'Running it again.')
    ]
    expect(isVerificationWindowOpen(withBashTail)).toBe(true)
  })

  it('closes when a non-bash tool call sits inside the window', () => {
    const readAfterBash: readonly PiMessageView[] = [
      ...bashPair('b1', 'npm test', 'Running the oracle.'),
      ...readPair('r1', P1, ALPHA, 'Re-checking a file.')
    ]
    expect(isVerificationWindowOpen(readAfterBash)).toBe(false)
    const editAfterBash: readonly PiMessageView[] = [
      ...bashPair('b1', 'npm test', 'Running the oracle.'),
      ...editPair('e1', P1, 'Fixing.')
    ]
    expect(isVerificationWindowOpen(editAfterBash)).toBe(false)
  })

  it('handles the empty tail and a configurable window width', () => {
    expect(isVerificationWindowOpen([userMessage(PROMPT)])).toBe(false)
    expect(isVerificationWindowOpen([])).toBe(false)
    const singleBash: readonly PiMessageView[] = [...bashPair('b1', 'npm test', 'Oracle.')]
    // A single bash call IS the most recent tool activity: open at any K.
    expect(isVerificationWindowOpen(singleBash)).toBe(true)
    expect(isVerificationWindowOpen(singleBash, { verifyWindowEvents: 3 })).toBe(true)
    // K=1: only the very last tool call matters.
    const bashThenRead: readonly PiMessageView[] = [
      ...bashPair('b1', 'npm test', 'Oracle.'),
      ...readPair('r1', P1, ALPHA, 'Reading.')
    ]
    expect(isVerificationWindowOpen(bashThenRead, { verifyWindowEvents: 1 })).toBe(false)
    const readThenBash: readonly PiMessageView[] = [
      ...readPair('r1', P1, ALPHA, 'Reading.'),
      ...bashPair('b1', 'npm test', 'Oracle.')
    ]
    expect(isVerificationWindowOpen(readThenBash, { verifyWindowEvents: 1 })).toBe(true)
  })
})

describe('removal policy v3 (verify-window dedup, real planner, offline)', () => {
  it('(a) same path read twice with IDENTICAL content, no edit: the older pair is removed at the second read boundary (trigger dedup), the newer retained', async () => {
    const harness = createHarness({ removalPolicy: 'v3-verify-window-dedup' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha first.'),
      ...readPair('r2', P1, ALPHA, 'Re-reading alpha (identical content).')
    ]
    // Event 1: prompt only. Event 2: all traffic at once — the fresh read
    // pairs are not yet in a planned Working Set, so no attempt fires yet.
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    // Event 3: the duplicate just arrived (r2) and r1 is active — a DEDUP
    // boundary opens with NO edit anywhere in the leg.
    const fired = await harness.dispatch([...base, textMessage('Continuing.')])
    const firedMessages = fired!.messages as readonly PiMessageView[]

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    const attempt = attempts[0]!
    expect(attempt.sentRewrite).toBe(true)
    expect(attempt.policy).toBe('v3-verify-window-dedup')
    expect(attempt.trigger).toBe('dedup')
    expect(attempt.interventionPath).toBe(P1)
    expect(attempt.candidateBlocks).toBe(1)
    expect(attempt.removedBlocks).toBe(1)
    expect(attempt.removedReadTargetHashes).toEqual([readTargetHashOf(P1)])
    expect(attempt.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    expect(attempt.attemptOutcome).toBe('SENT')

    // The composed rewrite drops the OLDER duplicate pair (its toolCall block
    // and paired toolResult) and KEEPS the newer copy — the information is
    // fully preserved. 6 native messages - 1 dropped toolResult = 5 (the
    // mixed read message keeps its text block and loses only the toolCall).
    expect(firedMessages).toHaveLength(5)
    const text = textsOf(firedMessages)
    expect(occurrencesOf(text, ALPHA)).toBe(1)
    expect(text).toContain('Re-reading alpha (identical content).')

    // Event evidence + per-leg metrics: trigger dedup, no deferral.
    const sentEvent = harness.collector.events.find(
      (event) => event.interventionAttempted
    ) as ActiveRewriteEventEvidence
    expect(sentEvent.trigger).toBe('dedup')
    expect(sentEvent.policy).toBe('v3-verify-window-dedup')
    expect(sentEvent.deferredByVerifyWindow).toBeUndefined()
    expect(harness.collector.dedupRemovals).toBe(1)
    expect(harness.collector.deferredSweeps).toBe(0)
    // No further boundary: the trigger read was attempted and nothing else is
    // supersedeable.
    const idle = await harness.dispatch([...base, textMessage('Wrapping up.')])
    expect(harness.collector.interventions).toHaveLength(1)
    expect((idle!.messages as readonly PiMessageView[]).length).toBe(5)
  })

  it('(b) same path read twice but the content DIFFERED: NOT deduped (both retained, safe)', async () => {
    const harness = createHarness({ removalPolicy: 'v3-verify-window-dedup' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha content v1', 'Reading alpha first.'),
      ...readPair('r2', P1, 'alpha content v2 (file changed)', 'Re-reading alpha.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    const third = await harness.dispatch([...base, textMessage('Continuing.')])
    const thirdMessages = third!.messages as readonly PiMessageView[]

    expect(harness.collector.interventions).toHaveLength(0)
    expect(harness.collector.dedupRemovals).toBe(0)
    expect(harness.collector.deferredSweeps).toBe(0)
    // Idle: the basis (identical to the native list, no carried removals) is
    // returned whole — BOTH read pairs stay model-visible.
    expect(thirdMessages).toHaveLength(6)
    const text = textsOf(thirdMessages)
    expect(text).toContain('alpha content v1')
    expect(text).toContain('alpha content v2 (file changed)')
  })

  it('(c) verification window: an edit boundary arriving while the last two tool events are bash DEFERS the sweep, which resumes at the next non-bash boundary', async () => {
    const harness = createHarness({ removalPolicy: 'v3-verify-window-dedup' })
    // Two reads with DIFFERENT content (so dedup cannot interfere), an edit of
    // the path, then two bash calls — a verification sequence in flight.
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha content v1', 'Reading alpha first.'),
      ...readPair('r1b', P1, 'alpha content v2', 'Re-reading alpha.'),
      ...editPair('e1', P1, 'Editing alpha.'),
      ...bashPair('b1', 'npm test', 'Running the oracle.'),
      ...bashPair('b2', 'npm test -- --grep cache', 'Running it again.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    // Event 3: the edit boundary qualifies (r1 supersedeable, r1b retained)
    // but the last two tool events are bash => DEFERRED, nothing removed.
    const deferred = await harness.dispatch([...base, textMessage('Continuing.')])
    const deferredMessages = deferred!.messages as readonly PiMessageView[]
    expect(harness.collector.interventions).toHaveLength(0)
    expect(deferredMessages).toHaveLength(12) // basis unchanged (no carries)
    const deferredEvent = harness.collector.events[2] as ActiveRewriteEventEvidence
    expect(deferredEvent.interventionAttempted).toBe(false)
    expect(deferredEvent.deferredByVerifyWindow).toBe(true)
    expect(harness.collector.deferredSweeps).toBe(1)
    // Event 4: a read breaks the verification window (last two tool events
    // are now bash, read) => the deferred sweep RESUMES at this boundary.
    const resumed: readonly PiMessageView[] = [
      ...base,
      textMessage('Continuing.'),
      ...readPair('r2', P2, 'beta content', 'Reading beta.')
    ]
    const fired = await harness.dispatch(resumed)
    const firedMessages = fired!.messages as readonly PiMessageView[]

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    const attempt = attempts[0]!
    expect(attempt.sentRewrite).toBe(true)
    expect(attempt.policy).toBe('v3-verify-window-dedup')
    expect(attempt.trigger).toBe('edit')
    expect(attempt.interventionPath).toBe(P1)
    expect(attempt.candidateBlocks).toBe(1)
    expect(attempt.removedBlocks).toBe(1)
    expect(attempt.removedReadTargetHashes).toEqual([readTargetHashOf(P1)])
    expect(attempt.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    // No further deferral once the sweep fired.
    expect(harness.collector.deferredSweeps).toBe(1)
    expect(harness.collector.dedupRemovals).toBe(0)
    // v2 retain-latest semantics on the resumed sweep: the OLDER read is
    // dropped, the latest read of the edited path and the fresh beta read
    // stay, and the verification evidence (bash results) is untouched.
    const text = textsOf(firedMessages)
    expect(text).not.toContain('alpha content v1')
    expect(text).toContain('alpha content v2')
    expect(text).toContain('beta content')
    expect(text).toContain('ran npm test')
  })

  it('(c-2) dedup removals STILL FIRE inside a verification window (pure win)', async () => {
    const harness = createHarness({ removalPolicy: 'v3-verify-window-dedup' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha.'),
      ...readPair('r2', P1, ALPHA, 'Verifying alpha (identical).'),
      ...bashPair('b1', 'npm test', 'Running the oracle.'),
      ...bashPair('b2', 'npm test', 'Running it again.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    const fired = await harness.dispatch([...base, textMessage('Continuing.')])
    const firedMessages = fired!.messages as readonly PiMessageView[]

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.trigger).toBe('dedup')
    expect(attempts[0]!.removedBlocks).toBe(1)
    // The dedup fired while the window was open: no deferral was recorded
    // (nothing was ever deferred — there is no edit boundary in this leg).
    expect(harness.collector.deferredSweeps).toBe(0)
    expect(harness.collector.dedupRemovals).toBe(1)
    const text = textsOf(firedMessages)
    expect(occurrencesOf(text, ALPHA)).toBe(1)
    expect(text).toContain('Verifying alpha (identical).')
  })

  it('(d) v3 keeps v2 behavior on the v2 scenario: read 3x/edit -> older reads removed, latest kept (trigger edit)', async () => {
    const harness = createHarness({ removalPolicy: 'v3-verify-window-dedup' })
    // DIFFERENT contents per read (the v2 test shape): only the edit boundary
    // can remove anything here.
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha content v1', 'Reading alpha first.'),
      ...readPair('r2', P1, 'alpha content v2', 'Reading alpha second.'),
      ...readPair('r3', P1, 'alpha content v3 LATEST', 'Reading alpha latest.'),
      ...editPair('e1', P1, 'Editing alpha.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    const fired = await harness.dispatch([...base, textMessage('Continuing.')])
    const firedMessages = fired!.messages as readonly PiMessageView[]

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    const attempt = attempts[0]!
    expect(attempt.sentRewrite).toBe(true)
    expect(attempt.policy).toBe('v3-verify-window-dedup')
    expect(attempt.trigger).toBe('edit')
    expect(attempt.candidateBlocks).toBe(2)
    expect(attempt.removedBlocks).toBe(2)
    expect(attempt.removedReadTargetHashes).toEqual([readTargetHashOf(P1), readTargetHashOf(P1)])
    expect(attempt.retainedLatestReadTargets).toEqual([readTargetHashOf(P1)])
    // Same composed shape as the v2 test: 10 native - 2 dropped results = 8.
    expect(firedMessages).toHaveLength(8)
    const text = textsOf(firedMessages)
    expect(text).not.toContain('alpha content v1')
    expect(text).not.toContain('alpha content v2')
    expect(text).toContain('alpha content v3 LATEST')
    expect(harness.collector.deferredSweeps).toBe(0)
    expect(harness.collector.dedupRemovals).toBe(0)
  })

  it('(e-1) cap: 14 identical reads -> dedup removes the OLDEST 12; the leftovers wait for the NEXT dedup boundary', async () => {
    const harness = createHarness({ removalPolicy: 'v3-verify-window-dedup' })
    const reads: PiMessageView[] = []
    for (let index = 1; index <= 14; index += 1) {
      const marker = String(index).padStart(2, '0')
      reads.push(...readPair(`r${marker}`, P1, ALPHA, `Bulk read ${marker}.`))
    }
    const base: readonly PiMessageView[] = [userMessage(PROMPT), ...reads]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    expect(harness.collector.interventions).toHaveLength(0)
    // Boundary 1: 13 candidates (r01..r13; r14 is the newest copy), cap 12 =>
    // the OLDEST 12 removed (r01..r12); r13/r14 wait. The identical result
    // content still occurs exactly TWICE (r13 + r14 kept).
    const first = await harness.dispatch([...base, textMessage('Continuing.')])
    const firstText = textsOf(first!.messages as readonly PiMessageView[])
    const firstAttempt = harness.collector.interventions[0]!
    expect(firstAttempt.trigger).toBe('dedup')
    expect(firstAttempt.candidateBlocks).toBe(13)
    expect(firstAttempt.removedBlocks).toBe(12)
    expect(firstAttempt.sentRewrite).toBe(true)
    expect(occurrencesOf(firstText, ALPHA)).toBe(2)
    // Boundary 2: a NEW identical read (r15) opens a fresh dedup boundary; the
    // leftover duplicates (r13, r14 — both duplicated by r15) are removed now,
    // leaving exactly ONE copy of the content (r15's).
    const secondBase: readonly PiMessageView[] = [
      ...base,
      textMessage('Continuing.'),
      ...readPair('r15', P1, ALPHA, 'Bulk read 15.')
    ]
    const second = await harness.dispatch(secondBase)
    const secondText = textsOf(second!.messages as readonly PiMessageView[])
    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(2)
    expect(attempts[1]!.trigger).toBe('dedup')
    expect(attempts[1]!.candidateBlocks).toBe(2)
    expect(attempts[1]!.removedBlocks).toBe(2)
    expect(attempts[1]!.sentRewrite).toBe(true)
    expect(harness.collector.sendsUsed).toBe(2)
    expect(harness.collector.attemptsUsed).toBe(2)
    expect(harness.collector.dedupRemovals).toBe(14)
    expect(occurrencesOf(secondText, ALPHA)).toBe(1)
  })

  it('(e-2) budget bounds: the send bound stops later dedup/edit boundaries from even attempting', async () => {
    const harness = createHarness({
      removalPolicy: 'v3-verify-window-dedup',
      maxInterventions: 1,
      maxAttempts: 2
    })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA, 'Reading alpha.'),
      ...readPair('r1b', P1, ALPHA, 'Re-reading alpha.'),
      ...editPair('e1', P1, 'Editing alpha.'),
      ...readPair('r2', P2, 'beta content', 'Reading beta.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)
    // Event 3: the dedup boundary fires (priority over the same-event edit
    // sweep) and consumes the single allowed send. 10 native messages at this
    // event - 1 dropped duplicate toolResult = 9 composed.
    const fired = await harness.dispatch([...base, textMessage('Continuing.')])
    expect((fired!.messages as readonly PiMessageView[]).length).toBe(9)
    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.trigger).toBe('dedup')
    expect(harness.collector.sendsUsed).toBe(1)
    expect(harness.collector.attemptsUsed).toBe(1)
    // Event 4: an edit boundary for P1 is pending (r1b supersedeable, e1
    // unattempted) but the send bound is exhausted => observe only, no
    // attempt is spent. The carried dedup removal persists (r1's pair stays
    // out of the basis: 10 native - 1 carried = 9).
    const idle = await harness.dispatch([...base, textMessage('Wrapping up.')])
    expect(harness.collector.interventions).toHaveLength(1)
    expect(harness.collector.attemptsUsed).toBe(1)
    expect((idle!.messages as readonly PiMessageView[]).length).toBe(9)
  })

  it('(f) v4 defers a one-candidate edit boundary, then sends one batched rewrite once two stale pairs are eligible', async () => {
    const harness = createHarness({ removalPolicy: 'v4-batched-retain-latest' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, 'alpha content v1', 'Reading alpha first.'),
      ...readPair('r2', P1, 'alpha content v2', 'Reading alpha second.'),
      ...editPair('e1', P1, 'Editing alpha.')
    ]
    await harness.dispatch(base.slice(0, 1))
    await harness.dispatch(base)

    // Only r1 is supersedeable while r2 is retained as the latest read, so the
    // fixed v4 threshold of two candidates holds the pending edit boundary.
    const deferred = await harness.dispatch([...base, textMessage('Continuing.')])
    const deferredEvent = harness.collector.events[2] as ActiveRewriteEventEvidence
    expect(deferredEvent.boundaryReached).toBe(true)
    expect(deferredEvent.interventionAttempted).toBe(false)
    expect(deferredEvent.policy).toBe('v4-batched-retain-latest')
    expect(deferredEvent.trigger).toBe('edit')
    expect(deferredEvent.triggerToolCallId).toBe('e1')
    expect(deferredEvent.candidateBlocks).toBe(1)
    expect(deferredEvent.removedBlocks).toBe(0)
    expect(deferredEvent.deferredByBatchThreshold).toBe(true)
    expect(deferredEvent.batchThreshold).toBe(2)
    expect(harness.collector.batchDeferrals).toBe(1)
    expect(harness.collector.interventions).toHaveLength(0)
    expect(deferred!.messages).toHaveLength(base.length + 1)

    // Re-observing the same boundary while it is still below threshold must
    // not create duplicate deferral evidence or consume an attempt.
    const stillWaiting = await harness.dispatch([...base, textMessage('Still waiting.')])
    expect(stillWaiting!.messages).toHaveLength(base.length + 1)
    expect(harness.collector.batchDeferrals).toBe(1)
    expect(harness.collector.interventions).toHaveLength(0)
    expect(harness.collector.attemptsUsed).toBe(0)

    // A third read makes r1 and r2 eligible while retaining r3. The same edit
    // trigger now fires; the earlier deferral did not consume an attempt.
    const firedInput: readonly PiMessageView[] = [
      ...base,
      textMessage('Continuing.'),
      ...readPair('r3', P1, 'alpha content v3 latest', 'Reading alpha latest.')
    ]
    const fired = await harness.dispatch(firedInput)
    const attempt = harness.collector.interventions[0]!
    expect(attempt.policy).toBe('v4-batched-retain-latest')
    expect(attempt.trigger).toBe('edit')
    expect(attempt.candidateBlocks).toBe(2)
    expect(attempt.removedBlocks).toBe(2)
    expect(attempt.sentRewrite).toBe(true)
    expect(harness.collector.attemptsUsed).toBe(1)
    expect(harness.collector.sendsUsed).toBe(1)
    expect(attempt.removedReadTargetHashes).toEqual([readTargetHashOf(P1), readTargetHashOf(P1)])
    expect(textsOf(fired!.messages as readonly PiMessageView[])).not.toContain('alpha content v1')
    expect(textsOf(fired!.messages as readonly PiMessageView[])).not.toContain('alpha content v2')
    expect(textsOf(fired!.messages as readonly PiMessageView[])).toContain('alpha content v3 latest')

    // M7 measurement repair: the same canonical estimator used by the CR-001
    // observer is recorded on both sides of the SENT rewrite. This proves the
    // rewrite had a measurable model-visible effect at THIS boundary; it does
    // not turn the value into a provider-token or price measurement.
    const firedMessages = fired!.messages as readonly PiMessageView[]
    const sentEvent = harness.collector.events.find((event) => event.sentRewrite)!
    const before = estimatePiMessagesTokenEstimate(firedInput)
    const after = estimatePiMessagesTokenEstimate(firedMessages)
    expect(sentEvent.modelVisibleBeforeTokenEstimate).toBe(before)
    expect(sentEvent.modelVisibleAfterTokenEstimate).toBe(after)
    expect(sentEvent.netModelVisibleTokenReduction).toBe(before - after)
    expect(sentEvent.modelVisibleBeforeMessageCount).toBe(firedInput.length)
    expect(sentEvent.modelVisibleAfterMessageCount).toBe(firedMessages.length)
    expect(attempt.modelVisibleBeforeTokenEstimate).toBe(before)
    expect(attempt.modelVisibleAfterTokenEstimate).toBe(after)
    expect(attempt.netModelVisibleTokenReduction).toBeGreaterThan(0)
  })
})
