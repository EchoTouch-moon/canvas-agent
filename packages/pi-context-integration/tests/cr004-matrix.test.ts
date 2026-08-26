import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import {
  createRunKillSwitch,
  createActiveRewriteExtension,
  InMemoryActiveRewriteEvidenceCollector,
  readTargetHashOf,
  type ActiveRewriteEventEvidence,
  type PiMessageView
} from '../src'
import { C0ScenarioExecutor } from '../src/smoke/c0-scenarios'
import {
  aggregateMxCells,
  analyzeMatrix,
  detectReReads,
  evaluateMxLegBudgetStop,
  exactPermutationTest,
  isValidMxRunId,
  MatrixStateMachine,
  MX_BUDGETS,
  mxCellOneLiner,
  mxLegAnalysisInputOf,
  mxLegDirName,
  mxLegOrder,
  MX_RUN_ID_PATTERN,
  MX_STRATEGIES,
  MX_TASK_IDS,
  MX_TOTAL_LEGS,
  mxVerdictOf,
  resolveMxTasks,
  scriptedMxLegRecords,
  scriptedMxObservations,
  suggestMxRunId,
  trajectorySummaryOf,
  writeMxAggregate,
  writeMxLegEvidence,
  writeMxManifest,
  type MxLegLedger
} from '../src/smoke/matrix-core'

// CR-004 Stage 1 MATRIX runner tests. Offline, credential-free, network-free:
// the matrix state machine runs its real transition table, the incremental
// evidence writers write real files to temp dirs, the aggregator/analyzer runs
// over real leg records, and the multi-intervention Active extension is driven
// through REAL message sequences and the REAL policy-v0 planner. Provider
// calls: 0.

