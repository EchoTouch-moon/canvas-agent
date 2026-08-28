import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { type PiMessageView } from '../src'
import {
  createRunKillSwitch,
  createActiveRewriteExtension,
  InMemoryActiveRewriteEvidenceCollector,
  readTargetHashOf,
  type ActiveRewriteEventEvidence
} from '../src/experimental'
import { C0ScenarioExecutor } from '../src/smoke/c0-scenarios'
import {
  aggregateMxCells,
  analyzeMatrix,
  detectReReads,
  dropAtBoundaryOf,
  evaluateMxLegBudgetStop,
  exactPermutationTest,
  isM3MxRunId,
  isValidMxRunId,
  MatrixStateMachine,
  MxConfigError,
  MX_BUDGETS,
  mxCellOneLiner,
  mxLegAnalysisInputOf,
  mxLegDirName,
  mxLegOrder,
  type MxLegPlan,
  MX_RUN_ID_PATTERN,
  mxPermutationTests,
  mxShapeFromEnv,
  mxTotalLegsOf,
  MX_TOTAL_LEGS,
  mxVerdictOf,
  parseMxRepetitionsEnv,
  parseMxTasksEnv,
  resolveMxTasks,
  scriptedMxLegRecords,
  scriptedMxObservations,
  suggestMxRunId,
  trajectorySummaryOf,
  writeMxAggregate,
  writeMxLegEvidence,
  writeMxManifest,
  type MxLegLedger,
  type MxMatrixShape
} from '../src/smoke/matrix-core'

// CR-004 Stage 1 MATRIX runner tests. Offline, credential-free, network-free:
// the matrix state machine runs its real transition table, the incremental
// evidence writers write real files to temp dirs, the aggregator/analyzer runs
// over real leg records, and the multi-intervention Active extension is driven
// through REAL message sequences and the REAL policy-v0 planner. Provider
// calls: 0.

const FIXED_NOW = '2026-08-27T00:00:00.000Z'
const RUN_ID = 'cr004-m1-20260827-01234567'

/** The historical M2 design (M2-era evidence dirs must still analyze). */
const M2_SHAPE: MxMatrixShape = {
  tasks: ['L1', 'L2', 'L3'],
  strategies: ['NATIVE', 'ACTIVE', 'ACTIVE_V2'],
  repetitions: 3
}
/** The historical M1 design (M1-era evidence dirs must still analyze). */
const M1_SHAPE: MxMatrixShape = {
  tasks: ['L1', 'L2', 'L3'],
  strategies: ['NATIVE', 'ACTIVE'],
  repetitions: 3
}
/** The targeted M3 shape the contract's first run uses (L2-only, 4 reps). */
const M3_L2_SHAPE: MxMatrixShape = {
  tasks: ['L2'],
  strategies: ['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'],
  repetitions: 4
}

// ---------------------------------------------------------------------------
// Multi-intervention Active extension (real planner, offline)
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

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function mixedToolCallMessage(
  text: string,
  callId: string,
  name: 'read' | 'edit',
  path: string
): PiMessageView {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'toolCall', id: callId, name, arguments: { path } }
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

const PROMPT = 'Refactor the module per the task manifest.'
const P1 = 'src/alpha.ts'
const P2 = 'src/beta.ts'
const P3 = 'src/gamma.ts'
const FILE_BODY = 'export const value = 1\n'

/** Three read->edit boundaries across three distinct paths. */
const E1: readonly PiMessageView[] = [userMessage(PROMPT)]
const E2: readonly PiMessageView[] = [
  ...E1,
  mixedToolCallMessage('Reading alpha.', 'r1', 'read', P1),
  toolResultMessage('r1', 'read', FILE_BODY)
]
const E3: readonly PiMessageView[] = [
  ...E2,
  mixedToolCallMessage('Editing alpha.', 'e1', 'edit', P1),
  toolResultMessage('e1', 'edit', `edited ${P1}`)
]
const E4: readonly PiMessageView[] = [
  ...E3,
  mixedToolCallMessage('Reading beta.', 'r2', 'read', P2),
  toolResultMessage('r2', 'read', FILE_BODY)
]
const E5: readonly PiMessageView[] = [
  ...E4,
  mixedToolCallMessage('Editing beta.', 'e2', 'edit', P2),
  toolResultMessage('e2', 'edit', `edited ${P2}`)
]
const E6: readonly PiMessageView[] = [
  ...E5,
  mixedToolCallMessage('Reading gamma.', 'r3', 'read', P3),
  toolResultMessage('r3', 'read', FILE_BODY)
]
const E7: readonly PiMessageView[] = [
  ...E6,
  mixedToolCallMessage('Editing gamma.', 'e3', 'edit', P3),
  toolResultMessage('e3', 'edit', `edited ${P3}`)
]
const E8: readonly PiMessageView[] = [
  ...E7,
  { role: 'assistant', content: [{ type: 'text', text: 'Running the oracle next.' }] }
]

