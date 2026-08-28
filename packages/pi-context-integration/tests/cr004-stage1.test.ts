import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { type PiMessageView } from '../src'
import {
  createRunKillSwitch,
  detectInterventionBoundary,
  InMemoryActiveRewriteEvidenceCollector,
  createActiveRewriteExtension,
  idleInterventionSummary,
  type ActiveRewriteEventEvidence
} from '../src/experimental'
import { C0ScenarioExecutor } from '../src/smoke/c0-scenarios'
import {
  evaluateS1BudgetStops,
  isValidS1RunId,
  loadC1TaskDefinition,
  S1_BUDGETS,
  S1PairStateMachine,
  scriptedDryRunLegRecords,
  suggestS1RunId,
  type S1Ledgers
} from '../src/smoke/s1-pair-core'

// CR-004 Stage 1 pair runner tests. Offline, credential-free, network-free:
// the pair state machine runs its real transition table, and the Active
// intervention extension is driven through REAL message sequences and the REAL
// policy-v0 planner (C0ScenarioExecutor — the exact wiring the smoke runner
// uses). Provider calls: 0.

const FIXED_NOW = '2026-08-27T00:00:00.000Z'
const RUN_ID = 'cr004-s1-20260827-01234567'
const SYSTEM_INSTRUCTION = 'You are a careful coding agent. Preserve tool continuity.'
const DISCOUNT_PATH = 'src/discount.js'

// ---------------------------------------------------------------------------
// Fake Pi harness: register a factory, then drive its context handler.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Real-shape message fixtures (C1-like: read the file, then edit it).
// ---------------------------------------------------------------------------

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function mixedReadMessage(text: string, callId: string): PiMessageView {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'toolCall', id: callId, name: 'read', arguments: { path: DISCOUNT_PATH } }
    ]
  }
}

function readResultMessage(callId: string, content: string): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text: content }],
    toolCallId: callId,
    toolName: 'read',
    isError: false
  }
}

function mixedEditMessage(text: string, callId: string): PiMessageView {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'toolCall', id: callId, name: 'edit', arguments: { path: DISCOUNT_PATH } }
    ]
  }
}

function toolResultMessage(callId: string, toolName: string, content: string): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text: content }],
    toolCallId: callId,
    toolName,
    isError: false
  }
}

const TASK_PROMPT =
  'Fix the percentage discount calculation in src/discount.js. Preserve the existing validation behavior, run the oracle, and finish with CR-005_STATUS: SUCCESS only after the tests pass.'

const READ_TEXT = 'Let me read the current implementation first.'
const EDIT_TEXT = 'The discount is percentage-based; applying the fix now.'
const READ_CONTENT =
  'function applyDiscount(amount, percent) {\n  return amount - percent\n}\n'

/** Event 1: only the task prompt is in context. */
const EVENT_1: readonly PiMessageView[] = [userMessage(TASK_PROMPT)]
/** Event 2: the read pair has arrived (mixed read call + result). */
const EVENT_2: readonly PiMessageView[] = [
  ...EVENT_1,
  mixedReadMessage(READ_TEXT, 'call-read-1'),
  readResultMessage('call-read-1', READ_CONTENT)
]
/** Event 3: an edit toolCall for the same path has ALREADY appeared. */
const EVENT_3: readonly PiMessageView[] = [
  ...EVENT_2,
  mixedEditMessage(EDIT_TEXT, 'call-edit-1'),
  toolResultMessage('call-edit-1', 'edit', 'edited src/discount.js')
]
/** Event 4: a later model call after the intervention boundary. */
const EVENT_4: readonly PiMessageView[] = [
  ...EVENT_3,
  { role: 'assistant', content: [{ type: 'text', text: 'Running the oracle next.' }] }
]

interface ExtensionHarness {
  readonly dispatch: ReturnType<typeof register>['dispatch']
  readonly collector: InMemoryActiveRewriteEvidenceCollector
  readonly killSwitch: ReturnType<typeof createRunKillSwitch>
}