const FIXED_NOW = '2026-08-27T00:00:00.000Z'
const RUN_ID = 'cr004-m1-20260827-01234567'

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
  it('accepts the cr004-m1-<ISO-date>-<8-hex> format only', () => {
    expect(isValidMxRunId('cr004-m1-20260827-4d7e9a1b')).toBe(true)
    expect(isValidMxRunId('cr004-s1-20260827-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-m1-2026-08-27-4d7e9a1b')).toBe(false)
    expect(isValidMxRunId('cr004-m1-20260827-4D7E9A1B')).toBe(false)
    expect(isValidMxRunId(undefined)).toBe(false)
    for (let index = 0; index < 8; index += 1) {
      expect(MX_RUN_ID_PATTERN.test(suggestMxRunId())).toBe(true)
    }
  })

  it('orders 18 legs: rep-major, per task NATIVE then ACTIVE, deterministic', () => {
    const order = mxLegOrder()
    expect(order).toHaveLength(MX_TOTAL_LEGS)
    expect(order).toEqual(mxLegOrder())
    expect(order.slice(0, 6).map(mxLegDirName)).toEqual([
      'L1-NATIVE-rep1',
      'L1-ACTIVE-rep1',
      'L2-NATIVE-rep1',
      'L2-ACTIVE-rep1',
      'L3-NATIVE-rep1',
      'L3-ACTIVE-rep1'
    ])
    expect(order[6]!.rep).toBe(2)
    expect(order[17]).toEqual({ legIndex: 17, task: 'L3', strategy: 'ACTIVE', rep: 3 })
    // Every (task, strategy, rep) cell exactly once.
    const keys = new Set(order.map((plan) => mxLegDirName(plan)))
    expect(keys.size).toBe(MX_TOTAL_LEGS)
    for (const task of MX_TASK_IDS) {
      for (const strategy of MX_STRATEGIES) {
        for (let rep = 1; rep <= 3; rep += 1) {
          expect(keys.has(`${task}-${strategy}-rep${rep}`)).toBe(true)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Matrix state machine: totals stop, watchdog, continue-on-leg-failure
// ---------------------------------------------------------------------------

function legLedger(legIndex: number, providerCallRecords: number, status: 'COMPLETED' | 'FAILED' = 'COMPLETED'): MxLegLedger {
  const plan = mxLegOrder()[legIndex]!
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
  it('stops launching legs at the 400-record matrix total (S-7), evidence preserved', () => {
    const machine = new MatrixStateMachine()
    // 16 legs x 25 records = 400: at the limit, not over.
    for (let index = 0; index < 16; index += 1) {
      expect(machine.beginLeg(mxLegOrder()[index]!).ok).toBe(true)
      expect(machine.endLeg(legLedger(index, 25)).stop).toBe(false)
    }
    // Leg 17 starts (totals exactly at budget) and pushes over: endLeg fires S-7.
    expect(machine.beginLeg(mxLegOrder()[16]!).ok).toBe(true)
    const end = machine.endLeg(legLedger(16, 25))
    expect(end.stop).toBe(true)
    expect(machine.isTerminal).toBe(true)
    // No new legs launch; the 17 recorded legs stay preserved in the ledgers.
    const refused = machine.beginLeg(mxLegOrder()[17]!)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.stop.condition).toBe('S-7')
    expect(machine.ledgers().legsAttempted).toBe(17)
    expect(machine.ledgers().providerCallRecordsTotal).toBe(425)
    expect(machine.stopsFired[0]!.condition).toBe('S-7')
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
  it('computes per-cell n, oracle rates, means/medians, and trajectories', () => {
    const scripted = scriptedMxLegRecords(RUN_ID)
    const cells = aggregateMxCells(scripted.map(mxLegAnalysisInputOf))
    expect(cells).toHaveLength(6)
    const l1Native = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'NATIVE')!
    expect(l1Native.n).toBe(3)
    expect(l1Native.completed).toBe(3)
    // Stand-in oracles are excluded from pass rates.
    expect(l1Native.oracle).toEqual({ pass: 0, fail: 0, notRun: 3, passRate: null })
    expect(l1Native.recordCount.mean).toBe(5)
    expect(l1Native.tokenEstimateSum.mean).toBe(8400)
    // NATIVE scripted trajectories are strictly monotonic.
    expect(
      l1Native.trajectory.legs.every((leg) => leg.peak === 3300 && leg.sum === 8400)
    ).toBe(true)
    const l1Active = cells.find((cell) => cell.task === 'L1' && cell.strategy === 'ACTIVE')!
    expect(l1Active.active!.sends).toBe(6)
    expect(l1Active.active!.attempts).toBe(6)
    expect(l1Active.active!.toolBlocksRemoved).toBe(6)
    // One scripted re-read of a removed target per leg => 3 per cell.
    expect(l1Active.active!.reReads).toBe(3)
    expect(l1Active.active!.postFirstInterventionReads).toBe(3)
    // Median of an odd set of equal values.
    expect(l1Active.wallClockMs.median).toBe(0)
    // No NATIVE cell carries Active telemetry.
    expect(l1Native.active).toBeUndefined()
  })

  it('verdicts report raw reliability and context-efficiency direction', () => {
    const cells = aggregateMxCells(scriptedMxLegRecords(RUN_ID).map(mxLegAnalysisInputOf))
    const verdict = mxVerdictOf(cells)
    expect(verdict.reliability).toContain('reliability identical (raw): NATIVE oracle 0/0 vs ACTIVE 0/0')
    expect(verdict.contextEfficiency).toContain('NATIVE 8400 vs ACTIVE 9700 (ACTIVE higher)')
    expect(mxCellOneLiner(cells[0]!)).toContain('cell L1/NATIVE n=3')
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

  it('analyzes a full scripted dry-run report dir: 18 legs, 6 cells, re-reads, permutation', async () => {
    const reportDir = await mkdtemp(join(tmpdir(), 'canvas-mx-report-'))
    try {
      await mkdir(join(reportDir, 'legs'), { recursive: true })
      for (const record of scriptedMxLegRecords(RUN_ID)) {
        await writeMxLegEvidence(reportDir, record, scriptedMxObservations(record))
      }
      const { analysis, markdown } = await analyzeMatrix(reportDir)
      expect(analysis.legsAnalyzed).toBe(18)
      expect(analysis.cells).toHaveLength(6)
      const l2Active = analysis.cells.find(
        (cell) => cell.task === 'L2' && cell.strategy === 'ACTIVE'
      )!
      // Trajectories read from observations.jsonl: ACTIVE shows post-drop peak.
      expect(l2Active.trajectory.meanPeak).toBe(1900)
      expect(l2Active.active!.reReads).toBe(3)
      // Per-task permutation over observedTokenEstimateSum: identical within
      // strategy, separated across (8400 vs 9700) => p = 2/20.
      expect(analysis.perTask).toHaveLength(3)
      for (const { task, permutation } of analysis.perTask) {
        expect(task).toBeTruthy()
        expect(permutation.pValue).toBeCloseTo(0.1, 10)
        expect(permutation.nativeSum).toBe(3 * 8400)
        expect(permutation.activeSum).toBe(3 * 9700)
      }
      expect(analysis.verdict.contextEfficiency).toContain('ACTIVE higher')
      expect(markdown).toContain('## Per-task exact permutation tests')
      expect(markdown).toContain('reReadsOfRemovedTargets=3')
      expect(markdown).toContain('no causal claim')
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
  it('flow all 18 legs through the matrix machine without stops, provider calls 0', () => {
    const machine = new MatrixStateMachine()
    const scripted = scriptedMxLegRecords(RUN_ID)
    expect(scripted).toHaveLength(18)
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
    expect(ledgers.legsAttempted).toBe(18)
    expect(ledgers.providerCallRecordsTotal).toBe(0)
    // Stand-in oracles claim nothing.
    for (const record of scripted) {
      expect(record.oracleResults.every((result) => result.standIn === true && result.pass === null)).toBe(true)
    }
  })
})