function createHarness(options: {
  readonly systemInstruction?: string
  readonly maxInterventions?: number
  readonly maxAttempts?: number
}) {
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${RUN_ID}:mx-test`,
    now: () => FIXED_NOW
  })
  const collector = new InMemoryActiveRewriteEvidenceCollector()
  const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
  const factory = createActiveRewriteExtension({
    runId: RUN_ID,
    systemInstruction: options.systemInstruction ?? 'You are a careful coding agent.',
    executor,
    killSwitch,
    evidence: collector,
    ...(options.maxInterventions !== undefined ? { maxInterventions: options.maxInterventions } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {})
  })
  return { dispatch: register(factory).dispatch, collector, killSwitch }
}

describe('readTargetHashOf', () => {
  it('is the first 16 hex chars of sha256 over the path', () => {
    const expected = createHash('sha256').update(P1, 'utf8').digest('hex').slice(0, 16)
    expect(readTargetHashOf(P1)).toBe(expected)
    expect(readTargetHashOf(P1)).toHaveLength(16)
    expect(readTargetHashOf('./src/alpha.ts')).toBe(readTargetHashOf(P1))
  })
})

describe('multi-intervention Active extension (real planner, offline)', () => {
  it('sends a SECOND intervention at a NEW boundary and records per-attempt telemetry', async () => {
    const harness = createHarness({})
    await harness.dispatch(E1)
    await harness.dispatch(E2)
    const third = await harness.dispatch(E3)
    expect((third!.messages as readonly PiMessageView[]).length).toBeLessThan(E3.length)
    const fourth = await harness.dispatch(E4)
    // Carried rewrite: the removed r1 pair stays out of the model-visible
    // basis (E4 native 7 -> basis 6); no new boundary observes only.
    const fourthMessages = fourth!.messages as readonly PiMessageView[]
    expect(fourthMessages).toHaveLength(6)
    expect(fourthMessages.includes(E4[2]!)).toBe(false) // r1 result dropped
    const fifth = await harness.dispatch(E5)
    expect((fifth!.messages as readonly PiMessageView[]).length).toBeLessThan(E5.length)

    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(2)
    expect(attempts.every((attempt) => attempt.sentRewrite && attempt.guardVerdict === 'PASS')).toBe(true)
    expect(attempts[0]!.interventionPath).toBe(P1)
    expect(attempts[1]!.interventionPath).toBe(P2)
    expect(attempts[0]!.interventionIndex).toBe(1)
    expect(attempts[1]!.interventionIndex).toBe(2)
    expect(attempts.map((attempt) => attempt.attemptOutcome)).toEqual(['SENT', 'SENT'])
    expect(harness.collector.sendsUsed).toBe(2)
    expect(harness.collector.attemptsUsed).toBe(2)
    // Removed read-target hashes per intervention (privacy-safe).
    expect(attempts[0]!.removedReadTargetHashes).toEqual([readTargetHashOf(P1)])
    expect(attempts[1]!.removedReadTargetHashes).toEqual([readTargetHashOf(P2)])
    // Legacy first-intervention accessor stays compatible.
    expect(harness.collector.intervention.interventionPath).toBe(P1)

    // Read-target telemetry: the reads observed at their first events so far.
    const readEvents = harness.collector.events.filter(
      (event) => (event.readTargets ?? []).length > 0
    ) as ActiveRewriteEventEvidence[]
    expect(readEvents.map((event) => event.sequence)).toEqual([2, 4])
    expect(readEvents[0]!.readTargets).toEqual([
      { toolCallId: 'r1', readTargetHash: readTargetHashOf(P1) }
    ])
    expect(readEvents[1]!.readTargets).toEqual([
      { toolCallId: 'r2', readTargetHash: readTargetHashOf(P2) }
    ])

    const sixth = await harness.dispatch(E6)
    // Both removals carried: E6 native 11 -> basis 9 (two paired toolResult
    // messages dropped, both mixed read messages trimmed), no new attempt.
    expect((sixth!.messages as readonly PiMessageView[]).length).toBe(9)
    expect(harness.collector.interventions).toHaveLength(2)
  })

  it('bounds SENT rewrites at maxInterventions while later boundaries observe only', async () => {
    const harness = createHarness({ maxInterventions: 1 })
    await harness.dispatch(E1)
    await harness.dispatch(E2)
    await harness.dispatch(E3)
    await harness.dispatch(E4)
    const fifth = await harness.dispatch(E5)
    // The send bound blocks any attempt; the r1 removal still carries.
    expect((fifth!.messages as readonly PiMessageView[]).length).toBe(8)
    expect(harness.collector.interventions).toHaveLength(1)
    expect(harness.collector.sendsUsed).toBe(1)
  })

  it('bounds composition ATTEMPTS at maxAttempts; fallbacks consume attempts at NEW boundaries only', async () => {
    // Empty system instruction forces a deterministic composition fallback.
    const harness = createHarness({ systemInstruction: '', maxAttempts: 2 })
    await harness.dispatch(E1)
    await harness.dispatch(E2)
    await harness.dispatch(E3)
    await harness.dispatch(E4)
    const fifth = await harness.dispatch(E5)
    expect(fifth?.messages).toBe(E5 as unknown as unknown[])
    await harness.dispatch(E6)
    const seventh = await harness.dispatch(E7)
    // Third boundary: the attempt budget is exhausted, no attempt is made.
    expect(seventh?.messages).toBe(E7 as unknown as unknown[])
    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(2)
    expect(attempts.every((attempt) => attempt.attemptOutcome === 'FALLBACK')).toBe(true)
    expect(attempts.map((attempt) => attempt.fallbackReason)).toEqual([
      'SYSTEM_INSTRUCTION_ABSENT',
      'SYSTEM_INSTRUCTION_ABSENT'
    ])
    expect(harness.collector.attemptsUsed).toBe(2)
    expect(harness.collector.sendsUsed).toBe(0)
    const seventhEvidence = harness.collector.events[6]!
    expect(seventhEvidence.interventionAttempted).toBe(false)
  })

  it('never re-attempts the same boundary, and a RE-READ of a removed target opens a NEW boundary', async () => {
    const harness = createHarness({})
    await harness.dispatch(E1)
    await harness.dispatch(E2)
    await harness.dispatch(E3) // intervention 1 on e1/r1
    // E3 again (same boundary): observe only, no second attempt on e1; the
    // carried basis (4 messages) is returned instead of the native 5.
    const again = await harness.dispatch(E3)
    expect((again!.messages as readonly PiMessageView[]).length).toBe(4)
    expect(harness.collector.interventions).toHaveLength(1)
    // A RE-READ of the removed target P1 followed by a NEW edit of P1 is a NEW
    // boundary (fresh read pair, fresh edit call). The read pair must first be
    // observed by an event before the boundary can fire at the NEXT one.
    const reRead: readonly PiMessageView[] = [
      ...E3,
      mixedToolCallMessage('Re-reading alpha.', 'r1b', 'read', P1),
      toolResultMessage('r1b', 'read', FILE_BODY),
      mixedToolCallMessage('Editing alpha again.', 'e1b', 'edit', P1),
      toolResultMessage('e1b', 'edit', `edited ${P1} again`)
    ]
    const waiting = await harness.dispatch(reRead)
    // The fresh read pair is not yet in a planned Working Set: no attempt yet.
    expect(harness.collector.interventions).toHaveLength(1)
    expect((waiting!.messages as readonly PiMessageView[]).length).toBe(8)
    const followUp: readonly PiMessageView[] = [
      ...reRead,
      { role: 'assistant', content: [{ type: 'text', text: 'Continuing.' }] }
    ]
    const fired = await harness.dispatch(followUp)
    expect((fired!.messages as readonly PiMessageView[]).length).toBeLessThan(followUp.length)
    const attempts = harness.collector.interventions
    expect(attempts).toHaveLength(2)
    expect(attempts[1]!.interventionPath).toBe(P1)
    expect(attempts[1]!.removedReadTargetHashes).toEqual([readTargetHashOf(P1)])
    // The re-read hash equals the removed hash from intervention 1: the
    // analyzer's re-read detection sees exactly this pairing.
    expect(attempts[1]!.removedReadTargetHashes[0]).toBe(attempts[0]!.removedReadTargetHashes[0])
  })
})

// ---------------------------------------------------------------------------
// Run identity + leg order
// ---------------------------------------------------------------------------

describe('MX run identity and leg order', () => {
  it('accepts exactly the REGISTERED series (m1..m5); unregistered m6+ are refused', () => {
    expect(isValidMxRunId('cr004-m1-20260826-d23a992c')).toBe(true)
    expect(isValidMxRunId('cr004-m2-20260827-4d7e9a1b')).toBe(true)
    expect(isValidMxRunId('cr004-m3-20260827-4d7e9a1b')).toBe(true)
    expect(isValidMxRunId('cr004-m4-20260827-4d7e9a1b')).toBe(true)
    // The old open m[1-9] pattern accepted series with NO contract; the
    // profile registry refuses them until one is deliberately added (M5
    // became deliberate with the pre-registered replication contract).
    expect(isValidMxRunId('cr004-m5-20260828-4d7e9a1b')).toBe(true)
    expect(isValidMxRunId('cr004-m6-20260901-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-m9-20260901-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-s1-20260827-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-m0-20260827-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-m3-2026-08-27-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-m3-20260827-4D7E9A1B')).toBe(false)
    expect(isValidMxRunId(undefined)).toBe(false)
    // Suggestions come from the LATEST registered profile (M5 pre-registered replication).
    for (let index = 0; index < 8; index += 1) {
      const suggested = suggestMxRunId()
      expect(MX_RUN_ID_PATTERN.test(suggested)).toBe(true)
      expect(/^cr004-m5-\d{8}-[0-9a-f]{8}$/.test(suggested)).toBe(true)
    }
    expect(isM3MxRunId('cr004-m2-20260827-4d7e9a1b')).toBe(false)
  })

  it('orders the 27-leg M3 default: rep-major, per task NATIVE, ACTIVE_V2, ACTIVE_V3, deterministic', () => {
    const order = mxLegOrder()
    expect(order).toHaveLength(MX_TOTAL_LEGS)
    expect(MX_TOTAL_LEGS).toBe(27)
    expect(order).toEqual(mxLegOrder())
    expect(order.slice(0, 9).map(mxLegDirName)).toEqual([
      'L1-NATIVE-rep1',
      'L1-ACTIVE2-rep1',
      'L1-ACTIVE3-rep1',
      'L2-NATIVE-rep1',
      'L2-ACTIVE2-rep1',
      'L2-ACTIVE3-rep1',
      'L3-NATIVE-rep1',
      'L3-ACTIVE2-rep1',
      'L3-ACTIVE3-rep1'
    ])
    expect(order[9]!.rep).toBe(2)
    expect(order[26]).toEqual({ legIndex: 26, task: 'L3', strategy: 'ACTIVE_V3', rep: 3 })
    // Every (task, strategy, rep) cell exactly once (dir names use ACTIVE2/
    // ACTIVE3 for the ACTIVE_V2/ACTIVE_V3 arms).
    const keys = new Set(order.map((plan) => mxLegDirName(plan)))
    expect(keys.size).toBe(MX_TOTAL_LEGS)
    for (const plan of order) {
      expect(keys.has(mxLegDirName(plan))).toBe(true)
    }
    expect(keys.has('L1-ACTIVE2-rep3')).toBe(true)
    expect(keys.has('L1-ACTIVE3-rep1')).toBe(true)
    expect(keys.has('L1-ACTIVE-rep1')).toBe(false)
    expect(keys.has('L1-ACTIVE_V3-rep1')).toBe(false)
  })

  it('orders historical shapes exactly as M1/M2 did (analysis compat)', () => {
    const m1 = mxLegOrder(M1_SHAPE)
    expect(m1).toHaveLength(18)
    expect(m1.slice(0, 6).map(mxLegDirName)).toEqual([
      'L1-NATIVE-rep1',
      'L1-ACTIVE-rep1',
      'L2-NATIVE-rep1',
      'L2-ACTIVE-rep1',
      'L3-NATIVE-rep1',
      'L3-ACTIVE-rep1'
    ])
    const m2 = mxLegOrder(M2_SHAPE)
    expect(m2).toHaveLength(27)
    expect(m2.slice(0, 3).map(mxLegDirName)).toEqual([
      'L1-NATIVE-rep1',
      'L1-ACTIVE-rep1',
      'L1-ACTIVE2-rep1'
    ])
    expect(m2[26]).toEqual({ legIndex: 26, task: 'L3', strategy: 'ACTIVE_V2', rep: 3 })
  })

  it('shapes a targeted run from the env: TASKS=L2 REPS=4 => 12 legs; validation refuses bad values', () => {
    expect(mxShapeFromEnv({})).toEqual({
      tasks: ['L1', 'L2', 'L3'],
      strategies: ['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'],
      repetitions: 3,
      armOrder: 'canonical'
    })
    expect(mxTotalLegsOf(mxShapeFromEnv({ tasks: 'L2', reps: '4' }))).toBe(12)
    const targeted = mxLegOrder(M3_L2_SHAPE)
    expect(targeted).toHaveLength(12)
    expect(targeted.slice(0, 3).map(mxLegDirName)).toEqual([
      'L2-NATIVE-rep1',
      'L2-ACTIVE2-rep1',
      'L2-ACTIVE3-rep1'
    ])
    expect(targeted[11]).toEqual({ legIndex: 11, task: 'L2', strategy: 'ACTIVE_V3', rep: 4 })
    // Canonical task order regardless of listing order; whitespace tolerated.
    expect(parseMxTasksEnv('L3, L1')).toEqual(['L1', 'L3'])
    // Validation: unknown slot, duplicates, empty list, bad reps, out of range.
    expect(() => parseMxTasksEnv('L4')).toThrow(MxConfigError)
    expect(() => parseMxTasksEnv('L2,L2')).toThrow(/duplicate/)
    expect(() => parseMxTasksEnv(' , ')).toThrow(/CANVAS_MX_TASKS/)
    expect(parseMxTasksEnv(undefined)).toEqual(['L1', 'L2', 'L3'])
    expect(parseMxRepetitionsEnv(undefined)).toBe(3)
    expect(parseMxRepetitionsEnv('1')).toBe(1)
    expect(parseMxRepetitionsEnv('8')).toBe(8)
    expect(() => parseMxRepetitionsEnv('0')).toThrow(/out of range/)
    expect(() => parseMxRepetitionsEnv('9')).toThrow(/out of range/)
    expect(() => parseMxRepetitionsEnv('three')).toThrow(/CANVAS_MX_REPS/)
  })
})

// ---------------------------------------------------------------------------
// Matrix state machine: totals stop, watchdog, continue-on-leg-failure
// ---------------------------------------------------------------------------

function legLedger(legIndex: number, providerCallRecords: number, status: 'COMPLETED' | 'FAILED' = 'COMPLETED', order: readonly MxLegPlan[] = mxLegOrder()): MxLegLedger {
  const plan = order[legIndex]!
  return {
    legIndex,
    task: plan.task,
    strategy: plan.strategy,
    rep: plan.rep,
    status,
    providerCallRecords,
    toolCalls: 5,
    wallClockMs: 1000,
    oraclePass: status === 'COMPLETED',
    stopCondition: null
  }
}

describe('MX matrix state machine', () => {
  it('stops launching legs at the 900-record matrix total (S-7), evidence preserved', () => {
    const shape = mxShapeFromEnv({ reps: '4' })
    const machine = new MatrixStateMachine({ maxLegs: mxTotalLegsOf(shape) })
    // 36-leg shape (all tasks, all arms, 4 reps); 34 legs x 26 records = 884:
    // under the 900 budget; leg 35 (910 total) pushes over and fires S-7.
    const order = mxLegOrder(shape)
    for (let index = 0; index < 34; index += 1) {
      expect(machine.beginLeg(order[index]!).ok).toBe(true)
      expect(machine.endLeg(legLedger(index, 26, 'COMPLETED', order)).stop).toBe(false)
    }
    expect(machine.beginLeg(order[34]!).ok).toBe(true)
    const end = machine.endLeg(legLedger(34, 26, 'COMPLETED', order))
    expect(end.stop).toBe(true)
    expect(machine.isTerminal).toBe(true)
    // No new legs launch; the 35 recorded legs stay preserved in the ledgers.
    const refused = machine.beginLeg(order[35]!)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.stop.condition).toBe('S-7')
    expect(machine.ledgers().legsAttempted).toBe(35)
    expect(machine.ledgers().providerCallRecordsTotal).toBe(910)
    expect(machine.stopsFired[0]!.condition).toBe('S-7')
  })

  it('refuses to launch beyond the 27-leg matrix budget (S-7)', () => {
    const machine = new MatrixStateMachine()
    for (let index = 0; index < MX_TOTAL_LEGS; index += 1) {
      expect(machine.beginLeg(mxLegOrder()[index]!).ok).toBe(true)
      machine.endLeg(legLedger(index, 5))
    }
    const refused = machine.beginLeg({
      legIndex: MX_TOTAL_LEGS,
      task: 'L1',
      strategy: 'NATIVE',
      rep: 4
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.stop.condition).toBe('S-7')
      expect(refused.stop.reason).toContain('leg budget exhausted')
    }
  })

  it('counts per-arm oracle passes separately across the arms', () => {
    const machine = new MatrixStateMachine()
    const ledgerFor = (legIndex: number, pass: boolean): MxLegLedger => ({
      ...legLedger(legIndex, 5),
      oraclePass: pass
    })
    machine.beginLeg(mxLegOrder()[0]!)
    machine.endLeg(ledgerFor(0, true)) // L1 NATIVE rep1
    machine.beginLeg(mxLegOrder()[1]!)
    machine.endLeg(ledgerFor(1, true)) // L1 ACTIVE_V2 rep1
    machine.beginLeg(mxLegOrder()[2]!)
    machine.endLeg(ledgerFor(2, false)) // L1 ACTIVE_V3 rep1
    const ledgers = machine.ledgers()
    expect(ledgers.oraclePassNative).toBe(1)
    expect(ledgers.oraclePassActive).toBe(0)
    expect(ledgers.oraclePassActiveV2).toBe(1)
    expect(ledgers.oraclePassActiveV3).toBe(0)
  })

  it('scales the leg-count bound with a configured shape (targeted 12-leg run)', () => {
    const machine = new MatrixStateMachine({ maxLegs: 12 })
    const order = mxLegOrder(M3_L2_SHAPE)
    for (const plan of order) {
      expect(machine.beginLeg(plan).ok).toBe(true)
      machine.endLeg(legLedger(plan.legIndex, 5))
    }
    const refused = machine.beginLeg({
      legIndex: 12,
      task: 'L2',
      strategy: 'NATIVE',
      rep: 5
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.stop.condition).toBe('S-7')
      expect(refused.stop.reason).toContain('leg budget exhausted')
    }
  })

  it('stops launching legs when the 180-minute watchdog is exceeded', () => {
    let clock = 0
    const machine = new MatrixStateMachine({ now: () => clock })
    expect(machine.beginLeg(mxLegOrder()[0]!).ok).toBe(true)
    machine.endLeg(legLedger(0, 5))
    clock = MX_BUDGETS.runWallClockMs + 1
    const refused = machine.beginLeg(mxLegOrder()[1]!)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.stop.condition).toBe('S-7')
      expect(refused.stop.reason).toContain('wall-clock')
    }
    expect(machine.isTerminal).toBe(true)
  })

  it('continues to the next leg after a leg-level failure (no matrix stop)', () => {
    const machine = new MatrixStateMachine()
    expect(machine.beginLeg(mxLegOrder()[0]!).ok).toBe(true)
    const end = machine.endLeg({
      ...legLedger(0, 5),
      status: 'FAILED',
      oraclePass: false,
      stopCondition: { condition: 'S-9', reason: 'leg provider failure: simulated' }
    })
    expect(end.stop).toBe(false)
    expect(machine.isTerminal).toBe(false)
    expect(machine.beginLeg(mxLegOrder()[1]!).ok).toBe(true)
    machine.endLeg(legLedger(1, 5))
    expect(machine.ledgers().legsAttempted).toBe(2)
    expect(machine.ledgers().legsFailed).toBe(1)
    expect(machine.ledgers().legsCompleted).toBe(1)
    expect(machine.stopsFired).toHaveLength(0)
  })

  it('a TIMED_OUT leg (S-9 leg deadline exceeded; session aborted in-flight) does not terminal-stop the matrix', () => {
    const machine = new MatrixStateMachine()
    expect(machine.beginLeg(mxLegOrder()[0]!).ok).toBe(true)
    const end = machine.endLeg({
      ...legLedger(0, 5),
      status: 'FAILED',
      oraclePass: null,
      stopCondition: {
        condition: 'S-9',
        reason: 'leg deadline exceeded; session aborted in-flight (leg deadline exceeded after 660000ms; session aborted in-flight)'
      }
    })
    // The deadline failure is LEG-level: the matrix CONTINUES to the next leg.
    expect(end.stop).toBe(false)
    expect(machine.isTerminal).toBe(false)
    expect(machine.beginLeg(mxLegOrder()[1]!).ok).toBe(true)
    machine.endLeg(legLedger(1, 5))
    expect(machine.ledgers().legsAttempted).toBe(2)
    expect(machine.ledgers().legsFailed).toBe(1)
    expect(machine.stopsFired).toHaveLength(0)
  })

  it('S-1 binding failure is matrix-terminal and refuses every leg', () => {
    const machine = new MatrixStateMachine()
    machine.fireMatrixStop('S-1', 'PROVIDER_BINDING_FAILURE:provider_unavailable')
    expect(machine.isTerminal).toBe(true)
    const refused = machine.beginLeg(mxLegOrder()[0]!)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.stop.condition).toBe('S-7')
    expect(machine.stopsFired.map((stop) => stop.condition)).toEqual(['S-1', 'S-7'])
  })

  it('per-leg manifest budgets fire exactly at each boundary', () => {
    const budget = { maxSemanticCalls: 40, maxToolCalls: 120, wallClockMs: 600000 }
    expect(
      evaluateMxLegBudgetStop({ providerCallRecords: 40, toolCalls: 120, wallClockMs: 600000 }, budget).stop
    ).toBe(false)
    expect(
      evaluateMxLegBudgetStop({ providerCallRecords: 41, toolCalls: 0, wallClockMs: 0 }, budget).stop
    ).toBe(true)
    expect(
      evaluateMxLegBudgetStop({ providerCallRecords: 0, toolCalls: 121, wallClockMs: 0 }, budget).stop
    ).toBe(true)
    expect(
      evaluateMxLegBudgetStop({ providerCallRecords: 0, toolCalls: 0, wallClockMs: 600001 }, budget).stop
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Manifest resolution (L1/L2/L3)
// ---------------------------------------------------------------------------

const PLACEHOLDER_MANIFEST = {
  taskId: 'placeholder-l1',
  category: 'L1-placeholder',
  title: 'Placeholder L task',
  fixturePath: 'corpus/L1-placeholder/fixture',
  prompt: 'Do the placeholder task.',
  allowedTools: ['read', 'ls', 'grep', 'find', 'bash', 'edit', 'write'],
  expectedTools: ['read', 'edit', 'bash'],
  expectedWritablePaths: ['src/placeholder.ts'],
  oracle: { command: 'node', args: ['--test', 'test/placeholder.test.js'], expectedExitCode: 0, timeoutMs: 10000 },
  regressionOracle: null,
  budget: { maxSemanticCalls: 40, maxToolCalls: 120, wallClockMs: 600000 }
}

async function writePlaceholderManifests(dir: string, slots: readonly string[]): Promise<void> {
  for (const slot of slots) {
    const manifest = { ...PLACEHOLDER_MANIFEST, taskId: `placeholder-${slot.toLowerCase()}` }
    await writeFile(join(dir, `${slot}-placeholder.json`), JSON.stringify(manifest), 'utf8')
  }
}

describe('MX manifest resolution', () => {
  it('resolves exactly one manifest per L-slot and hashes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-mx-manifests-'))
    try {
      await writePlaceholderManifests(dir, ['L1', 'L2', 'L3'])
      const tasks = await resolveMxTasks({
        manifestDir: dir,
        benchmarkRoot: join(dir, '..'),
        requireFixtures: false
      })
      expect(tasks.map((task) => task.slot)).toEqual(['L1', 'L2', 'L3'])
      expect(tasks[0]!.budget.maxToolCalls).toBe(120)
      expect(tasks[0]!.manifestPath).toBe(join(dir, 'L1-placeholder.json'))
      expect(tasks[0]!.manifestSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(tasks[0]!.fixturePath).toBe(join(dir, '..', 'corpus', 'L1-placeholder', 'fixture'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses clearly when a manifest or fixture is missing, and on ambiguity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-mx-manifests-'))
    try {
      await writePlaceholderManifests(dir, ['L1', 'L2', 'L3'])
      // Fixtures are existence-checked in LIVE mode only (none exist here).
      await expect(
        resolveMxTasks({ manifestDir: dir, benchmarkRoot: dir, requireFixtures: true })
      ).rejects.toThrow(/fixture directory missing/)
      await rm(join(dir, 'L2-placeholder.json'))
      await expect(
        resolveMxTasks({ manifestDir: dir, benchmarkRoot: dir, requireFixtures: false })
      ).rejects.toThrow(/L2.*no manifest matches/)
      await writeFile(
        join(dir, 'L1-other.json'),
        JSON.stringify({ ...PLACEHOLDER_MANIFEST, taskId: 'other' }),
        'utf8'
      )
      await expect(
        resolveMxTasks({ manifestDir: dir, benchmarkRoot: dir, requireFixtures: false })
      ).rejects.toThrow(/L1.*ambiguous/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Aggregator math + exact permutation p-values (hand-checkable)
// ---------------------------------------------------------------------------

describe('MX exact permutation test', () => {
  it('perfectly separated 3v3 groups give p = 2/20 (true labeling + mirror)', () => {
    const result = exactPermutationTest([10, 10, 10], [20, 20, 20])!
    expect(result.assignments).toBe(20)
    expect(result.asExtreme).toBe(2)
    expect(result.pValue).toBeCloseTo(0.1, 10)
    expect(result.observedDifference).toBe(30)
  })

  it('hand-checkable mixed case [1,2,3] vs [4,5,6] gives p = 2/20', () => {
    // Next-most-extreme assignment swaps 3 and 4: |diff| drops from 9 to 7.
    const result = exactPermutationTest([1, 2, 3], [4, 5, 6])!
    expect(result.assignments).toBe(20)
    expect(result.asExtreme).toBe(2)
    expect(result.pValue).toBeCloseTo(0.1, 10)
  })

  it('identical groups give p = 1 (every assignment equally extreme)', () => {
    const result = exactPermutationTest([5, 5, 5], [5, 5, 5])!
    expect(result.pValue).toBe(1)
  })

  it('returns null when either side is empty and always carries the caveat', () => {
    expect(exactPermutationTest([], [1])).toBeNull()
    expect(exactPermutationTest([1], [])).toBeNull()
    expect(exactPermutationTest([1], [2])!.caveat).toContain('no causal claim')
  })
})

describe('MX aggregator', () => {
  it('M2-shaped evidence still aggregates exactly as before (v1 + v2 arms)', () => {
    const scripted = scriptedMxLegRecords('cr004-m2-20260827-01234567', M2_SHAPE)
    const cells = aggregateMxCells(scripted.map(mxLegAnalysisInputOf))
    expect(cells).toHaveLength(9)
    expect(cells.map((cell) => cell.strategy)).toEqual(
      expect.arrayContaining(['NATIVE', 'ACTIVE', 'ACTIVE_V2'])
    )
    const l1Native = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'NATIVE')!
    expect(l1Native.n).toBe(3)
    expect(l1Native.completed).toBe(3)
    // Stand-in oracles are excluded from pass rates.
    expect(l1Native.oracle).toEqual({ pass: 0, fail: 0, notRun: 3, passRate: null })
    expect(l1Native.recordCount.mean).toBe(5)
    expect(l1Native.tokenEstimateSum.mean).toBe(8400)
    expect(l1Native.trajectory.meanFinal).toBe(3300)
    // No NATIVE cell carries Active telemetry.
    expect(l1Native.active).toBeUndefined()
    const l1Active = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'ACTIVE')!
    expect(l1Active.active!.policy).toBe('v1-per-edit')
    expect(l1Active.active!.sends).toBe(6)
    expect(l1Active.active!.attempts).toBe(6)
    expect(l1Active.active!.toolBlocksRemoved).toBe(6)
    expect(l1Active.active!.removedBlocks).toBe(6)
    expect(l1Active.active!.candidateBlocks).toBe(6)
    expect(l1Active.active!.retainedLatestReadTargets).toBe(0)
    // Scripted v1 boundaries show no drop (series[seq-1] never < series[seq-2]).
    expect(l1Active.active!.dropAtBoundary).toEqual({ sent: 6, drops: 0, rate: 0 })
    // One scripted re-read of a removed target per leg => 3 per cell.
    expect(l1Active.active!.reReads).toBe(3)
    expect(l1Active.active!.postFirstInterventionReads).toBe(3)
    expect(l1Active.active!.dedupRemovals).toBe(0)
    expect(l1Active.active!.deferredSweeps).toBe(0)
    // Median of an odd set of equal values.
    expect(l1Active.wallClockMs.median).toBe(0)
    const l1ActiveV2 = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'ACTIVE_V2')!
    expect(l1ActiveV2.active!.policy).toBe('v2-retain-latest-coarse')
    expect(l1ActiveV2.active!.sends).toBe(3)
    expect(l1ActiveV2.active!.attempts).toBe(3)
    expect(l1ActiveV2.active!.removedBlocks).toBe(9)
    expect(l1ActiveV2.active!.candidateBlocks).toBe(9)
    expect(l1ActiveV2.active!.retainedLatestReadTargets).toBe(6)
    // The scripted v2 boundary drops AT the boundary: 850 < 900 each leg.
    expect(l1ActiveV2.active!.dropAtBoundary).toEqual({ sent: 3, drops: 3, rate: 1 })
    expect(l1ActiveV2.active!.reReads).toBe(0)
    expect(l1ActiveV2.active!.postFirstInterventionReads).toBe(3)
    expect(l1ActiveV2.tokenEstimateSum.mean).toBe(5050)
    expect(l1ActiveV2.trajectory.meanPeak).toBe(1500)
    expect(l1ActiveV2.trajectory.meanFinal).toBe(1400)
  })

  it('aggregates the M3 default (v2 + v3 arms) incl. dedupRemovals/deferredSweeps', () => {
    const cells = aggregateMxCells(scriptedMxLegRecords(RUN_ID).map(mxLegAnalysisInputOf))
    expect(cells).toHaveLength(9)
    // The v1 ACTIVE arm is M1/M2 history: absent from the M3 design.
    expect(cells.find((cell) => cell.strategy === 'ACTIVE')).toBeUndefined()
    const l1Native = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'NATIVE')!
    expect(l1Native.n).toBe(3)
    expect(l1Native.tokenEstimateSum.mean).toBe(8400)
    // NATIVE scripted trajectories are strictly monotonic.
    expect(
      l1Native.trajectory.legs.every((leg) => leg.peak === 3300 && leg.sum === 8400)
    ).toBe(true)
    expect(l1Native.trajectory.meanFinal).toBe(3300)
    expect(l1Native.active).toBeUndefined()
    const l1ActiveV2 = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'ACTIVE_V2')!
    expect(l1ActiveV2.active!.policy).toBe('v2-retain-latest-coarse')
    expect(l1ActiveV2.active!.sends).toBe(3)
    expect(l1ActiveV2.active!.removedBlocks).toBe(9)
    expect(l1ActiveV2.active!.retainedLatestReadTargets).toBe(6)
    expect(l1ActiveV2.active!.dedupRemovals).toBe(0)
    expect(l1ActiveV2.active!.deferredSweeps).toBe(0)
    const l1ActiveV3 = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'ACTIVE_V3')!
    expect(l1ActiveV3.active!.policy).toBe('v3-verify-window-dedup')
    expect(l1ActiveV3.active!.sends).toBe(6)
    expect(l1ActiveV3.active!.attempts).toBe(6)
    expect(l1ActiveV3.active!.removedBlocks).toBe(6)
    expect(l1ActiveV3.active!.candidateBlocks).toBe(6)
    expect(l1ActiveV3.active!.retainedLatestReadTargets).toBe(6)
    // One dedup removal + one deferred-then-resumed sweep per leg => 3 per cell.
    expect(l1ActiveV3.active!.dedupRemovals).toBe(3)
    expect(l1ActiveV3.active!.deferredSweeps).toBe(3)
    // Both scripted v3 boundaries drop AT the boundary (850 < 900, 1300 < 1400).
    expect(l1ActiveV3.active!.dropAtBoundary).toEqual({ sent: 6, drops: 6, rate: 1 })
    expect(l1ActiveV3.active!.reReads).toBe(0)
    expect(l1ActiveV3.tokenEstimateSum.mean).toBe(4850)
    expect(l1ActiveV3.trajectory.meanPeak).toBe(1400)
    expect(l1ActiveV3.trajectory.meanFinal).toBe(1300)
  })

  it('verdicts report raw arm reliability and context-efficiency direction for the arms present', () => {
    const cells = aggregateMxCells(scriptedMxLegRecords(RUN_ID).map(mxLegAnalysisInputOf))
    const verdict = mxVerdictOf(cells)
    expect(verdict.reliability).toContain(
      'reliability identical (raw): NATIVE oracle 0/0 vs ACTIVE_V2 0/0 vs ACTIVE_V3 0/0'
    )
    expect(verdict.reliability).not.toContain('ACTIVE ')
    expect(verdict.contextEfficiency).toContain('NATIVE 8400 vs ACTIVE_V2 5050 vs ACTIVE_V3 4850')
    expect(verdict.contextEfficiency).toContain('ACTIVE_V3 lowest, NATIVE highest')
    expect(mxCellOneLiner(cells[0]!)).toContain('cell L1/NATIVE n=3')
    const v2Liner = mxCellOneLiner(
      cells.find((cell) => cell.task === 'L2' && cell.strategy === 'ACTIVE_V2')!
    )
    expect(v2Liner).toContain('cell L2/ACTIVE_V2 n=3')
    expect(v2Liner).toContain('policy=v2-retain-latest-coarse')
    expect(v2Liner).toContain('dropAtBoundary=3/3 (100%)')
    expect(v2Liner).toContain('reReads=0')
    const v3Liner = mxCellOneLiner(
      cells.find((cell) => cell.task === 'L2' && cell.strategy === 'ACTIVE_V3')!
    )
    expect(v3Liner).toContain('cell L2/ACTIVE_V3 n=3')
    expect(v3Liner).toContain('policy=v3-verify-window-dedup')
    expect(v3Liner).toContain('dedupRemovals=3')
    expect(v3Liner).toContain('deferredSweeps=3')
    // M2-shaped verdict keeps its exact historical shape.
    const m2Verdict = mxVerdictOf(
      aggregateMxCells(
        scriptedMxLegRecords('cr004-m2-20260827-01234567', M2_SHAPE).map(mxLegAnalysisInputOf)
      )
    )
    expect(m2Verdict.reliability).toContain(
      'reliability identical (raw): NATIVE oracle 0/0 vs ACTIVE 0/0 vs ACTIVE_V2 0/0'
    )
    expect(m2Verdict.contextEfficiency).toContain('NATIVE 8400 vs ACTIVE 9700 vs ACTIVE_V2 5050')
    expect(m2Verdict.contextEfficiency).toContain('ACTIVE_V2 lowest, ACTIVE highest')
  })

  it('dropAtBoundaryOf implements series[seq-1] < series[seq-2] with an explicit caveat-free count', () => {
    // Drop at seq 3 (150 < 200), none at seq 5 (300 >= 150); seq 1 is not comparable.
    expect(dropAtBoundaryOf([100, 200, 150, 250, 300], [3, 5, 1])).toEqual({
      sent: 3,
      drops: 1,
      rate: 1 / 3
    })
    expect(dropAtBoundaryOf([], [])).toEqual({ sent: 0, drops: 0, rate: null })
    expect(dropAtBoundaryOf([50], [1])).toEqual({ sent: 1, drops: 0, rate: 0 })
    expect(dropAtBoundaryOf([200, 100], [null, 2])).toEqual({ sent: 1, drops: 1, rate: 1 })
    expect(dropAtBoundaryOf([100, 200], [2])).toEqual({ sent: 1, drops: 0, rate: 0 })
  })

  it('degrades to the M1 comparison set when no ACTIVE_V2/V3 legs exist (M1 evidence dirs)', () => {
    const m1Shaped = scriptedMxLegRecords('cr004-m1-20260826-d23a992c', M1_SHAPE)
    const cells = aggregateMxCells(m1Shaped.map(mxLegAnalysisInputOf))
    expect(cells).toHaveLength(6)
    const tests = mxPermutationTests(cells)
    expect(tests.map((entry) => entry.comparison)).toEqual([
      'NATIVE_vs_ACTIVE',
      'NATIVE_vs_ACTIVE',
      'NATIVE_vs_ACTIVE'
    ])
    const verdict = mxVerdictOf(cells)
    expect(verdict.contextEfficiency).toContain('NATIVE 8400 vs ACTIVE 9700')
    expect(verdict.contextEfficiency).not.toContain('ACTIVE_V2')
    expect(verdict.contextEfficiency).not.toContain('ACTIVE_V3')
  })
})

// ---------------------------------------------------------------------------
// Re-read detection from telemetry
// ---------------------------------------------------------------------------

describe('MX re-read detection', () => {
  it('flags readTargetHash matches after interventions and counts post-first reads', () => {
    const hashA = readTargetHashOf('src/removed-a.ts')
    const hashB = readTargetHashOf('src/removed-b.ts')
    const hashC = readTargetHashOf('src/fresh.ts')
    const events: ActiveRewriteEventEvidence[] = [
      { sequence: 1, observedTokenEstimate: 10, boundaryReached: false, interventionAttempted: false, compositionVerdict: 'NOT_ATTEMPTED', guardVerdict: 'NOT_ATTEMPTED', sentRewrite: false, killSwitchTripped: false, toolBlocksRemoved: 0, readTargets: [{ toolCallId: 'a', readTargetHash: hashA }] },
      { sequence: 2, observedTokenEstimate: 20, boundaryReached: true, interventionAttempted: true, interventionIndex: 1, compositionVerdict: 'REWRITE_READY', guardVerdict: 'PASS', sentRewrite: true, killSwitchTripped: false, toolBlocksRemoved: 1, removedReadTargetHashes: [hashA] },
      { sequence: 3, observedTokenEstimate: 15, boundaryReached: false, interventionAttempted: false, compositionVerdict: 'NOT_ATTEMPTED', guardVerdict: 'NOT_ATTEMPTED', sentRewrite: false, killSwitchTripped: false, toolBlocksRemoved: 0, readTargets: [{ toolCallId: 'a2', readTargetHash: hashA }] },
      { sequence: 4, observedTokenEstimate: 25, boundaryReached: true, interventionAttempted: true, interventionIndex: 2, compositionVerdict: 'REWRITE_READY', guardVerdict: 'PASS', sentRewrite: true, killSwitchTripped: false, toolBlocksRemoved: 1, removedReadTargetHashes: [hashB] },
      { sequence: 5, observedTokenEstimate: 18, boundaryReached: false, interventionAttempted: false, compositionVerdict: 'NOT_ATTEMPTED', guardVerdict: 'NOT_ATTEMPTED', sentRewrite: false, killSwitchTripped: false, toolBlocksRemoved: 0, readTargets: [{ toolCallId: 'b2', readTargetHash: hashB }, { toolCallId: 'c', readTargetHash: hashC }] }
    ]
    const analysis = detectReReads(events)
    expect(analysis.firstInterventionSequence).toBe(2)
    expect(analysis.matches).toHaveLength(2)
    expect(analysis.matches[0]).toEqual({ afterInterventionIndex: 1, readTargetHash: hashA, sequence: 3 })
    expect(analysis.matches[1]).toEqual({ afterInterventionIndex: 2, readTargetHash: hashB, sequence: 5 })
    expect(analysis.postFirstInterventionReadCount).toBe(3)
  })

  it('returns zero-state when no intervention happened', () => {
    const analysis = detectReReads([
      { sequence: 1, observedTokenEstimate: 10, boundaryReached: false, interventionAttempted: false, compositionVerdict: 'NOT_ATTEMPTED', guardVerdict: 'NOT_ATTEMPTED', sentRewrite: false, killSwitchTripped: false, toolBlocksRemoved: 0, readTargets: [{ toolCallId: 'a', readTargetHash: 'x' }] }
    ])
    expect(analysis.firstInterventionSequence).toBeNull()
    expect(analysis.matches).toHaveLength(0)
    expect(analysis.postFirstInterventionReadCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Incremental evidence writing + offline analyzer round-trip
// ---------------------------------------------------------------------------

describe('MX incremental evidence + analyzeMatrix round-trip', () => {
  it('writes leg evidence immediately and the analyzer reads it all back', async () => {
    const reportDir = await mkdtemp(join(tmpdir(), 'canvas-mx-report-'))
    try {
      const scripted = scriptedMxLegRecords(RUN_ID)
      for (const record of scripted.slice(0, 4)) {
        const legDir = await writeMxLegEvidence(reportDir, record, scriptedMxObservations(record))
        // leg.json and observations.jsonl exist IMMEDIATELY after each leg.
        const legJson = JSON.parse(await readFile(join(legDir, 'leg.json'), 'utf8'))
        expect(legJson.legIndex).toBe(record.legIndex)
        const observations = (await readFile(join(legDir, 'observations.jsonl'), 'utf8'))
          .split('\n')
          .filter((line) => line !== '')
        expect(observations).toHaveLength(record.trajectory.series.length)
        await writeMxManifest(reportDir, { runId: RUN_ID, legs: [legJson.legIndex] })
        await writeMxAggregate(reportDir, { runId: RUN_ID, legsAttempted: legJson.legIndex + 1 })
      }
      // The manifest/matrix rewrites are complete, parseable documents.
      expect(JSON.parse(await readFile(join(reportDir, 'manifest.json'), 'utf8')).runId).toBe(RUN_ID)
      expect(JSON.parse(await readFile(join(reportDir, 'matrix.json'), 'utf8')).legsAttempted).toBe(4)
    } finally {
      await rm(reportDir, { recursive: true, force: true })
    }
  })

  it('analyzes a full scripted dry-run report dir: 27 legs, 9 cells, three-arm permutation, policy A/B', async () => {
    const reportDir = await mkdtemp(join(tmpdir(), 'canvas-mx-report-'))
    try {
      await mkdir(join(reportDir, 'legs'), { recursive: true })
      for (const record of scriptedMxLegRecords(RUN_ID)) {
        await writeMxLegEvidence(reportDir, record, scriptedMxObservations(record))
      }
      const { analysis, markdown } = await analyzeMatrix(reportDir)
      expect(analysis.legsAnalyzed).toBe(27)
      expect(analysis.cells).toHaveLength(9)
      const l2ActiveV2 = analysis.cells.find(
        (cell) => cell.task === 'L2' && cell.strategy === 'ACTIVE_V2'
      )!
      // Trajectories read from observations.jsonl: the v2 peak is post-drop.
      expect(l2ActiveV2.trajectory.meanPeak).toBe(1500)
      expect(l2ActiveV2.active!.reReads).toBe(0)
      const l2ActiveV3 = analysis.cells.find(
        (cell) => cell.task === 'L2' && cell.strategy === 'ACTIVE_V3'
      )!
      expect(l2ActiveV3.active!.policy).toBe('v3-verify-window-dedup')
      expect(l2ActiveV3.active!.reReads).toBe(0)
      expect(l2ActiveV3.active!.dropAtBoundary.rate).toBe(1)
      expect(l2ActiveV3.active!.dedupRemovals).toBe(3)
      expect(l2ActiveV3.active!.deferredSweeps).toBe(3)
      // Per-task permutation over observedTokenEstimateSum: identical within
      // strategy, separated across arms (8400 / 5050 / 4850) => p = 2/20 for
      // every one of the THREE present-arm comparisons per task.
      expect(analysis.perTask).toHaveLength(9)
      const comparisons = new Set(analysis.perTask.map((entry) => entry.comparison))
      expect([...comparisons].sort()).toEqual([
        'ACTIVE_V2_vs_ACTIVE_V3',
        'NATIVE_vs_ACTIVE_V2',
        'NATIVE_vs_ACTIVE_V3'
      ])
      for (const { task, comparison, permutation } of analysis.perTask) {
        expect(task).toBeTruthy()
        expect(permutation.pValue).toBeCloseTo(0.1, 10)
        // The low-power caveat rides on every p-value.
        expect(permutation.caveat).toContain('no causal claim')
        if (comparison === 'NATIVE_vs_ACTIVE_V2') {
          expect(permutation.nativeSum).toBe(3 * 8400)
          expect(permutation.activeSum).toBe(3 * 5050)
        } else if (comparison === 'NATIVE_vs_ACTIVE_V3') {
          expect(permutation.nativeSum).toBe(3 * 8400)
          expect(permutation.activeSum).toBe(3 * 4850)
        } else {
          expect(permutation.nativeSum).toBe(3 * 5050)
          expect(permutation.activeSum).toBe(3 * 4850)
        }
      }
      expect(analysis.verdict.contextEfficiency).toContain('ACTIVE_V3 lowest')
      expect(markdown).toContain('## Per-task exact permutation tests')
      expect(markdown).toContain('L2 ACTIVE_V2_vs_ACTIVE_V3')
      expect(markdown).toContain('policy=v2-retain-latest-coarse')
      expect(markdown).toContain('policy=v3-verify-window-dedup')
      expect(markdown).toContain('reReadsOfRemovedTargets=0')
      expect(markdown).toContain('retainedLatestReadTargets=6')
      expect(markdown).toContain('dropAtBoundary=3/3 (100%)')
      expect(markdown).toContain('dedupRemovals=3')
      expect(markdown).toContain('deferredSweeps=3')
      expect(markdown).toContain('no causal claim')
    } finally {
      await rm(reportDir, { recursive: true, force: true })
    }
  })

  it('still analyzes an M2-shaped evidence dir exactly as before (M2 analysis compat)', async () => {
    const reportDir = await mkdtemp(join(tmpdir(), 'canvas-mx-report-'))
    try {
      await mkdir(join(reportDir, 'legs'), { recursive: true })
      for (const record of scriptedMxLegRecords('cr004-m2-20260827-01234567', M2_SHAPE)) {
        await writeMxLegEvidence(reportDir, record, scriptedMxObservations(record))
      }
      const { analysis, markdown } = await analyzeMatrix(reportDir)
      expect(analysis.legsAnalyzed).toBe(27)
      expect(analysis.cells).toHaveLength(9)
      const l2Active = analysis.cells.find(
        (cell) => cell.task === 'L2' && cell.strategy === 'ACTIVE'
      )!
      // Trajectories read from observations.jsonl: ACTIVE shows post-drop peak.
      expect(l2Active.trajectory.meanPeak).toBe(1900)
      expect(l2Active.active!.reReads).toBe(3)
      expect(l2Active.active!.dedupRemovals).toBe(0)
      expect(l2Active.active!.deferredSweeps).toBe(0)
      const comparisons = new Set(analysis.perTask.map((entry) => entry.comparison))
      expect([...comparisons].sort()).toEqual([
        'ACTIVE_vs_ACTIVE_V2',
        'NATIVE_vs_ACTIVE',
        'NATIVE_vs_ACTIVE_V2'
      ])
      expect(analysis.verdict.contextEfficiency).toContain('ACTIVE_V2 lowest, ACTIVE highest')
      expect(markdown).toContain('L2 ACTIVE_vs_ACTIVE_V2')
      expect(markdown).toContain('policy=v1-per-edit')
      expect(markdown).toContain('reReadsOfRemovedTargets=3')
    } finally {
      await rm(reportDir, { recursive: true, force: true })
    }
  })

  it('trajectorySummaryOf computes peak, final, and sum', () => {
    const summary = trajectorySummaryOf([400, 900, 500, 700])
    expect(summary).toEqual({ series: [400, 900, 500, 700], peak: 900, final: 700, sum: 2500 })
    expect(trajectorySummaryOf([])).toEqual({ series: [], peak: 0, final: 0, sum: 0 })
  })
})

// ---------------------------------------------------------------------------
// Scripted DRY_RUN legs through the FULL matrix state machine
// ---------------------------------------------------------------------------

describe('MX scripted DRY_RUN legs', () => {
  it('flows all 27 default legs (M3 three arms) through the matrix machine without stops, provider calls 0', () => {
    const machine = new MatrixStateMachine()
    const scripted = scriptedMxLegRecords(RUN_ID)
    expect(scripted).toHaveLength(27)
    expect(scripted.filter((record) => record.strategy === 'ACTIVE_V2')).toHaveLength(9)
    expect(scripted.filter((record) => record.strategy === 'ACTIVE_V3')).toHaveLength(9)
    for (const record of scripted) {
      const begin = machine.beginLeg(mxLegOrder()[record.legIndex]!)
      expect(begin.ok).toBe(true)
      machine.endLeg({
        legIndex: record.legIndex,
        task: record.task,
        strategy: record.strategy,
        rep: record.rep,
        status: record.status,
        providerCallRecords: 0,
        toolCalls: record.toolCallCount,
        wallClockMs: record.wallClockMs,
        oraclePass: null,
        stopCondition: record.stopCondition
      })
    }
    expect(machine.isTerminal).toBe(false)
    expect(machine.stopsFired).toHaveLength(0)
    const ledgers = machine.ledgers()
    expect(ledgers.legsAttempted).toBe(27)
    expect(ledgers.providerCallRecordsTotal).toBe(0)
    // Stand-in oracles claim nothing; every ACTIVE_V2 leg carries v2-shaped
    // intervention telemetry (one coarse SENT sweep, latest reads retained)
    // and every ACTIVE_V3 leg carries v3-shaped telemetry (one dedup removal
    // + one verify-window-deferred then resumed sweep).
    for (const record of scripted) {
      expect(record.oracleResults.every((result) => result.standIn === true && result.pass === null)).toBe(true)
      if (record.strategy === 'ACTIVE_V2') {
        const interventions = record.interventionTelemetry!.interventions
        expect(interventions).toHaveLength(1)
        expect(interventions[0]!.policy).toBe('v2-retain-latest-coarse')
        expect(interventions[0]!.trigger).toBe('edit')
        expect(interventions[0]!.sentRewrite).toBe(true)
        expect(interventions[0]!.removedBlocks).toBe(3)
        expect(interventions[0]!.candidateBlocks).toBe(3)
        expect(interventions[0]!.retainedLatestReadTargets).toHaveLength(2)
        continue
      }
      if (record.strategy === 'ACTIVE_V3') {
        const telemetry = record.interventionTelemetry!
        const interventions = telemetry.interventions
        expect(interventions).toHaveLength(2)
        expect(interventions[0]!.policy).toBe('v3-verify-window-dedup')
        expect(interventions[0]!.trigger).toBe('dedup')
        expect(interventions[0]!.sentRewrite).toBe(true)
        expect(interventions[0]!.removedBlocks).toBe(1)
        expect(interventions[1]!.trigger).toBe('edit')
        expect(interventions[1]!.sentRewrite).toBe(true)
        expect(interventions[1]!.removedBlocks).toBe(1)
        // Exactly one deferred boundary evaluation per scripted v3 leg.
        expect(telemetry.events.filter((event) => event.deferredByVerifyWindow === true)).toHaveLength(1)
      }
    }
  })

  it('scripts the targeted L2 x 4 shape: 12 legs, all L2, reps 1..4', () => {
    const scripted = scriptedMxLegRecords('cr004-m3-20260827-01234567', M3_L2_SHAPE)
    expect(scripted).toHaveLength(12)
    expect(scripted.every((record) => record.task === 'L2')).toBe(true)
    expect(scripted.filter((record) => record.strategy === 'NATIVE')).toHaveLength(4)
    expect(scripted.filter((record) => record.strategy === 'ACTIVE_V3')).toHaveLength(4)
    for (let rep = 1; rep <= 4; rep += 1) {
      expect(
        scripted.filter((record) => record.rep === rep).map((record) => record.strategy)
      ).toEqual(['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'])
    }
  })
})

describe('CANVAS_MX_ARMS arm selection (M4 confirmatory shape)', () => {
  it('defaults to all three arms and canonicalizes order', () => {
    expect(mxShapeFromEnv({}).strategies).toEqual(['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'])
    expect(mxShapeFromEnv({ arms: 'ACTIVE_V2,NATIVE' }).strategies).toEqual(['NATIVE', 'ACTIVE_V2'])
  })

  it('refuses unknown, duplicate and empty arm lists', () => {
    expect(() => mxShapeFromEnv({ arms: 'ACTIVE' })).toThrow(MxConfigError)
    expect(() => mxShapeFromEnv({ arms: 'NATIVE,NATIVE' })).toThrow(MxConfigError)
    expect(() => mxShapeFromEnv({ arms: ' , ' })).toThrow(MxConfigError)
  })

  it('shapes the confirmatory two-arm design: 2 tasks x 2 arms x 8 reps = 32 legs', () => {
    const shape = mxShapeFromEnv({ tasks: 'L1,L2', arms: 'NATIVE,ACTIVE_V2', reps: '8' })
    expect(mxTotalLegsOf(shape)).toBe(32)
    const order = mxLegOrder(shape)
    expect(order[0]).toMatchObject({ task: 'L1', strategy: 'NATIVE', rep: 1 })
    expect(order[1]).toMatchObject({ task: 'L1', strategy: 'ACTIVE_V2', rep: 1 })
    expect(order[2]).toMatchObject({ task: 'L2', strategy: 'NATIVE', rep: 1 })
  })
})