function createHarness(options: {
  readonly systemInstruction?: string
  readonly killSwitchFilePath?: string
  readonly killSwitch?: ReturnType<typeof createRunKillSwitch>
}): ExtensionHarness {
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${RUN_ID}:active-test`,
    now: () => FIXED_NOW
  })
  const collector = new InMemoryActiveRewriteEvidenceCollector()
  const killSwitch =
    options.killSwitch ?? createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
  const factory = createActiveRewriteExtension({
    runId: RUN_ID,
    systemInstruction: options.systemInstruction ?? SYSTEM_INSTRUCTION,
    executor,
    killSwitch,
    ...(options.killSwitchFilePath !== undefined
      ? { killSwitchFilePath: options.killSwitchFilePath }
      : {}),
    evidence: collector
  })
  return { dispatch: register(factory).dispatch, collector, killSwitch }
}

function blocksOf(message: PiMessageView | undefined): readonly { type: string }[] {
  if (message === undefined || !Array.isArray(message.content)) return []
  return message.content as readonly { type: string }[]
}

// ---------------------------------------------------------------------------
// Run identity (contract section 2)
// ---------------------------------------------------------------------------

describe('S1 run identity', () => {
  it('accepts the cr004-s1-<ISO-date>-<8-hex> format only', () => {
    expect(isValidS1RunId('cr004-s1-20260827-4d7e9a1b')).toBe(true)
    expect(isValidS1RunId('cr004-s1-20260827-00000000')).toBe(true)
    expect(isValidS1RunId('cr004-s1-2026-08-27-4d7e9a1b')).toBe(false) // dashed date
    expect(isValidS1RunId('cr004-s1-20260827-4D7E9A1B')).toBe(false) // uppercase hex
    expect(isValidS1RunId('cr004-s1-20260827-4d7e9a1')).toBe(false) // 7 hex chars
    expect(isValidS1RunId('c0-20260827-4d7e9a1b')).toBe(false) // C0 identity, not S1
    expect(isValidS1RunId(undefined)).toBe(false)
  })

  it('suggests fresh identities matching the pattern', () => {
    for (let index = 0; index < 8; index += 1) {
      expect(isValidS1RunId(suggestS1RunId())).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Pair state machine (contract sections 9-10)
// ---------------------------------------------------------------------------

const ZERO_LEDGERS: S1Ledgers = {
  legsCompleted: 0,
  providerCallRecordsTotal: 0,
  nativeProviderCallRecords: 0,
  activeProviderCallRecords: 0,
  nativeToolCalls: 0,
  activeToolCalls: 0,
  nativeWallClockMs: 0,
  activeWallClockMs: 0,
  runElapsedMs: 0
}

describe('S1 pair state machine', () => {
  it('enforces the fixed Native->Active order', () => {
    const machine = new S1PairStateMachine()
    expect(() => machine.beginLeg('ACTIVE')).toThrow(/NATIVE leg must evidence-close/)
    expect(machine.beginLeg('NATIVE').ok).toBe(true)
    machine.endLeg({ leg: 'NATIVE', providerCallRecords: 5, toolCalls: 5, wallClockMs: 1000 })
    // The single NATIVE leg already completed: a repeat is refused (S-7).
    const repeat = machine.beginLeg('NATIVE')
    expect(repeat.ok).toBe(false)
    if (!repeat.ok) expect(repeat.stop.condition).toBe('S-7')
  })

  it('bars the Active leg when the Native leg exceeded the per-leg provider-call gate', () => {
    const machine = new S1PairStateMachine()
    expect(machine.beginLeg('NATIVE').ok).toBe(true)
    const end = machine.endLeg({
      leg: 'NATIVE',
      providerCallRecords: S1_BUDGETS.maxProviderCallRecordsPerLeg + 1,
      toolCalls: 5,
      wallClockMs: 1000
    })
    expect(end.stop).toBe(true) // S-7 fires at endLeg (per-leg gate breach)
    const begin = machine.beginLeg('ACTIVE')
    expect(begin.ok).toBe(false)
    if (!begin.ok) expect(begin.stop.condition).toBe('S-7')
    expect(machine.isTerminal).toBe(true)
  })

  it('completes a clean pair without firing any stop', () => {
    const machine = new S1PairStateMachine()
    expect(machine.beginLeg('NATIVE').ok).toBe(true)
    expect(machine.endLeg({ leg: 'NATIVE', providerCallRecords: 6, toolCalls: 8, wallClockMs: 2000 }).stop).toBe(false)
    expect(machine.beginLeg('ACTIVE').ok).toBe(true)
    expect(machine.endLeg({ leg: 'ACTIVE', providerCallRecords: 7, toolCalls: 9, wallClockMs: 2500 }).stop).toBe(false)
    expect(machine.legsDone).toBe(2)
    expect(machine.stopsFired).toHaveLength(0)
    expect(machine.isTerminal).toBe(false)
    expect(machine.ledgers().providerCallRecordsTotal).toBe(13)
  })

  it('S-5 semantics: an Active fallback ends Active mode but the run completes', () => {
    const machine = new S1PairStateMachine()
    machine.beginLeg('NATIVE')
    machine.endLeg({ leg: 'NATIVE', providerCallRecords: 6, toolCalls: 8, wallClockMs: 2000 })
    machine.beginLeg('ACTIVE')
    machine.recordActiveFallback('UNEXPLAINED_MEMBERSHIP')
    // The Active leg still evidence-closes (natively) and the run continues.
    expect(
      machine.endLeg({ leg: 'ACTIVE', providerCallRecords: 7, toolCalls: 9, wallClockMs: 2500 }).stop
    ).toBe(false)
    expect(machine.isTerminal).toBe(false)
    expect(machine.legsDone).toBe(2)
    const s5 = machine.stopsFired.find((stop) => stop.condition === 'S-5')
    expect(s5?.scope).toBe('ACTIVE_MODE')
    expect(s5?.reason).toContain('UNEXPLAINED_MEMBERSHIP')
  })

  it('S-8 semantics: an operator kill-switch trip ends Active mode, not the run', () => {
    const machine = new S1PairStateMachine()
    machine.recordKillSwitchTrip('operator kill-switch file present: /tmp/ks')
    expect(machine.isTerminal).toBe(false)
    expect(machine.stopsFired.find((stop) => stop.condition === 'S-8')?.scope).toBe('ACTIVE_MODE')
  })

  it('RUN-scope stops are terminal and refuse further legs', () => {
    const machine = new S1PairStateMachine()
    machine.fireRunStop('S-1', 'PROVIDER_BINDING_FAILURE:provider_unavailable:step-plan/step-3.7-flash')
    expect(machine.isTerminal).toBe(true)
    const begin = machine.beginLeg('NATIVE')
    expect(begin.ok).toBe(false)
    if (!begin.ok) expect(begin.stop.condition).toBe('S-7')
  })
})

describe('S1 budget ledgers (S-7)', () => {
  it('fires exactly at each budget boundary', () => {
    expect(
      evaluateS1BudgetStops({ ...ZERO_LEDGERS, nativeProviderCallRecords: 15 }).stop
    ).toBe(false)
    expect(
      evaluateS1BudgetStops({ ...ZERO_LEDGERS, nativeProviderCallRecords: 16 }).stop
    ).toBe(true)
    expect(evaluateS1BudgetStops({ ...ZERO_LEDGERS, activeToolCalls: 41 }).stop).toBe(true)
    expect(evaluateS1BudgetStops({ ...ZERO_LEDGERS, activeWallClockMs: 120001 }).stop).toBe(true)
    expect(
      evaluateS1BudgetStops({ ...ZERO_LEDGERS, providerCallRecordsTotal: 31 }).stop
    ).toBe(true)
    expect(evaluateS1BudgetStops({ ...ZERO_LEDGERS, legsCompleted: 3 }).stop).toBe(true)
    expect(
      evaluateS1BudgetStops({ ...ZERO_LEDGERS, runElapsedMs: 30 * 60 * 1000 + 1 }).stop
    ).toBe(true)
    expect(evaluateS1BudgetStops({ ...ZERO_LEDGERS, nativeToolCalls: 40 }).stop).toBe(false)
  })

  it('runs the scripted DRY_RUN pair through the machine without stops', () => {
    const machine = new S1PairStateMachine()
    const scripted = scriptedDryRunLegRecords()
    expect(machine.beginLeg('NATIVE').ok).toBe(true)
    expect(
      machine.endLeg({
        leg: 'NATIVE',
        providerCallRecords: scripted.native.recordCount,
        toolCalls: scripted.native.toolCallCount,
        wallClockMs: scripted.native.wallClockMs
      }).stop
    ).toBe(false)
    expect(machine.beginLeg('ACTIVE').ok).toBe(true)
    expect(
      machine.endLeg({
        leg: 'ACTIVE',
        providerCallRecords: scripted.active.recordCount,
        toolCalls: scripted.active.toolCallCount,
        wallClockMs: scripted.active.wallClockMs
      }).stop
    ).toBe(false)
    expect(machine.stopsFired).toHaveLength(0)
    // Stand-in oracles are explicitly marked and carry no pass claim.
    for (const result of [...scripted.native.oracleResults, ...scripted.active.oracleResults]) {
      expect(result.pass).toBeNull()
      expect(result.standIn).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// C1 manifest loader (frozen task definition, read-only)
// ---------------------------------------------------------------------------

describe('S1 C1 task definition loader', () => {
  it('loads and validates the frozen manifest shape', () => {
    const task = loadC1TaskDefinition({
      taskId: 'cr005-c1-localized-bug-fix',
      category: 'C1-localized-bug-fix',
      title: 'Fix the localized percentage discount bug',
      prompt: 'Fix the discount.',
      allowedTools: ['read', 'ls', 'grep', 'find', 'bash', 'edit', 'write'],
      expectedTools: ['read', 'edit', 'bash'],
      expectedWritablePaths: ['src/discount.js'],
      oracle: { command: 'node', args: ['--test', 'test/discount.test.js'], expectedExitCode: 0, timeoutMs: 10000 },
      regressionOracle: { command: 'node', args: ['--test', 'test/regression.test.js'], expectedExitCode: 0, timeoutMs: 10000 },
      budget: { maxSemanticCalls: 12, maxToolCalls: 40, wallClockMs: 120000 }
    })
    expect(task.taskId).toBe('cr005-c1-localized-bug-fix')
    expect(task.oracle.args).toEqual(['--test', 'test/discount.test.js'])
    expect(task.budget.wallClockMs).toBe(120000)
    expect(task.regressionOracle?.command).toBe('node')
  })

  it('rejects malformed manifests', () => {
    expect(() => loadC1TaskDefinition({ taskId: '' })).toThrow(/taskId/)
    expect(() =>
      loadC1TaskDefinition({
        taskId: 't',
        category: 'C1-localized-bug-fix',
        title: 'title',
        prompt: 'prompt',
        allowedTools: ['read'],
        expectedTools: ['read'],
        expectedWritablePaths: ['src/a.js'],
        oracle: { command: 'node' }
      })
    ).toThrow(/oracle\.args/)
  })
})

// ---------------------------------------------------------------------------
// Intervention boundary detection (pure)
// ---------------------------------------------------------------------------

describe('detectInterventionBoundary', () => {
  it('fires only when a prior read of the same path has its result in context', () => {
    const boundary = detectInterventionBoundary(EVENT_3)
    expect(boundary).toBeDefined()
    expect(boundary?.path).toBe(DISCOUNT_PATH)
    expect(boundary?.editToolCallId).toBe('call-edit-1')
    expect(boundary?.readToolCallIds).toEqual(['call-read-1'])
  })

  it('does not fire before the edit appears, without reads, or without results', () => {
    expect(detectInterventionBoundary(EVENT_1)).toBeUndefined()
    expect(detectInterventionBoundary(EVENT_2)).toBeUndefined()
    // Edit for a different path than the read.
    const otherPath: readonly PiMessageView[] = [
      userMessage(TASK_PROMPT),
      mixedReadMessage(READ_TEXT, 'call-read-1'),
      readResultMessage('call-read-1', READ_CONTENT),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Unrelated edit.' },
          { type: 'toolCall', id: 'call-edit-2', name: 'edit', arguments: { path: 'src/other.js' } }
        ]
      },
      toolResultMessage('call-edit-2', 'edit', 'edited src/other.js')
    ]
    expect(detectInterventionBoundary(otherPath)).toBeUndefined()
    // Read call whose result never arrived.
    const noResult: readonly PiMessageView[] = [
      ...EVENT_1,
      mixedReadMessage(READ_TEXT, 'call-read-1'),
      mixedEditMessage(EDIT_TEXT, 'call-edit-1')
    ]
    expect(detectInterventionBoundary(noResult)).toBeUndefined()
  })

  it('normalizes ./-prefixed paths when matching read to edit', () => {
    const messages: readonly PiMessageView[] = [
      userMessage(TASK_PROMPT),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: READ_TEXT },
          { type: 'toolCall', id: 'r1', name: 'read', arguments: { path: `./${DISCOUNT_PATH}` } }
        ]
      },
      readResultMessage('r1', READ_CONTENT),
      mixedEditMessage(EDIT_TEXT, 'call-edit-1'),
      toolResultMessage('call-edit-1', 'edit', 'edited')
    ]
    expect(detectInterventionBoundary(messages)?.readToolCallIds).toEqual(['r1'])
  })
})

// ---------------------------------------------------------------------------
// Active intervention extension through the REAL planner (offline)
// ---------------------------------------------------------------------------

describe('CR-004 Stage 1: Active intervention extension (real planner, offline)', () => {
  it('observes early events natively and fires the rewrite at the read->edit boundary', async () => {
    const harness = createHarness({})
    const first = await harness.dispatch(EVENT_1)
    expect(first?.messages).toBe(EVENT_1 as unknown as unknown[])
    const second = await harness.dispatch(EVENT_2)
    expect(second?.messages).toBe(EVENT_2 as unknown as unknown[])

    const third = await harness.dispatch(EVENT_3)
    expect(third?.messages).toBeDefined()
    const sent = third!.messages as readonly PiMessageView[]
    // THE FIRST ACTIVE REWRITE: the read RESULT message is gone, the mixed
    // read message survives with its text only (Stage 0 amendment), the edit
    // pair stays untouched.
    expect(sent).toHaveLength(4)
    expect(sent[0]).toBe(EVENT_3[0]) // user prompt kept by reference
    const rewrittenRead = sent[1]!
    expect(rewrittenRead.role).toBe('assistant')
    const blocks = blocksOf(rewrittenRead)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('text')
    expect(sent[2]).toBe(EVENT_3[3]) // mixed edit message kept by reference
    expect(sent[3]).toBe(EVENT_3[4]) // edit result kept by reference
    // No message carries the removed read result anymore.
    expect(sent.includes(EVENT_3[2]!)).toBe(false)

    const intervention = harness.collector.intervention
    expect(intervention.compositionVerdict).toBe('REWRITE_READY')
    expect(intervention.guardVerdict).toBe('PASS')
    expect(intervention.sentRewrite).toBe(true)
    expect(intervention.boundarySequence).toBe(3)
    expect(intervention.interventionPath).toBe(DISCOUNT_PATH)
    expect(intervention.toolBlocksRemoved).toBe(1)
    expect([...intervention.removedSourceKeys]).toEqual([
      'run/tool-call://call-read-1',
      'run/tool-result://call-read-1'
    ])
    expect(intervention.bindingHashes?.compositionHash).toMatch(/^[0-9a-f]{64}$/)
    // Per-event evidence: three events recorded, kill switch never tripped.
    const events = harness.collector.events
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(events.every((event) => !event.killSwitchTripped)).toBe(true)
    const last = events[events.length - 1] as ActiveRewriteEventEvidence
    expect(last.boundaryReached).toBe(true)
    expect(last.composedMessageCount).toBe(4)
  })

  it('latches after the intervention: later events observe only and the removal carries', async () => {
    const harness = createHarness({})
    await harness.dispatch(EVENT_1)
    await harness.dispatch(EVENT_2)
    const third = await harness.dispatch(EVENT_3)
    expect((third!.messages as readonly PiMessageView[]).length).toBe(4)
    const fourth = await harness.dispatch(EVENT_4)
    // Matrix upgrade (carried rewrite): after the SENT rewrite, later events
    // make no NEW decision (no attempt) but keep the removed read pair out of
    // the model-visible basis: the EVENT_3 composition + the new message.
    const fourthMessages = fourth!.messages as readonly PiMessageView[]
    expect(fourthMessages).toHaveLength(5)
    const sentThird = third!.messages as readonly PiMessageView[]
    for (let index = 0; index < 4; index += 1) {
      // Untouched messages pass through by reference; the trimmed mixed read
      // message is rebuilt with identical content.
      expect(fourthMessages[index]).toStrictEqual(sentThird[index])
    }
    expect(fourthMessages[4]).toBe(EVENT_4[5]) // the newly appended message
    const fourthEvidence = harness.collector.events[3]!
    expect(fourthEvidence.boundaryReached).toBe(false)
    expect(fourthEvidence.interventionAttempted).toBe(false)
    // The intervention summary is latched at the boundary event, not updated.
    expect(harness.collector.intervention.boundarySequence).toBe(3)
    expect(harness.collector.intervention.latchSetAtSequence).toBe(3)
  })

  it('trips the run kill switch from the operator file and never intervenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-s1-ks-'))
    const killSwitchFile = join(dir, 'kill-switch')
    try {
      await writeFile(killSwitchFile, 'operator stop\n', 'utf8')
      const harness = createHarness({ killSwitchFilePath: killSwitchFile })
      const first = await harness.dispatch(EVENT_1)
      expect(first?.messages).toBe(EVENT_1 as unknown as unknown[])
      expect(harness.killSwitch.isTripped).toBe(true)
      expect(harness.killSwitch.tripRecord?.reason).toContain('operator kill-switch file')
      // The boundary never fires while the switch is tripped.
      const third = await harness.dispatch(EVENT_3)
      expect(third?.messages).toBe(EVENT_3 as unknown as unknown[])
      expect(harness.collector.intervention).toEqual(idleInterventionSummary())
      expect(harness.collector.events.every((event) => event.killSwitchTripped)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records a composition fallback with its reason, latches, and continues natively', async () => {
    // A missing system instruction forces FALLBACK_NATIVE at the boundary:
    // the reason is recorded, the latch sets, the originals are returned.
    const harness = createHarness({ systemInstruction: '' })
    await harness.dispatch(EVENT_1)
    await harness.dispatch(EVENT_2)
    const third = await harness.dispatch(EVENT_3)
    expect(third?.messages).toBe(EVENT_3 as unknown as unknown[])
    const intervention = harness.collector.intervention
    expect(intervention.compositionVerdict).toBe('FALLBACK_NATIVE')
    expect(intervention.fallbackReason).toBe('SYSTEM_INSTRUCTION_ABSENT')
    expect(intervention.sentRewrite).toBe(false)
    expect(intervention.guardVerdict).toBe('NOT_ATTEMPTED')
    expect(intervention.latchSetAtSequence).toBe(3)
    const fourth = await harness.dispatch(EVENT_4)
    expect(fourth?.messages).toBe(EVENT_4 as unknown as unknown[])
    expect(harness.collector.events[3]!.interventionAttempted).toBe(false)
  })

  it('waits when the read pair is not yet active in the planned Working Set', async () => {
    // The read pair and the edit appear in the SAME context event: the read
    // sources are not yet in a previous Working Set, so policy-v0 could not
    // REMOVE them. The boundary must wait rather than waste the attempt.
    const harness = createHarness({})
    const first = await harness.dispatch(EVENT_1)
    expect(first?.messages).toBe(EVENT_1 as unknown as unknown[])
    const burst = await harness.dispatch(EVENT_3)
    expect(burst?.messages).toBe(EVENT_3 as unknown as unknown[])
    expect(harness.collector.events[1]!.boundaryReached).toBe(false)
    // After the burst event planned the read pair, the NEXT event fires.
    const third = await harness.dispatch(EVENT_4)
    const sent = third?.messages as readonly PiMessageView[] | undefined
    expect(sent).toBeDefined()
    expect(sent!.length).toBeLessThan(EVENT_4.length)
    expect(harness.collector.intervention.sentRewrite).toBe(true)
    expect(harness.collector.intervention.boundarySequence).toBe(3)
  })
})
