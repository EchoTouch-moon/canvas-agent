import { describe, expect, it } from 'vitest'
import { computeWorkingSetLogicalHash } from '@canvas-agent/context-runtime'
import {
  EnrichedPiShadowObserver,
  PI_ACTIVE_CAPABILITY,
  PiContextShadowObserver,
  ShadowPlannerObserver,
  assertRewriteSafe,
  checkCapability,
  composeActiveRewrite,
  createRunKillSwitch,
  type ActiveRewriteComposition,
  type ComposeActiveRewriteInput,
  type PiMessageView
} from '../src'

// CR-004 Stage 0 safety-seam tests. Offline, credential-free, network-free:
// Working Sets / Transitions come from the REAL policy-v0 planner
// (ShadowPlannerObserver, the same chain the shadow smoke uses). Hand-built
// fixtures appear only where the real planner cannot express the negative
// case; each such spot is documented inline. Provider calls: 0.

const FIXED_NOW = '2026-08-27T00:00:00.000Z'
const RUN_ID = 'run-cr004-stage0-test'
const SYSTEM_INSTRUCTION = 'You are a careful coding agent. Preserve tool continuity.'

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantTextMessage(text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function assistantThinkingMessage(thinking: string, text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'thinking', thinking }, { type: 'text', text }] }
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

function toolResultWithImageMessage(toolCallId: string): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'image', data: 'aW1hZ2UtYnl0ZXM=', mimeType: 'image/png' }],
    toolCallId,
    toolName: 'read',
    isError: false
  }
}

// Realistic native Pi conversation: two full tool-call/result pairs.
const CONVERSATION: readonly PiMessageView[] = [
  userMessage('Read a.ts and b.ts, then summarize both.'),
  toolCallMessage('call-1', 'read', { path: 'a.ts' }),
  toolResultMessage('call-1', 'function greet(name) { return `hello ${name}` }'),
  assistantTextMessage('a.ts defines the greet function.'),
  toolCallMessage('call-2', 'read', { path: 'b.ts' }),
  toolResultMessage('call-2', 'export { greet } from ./a.ts'),
  assistantTextMessage('b.ts re-exports greet from a.ts.'),
  userMessage('Summarize both files in one line.')
]

const CALL_1_MESSAGE = CONVERSATION[1]!
const RESULT_1_MESSAGE = CONVERSATION[2]!
const CALL_1 = 'run/tool-call://call-1'
const RESULT_1 = 'run/tool-result://call-1'

type PlannerControl = { pinned: string[]; excluded: string[] }

// Real planner wiring (same pattern as shadow-planner.test.ts): the mutable
// control lets each boundary change pinned/excluded sources while the REAL
// policy-v0 planWorkingSet produces the Working Set + Transition.
function createPlanner(control: PlannerControl): ShadowPlannerObserver {
  const base = new PiContextShadowObserver({
    runtimeSessionId: 'sess-cr004-stage0',
    now: () => FIXED_NOW
  })
  const enriched = new EnrichedPiShadowObserver({ base })
  return new ShadowPlannerObserver({
    enriched,
    policyVersion: 'policy-v0',
    makePlanningRequest: (input) => ({
      runtimeSessionId: input.runtimeSessionId,
      recompositionSequence: input.sequence,
      taskPhase: 'GENERAL',
      budget: { maxSemanticTokens: 8000 },
      pinnedSourceKeys: [...control.pinned],
      excludedSourceKeys: [...control.excluded],
      currentTargetSourceKeys: [],
      latestVerificationSourceKeys: [],
      recentEvidenceSourceKeys: input.recentEvidenceSourceKeys,
      previousWorkingSetId: input.previousWorkingSetId
    })
  })
}

// Shared REAL plans over the same conversation: boundary 1 retains everything,
// boundary 2 REMOVEs the call-1 pair (both sides excluded).
const plans = await (async () => {
  const control: PlannerControl = { pinned: [], excluded: [] }
  const planner = createPlanner(control)
  await planner.observeModelCall([...CONVERSATION])
  const boundary1 = planner.callResults[0]!.plannerResult
  control.excluded.push(CALL_1, RESULT_1)
  await planner.observeModelCall([...CONVERSATION])
  const boundary2 = planner.callResults[1]!.plannerResult
  return { boundary1, boundary2 }
})()

function baseInput(overrides: Partial<ComposeActiveRewriteInput>): ComposeActiveRewriteInput {
  return {
    messages: CONVERSATION,
    runId: RUN_ID,
    killSwitch: createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW }),
    activeModeOptIn: true,
    harness: 'PI',
    systemInstruction: SYSTEM_INSTRUCTION,
    workingSet: plans.boundary2.workingSet,
    transition: plans.boundary2.transition,
    ...overrides
  }
}

function expectFallback(result: ActiveRewriteComposition, reason: string): void {
  expect(result.kind).toBe('FALLBACK_NATIVE')
  if (result.kind === 'FALLBACK_NATIVE') expect(result.reason).toBe(reason)
}

describe('CR-004 Stage 0: opt-in / harness / kill switch', () => {
  it('S0-1: not opted in => FALLBACK_NATIVE NOT_OPTED_IN (Native default)', () => {
    expectFallback(composeActiveRewrite(baseInput({ activeModeOptIn: false })), 'NOT_OPTED_IN')
  })

  it('S0-2: non-PI harness => FALLBACK_NATIVE HARNESS_UNSUPPORTED', () => {
    expectFallback(composeActiveRewrite(baseInput({ harness: 'OPENCODE' })), 'HARNESS_UNSUPPORTED')
    expect(checkCapability({ harness: 'OPENCODE', messages: CONVERSATION }).supported).toBe(false)
  })

  it('S0-3a: kill switch tripped before composition => FALLBACK KILL_SWITCH_TRIPPED', () => {
    const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    killSwitch.trip('operator stop')
    expectFallback(composeActiveRewrite(baseInput({ killSwitch })), 'KILL_SWITCH_TRIPPED')
  })

  it('S0-3b: tripped mid-composition => KILL_SWITCH_TRIPPED_MID_COMPOSITION, then permanent', () => {
    const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    const mid = composeActiveRewrite(
      baseInput({
        killSwitch,
        beforeFinalValidation: () => {
          killSwitch.trip('mid-composition inconsistency')
        }
      })
    )
    expectFallback(mid, 'KILL_SWITCH_TRIPPED_MID_COMPOSITION')
    // Permanence: a later composition attempt for the same run also falls back.
    expectFallback(composeActiveRewrite(baseInput({ killSwitch })), 'KILL_SWITCH_TRIPPED')
  })

  it('kill switch: first trip wins, injected clock, per-run isolation', () => {
    const a = createRunKillSwitch('run-a', { now: () => FIXED_NOW })
    const b = createRunKillSwitch('run-b', { now: () => FIXED_NOW })
    const first = a.trip('reason A')
    expect(first).toEqual({ reason: 'reason A', trippedAt: FIXED_NOW })
    expect(a.trip('reason B')).toEqual(first) // stays tripped with the FIRST record
    expect(a.armed).toBe(false)
    expect(a.isTripped).toBe(true)
    expect(b.armed).toBe(true) // no shared state between runs
    expect(b.tripRecord).toBeUndefined()
  })
})

describe('CR-004 Stage 0: mandatory/pinned re-assertion', () => {
  it('S0-4a: pinned source with no composed message => FALLBACK MANDATORY_ITEM_MISSING (real planner)', async () => {
    // Real planner: boundary 1 with the call-1 pair PINNED (policy supports
    // pinning run-event sources). Composing against a native list that no
    // longer carries those messages fails the re-assertion.
    const control: PlannerControl = { pinned: [CALL_1, RESULT_1], excluded: [] }
    const planner = createPlanner(control)
    await planner.observeModelCall([...CONVERSATION])
    const pinned = planner.callResults[0]!.plannerResult
    expect(
      pinned.workingSet.items.some(
        (item) => item.protection === 'PINNED' && item.sourceKeys.includes(CALL_1)
      )
    ).toBe(true)
    expectFallback(
      composeActiveRewrite(
        baseInput({
          messages: [userMessage('fresh turn without the tool pair')],
          workingSet: pinned.workingSet,
          transition: pinned.transition
        })
      ),
      'MANDATORY_ITEM_MISSING'
    )
  })

  it('S0-4b: MANDATORY item absent from composition => FALLBACK (hand-built negative)', () => {
    // HAND-BUILT: the real planner refuses mandatory+exclude with
    // PlanningConflictError, so a MANDATORY claim whose message is gone can
    // only be expressed by mutating a REAL boundary-1 working set (protection
    // flipped, logicalHash recomputed with the real hash function).
    const ws = plans.boundary1.workingSet
    const items = ws.items.map((item) =>
      item.sourceKeys.includes(CALL_1) ? { ...item, protection: 'MANDATORY' as const } : item
    )
    const mandatoryWs = {
      ...ws,
      items,
      logicalHash: computeWorkingSetLogicalHash({
        runtimeSessionId: ws.runtimeSessionId,
        sequence: ws.sequence,
        plannedFromUniverseSequence: ws.plannedFromUniverseSequence,
        plannedFromUniverseHash: ws.plannedFromUniverseHash,
        previousWorkingSetId: ws.previousWorkingSetId,
        policyVersion: ws.policyVersion,
        planningRequestHash: ws.planningRequestHash,
        items
      })
    }
    expectFallback(
      composeActiveRewrite(
        baseInput({
          messages: CONVERSATION.filter((message) => message !== CALL_1_MESSAGE),
          workingSet: mandatoryWs,
          transition: plans.boundary1.transition
        })
      ),
      'MANDATORY_ITEM_MISSING'
    )
  })
})

describe('CR-004 Stage 0: tool pair / system / opaque / membership continuity', () => {
  it('S0-5a: tool-call/result pair split => FALLBACK TOOL_PAIR_SPLIT (real planner)', async () => {
    // Boundary 1 retains everything, boundary 2 excludes ONLY the call side of
    // pair 1: REMOVE(call) + KEEP(result) is exactly the split state.
    const control: PlannerControl = { pinned: [], excluded: [] }
    const planner = createPlanner(control)
    await planner.observeModelCall([...CONVERSATION])
    control.excluded.push(CALL_1)
    await planner.observeModelCall([...CONVERSATION])
    const split = planner.callResults[1]!.plannerResult
    expectFallback(
      composeActiveRewrite(
        baseInput({ workingSet: split.workingSet, transition: split.transition })
      ),
      'TOOL_PAIR_SPLIT'
    )
  })

  it('S0-5b: pair removed together => REWRITE_READY with both messages gone', () => {
    const result = composeActiveRewrite(baseInput({}))
    expect(result.kind).toBe('REWRITE_READY')
    if (result.kind !== 'REWRITE_READY') return
    expect(result.messages).toHaveLength(6)
    expect(result.messages.includes(CALL_1_MESSAGE)).toBe(false)
    expect(result.messages.includes(RESULT_1_MESSAGE)).toBe(false)
    expect([...result.removedSourceKeys]).toEqual([CALL_1, RESULT_1])
  })

  it('S0-6a: system instruction absent => FALLBACK; present => byte-identical', () => {
    const { systemInstruction: omitted, ...withoutSystem } = baseInput({})
    void omitted
    expectFallback(composeActiveRewrite(withoutSystem), 'SYSTEM_INSTRUCTION_ABSENT')
    expectFallback(composeActiveRewrite(baseInput({ systemInstruction: '' })), 'SYSTEM_INSTRUCTION_ABSENT')
    const ok = composeActiveRewrite(
      baseInput({ workingSet: plans.boundary1.workingSet, transition: plans.boundary1.transition })
    )
    expect(ok.kind).toBe('REWRITE_READY')
    if (ok.kind === 'REWRITE_READY') expect(ok.systemInstruction).toBe(SYSTEM_INSTRUCTION)
  })

  it('S0-6b: system-role message inside the native list => FALLBACK (duplicate carrier)', () => {
    // Pi carries the system instruction out-of-band; a system-role
    // AgentMessage would duplicate it and is out of contract.
    expectFallback(
      composeActiveRewrite(
        baseInput({ messages: [{ role: 'system', content: SYSTEM_INSTRUCTION }, ...CONVERSATION] })
      ),
      'UNSUPPORTED_MESSAGE_KIND'
    )
  })

  it('S0-7a: REMOVEd source whose message carries opaque content => FALLBACK OPAQUE_CONTENT_DROPPED', () => {
    const withImage: readonly PiMessageView[] = [
      ...CONVERSATION.slice(0, 2),
      toolResultWithImageMessage('call-1'),
      ...CONVERSATION.slice(3)
    ]
    expectFallback(composeActiveRewrite(baseInput({ messages: withImage })), 'OPAQUE_CONTENT_DROPPED')
  })

  it('S0-7b: opaque/reasoning blocks in kept messages are preserved verbatim', () => {
    const thinking = assistantThinkingMessage('I should check b.ts next.', 'Now reading b.ts.')
    const withThinking: readonly PiMessageView[] = [
      ...CONVERSATION.slice(0, 3),
      thinking,
      ...CONVERSATION.slice(4)
    ]
    const result = composeActiveRewrite(
      baseInput({
        messages: withThinking,
        workingSet: plans.boundary1.workingSet,
        transition: plans.boundary1.transition
      })
    )
    expect(result.kind).toBe('REWRITE_READY')
    if (result.kind !== 'REWRITE_READY') return
    expect(result.messages.includes(thinking)).toBe(true) // same reference => verbatim
    expect(result.continuity.opaqueItemsPreservedVerbatim).toBe(true)
    expect(result.continuity.opaqueBlockCount).toBe(1)
  })

  it('S0-8: message whose source is neither retained nor REMOVEd => FALLBACK UNEXPLAINED_MEMBERSHIP', async () => {
    // Real planner planned a boundary WITHOUT the tool pairs; composing the
    // fuller conversation leaves the run sources unexplained.
    const control: PlannerControl = { pinned: [], excluded: [] }
    const planner = createPlanner(control)
    await planner.observeModelCall([userMessage('task without tools')])
    const bare = planner.callResults[0]!.plannerResult
    expectFallback(
      composeActiveRewrite(baseInput({ workingSet: bare.workingSet, transition: bare.transition })),
      'UNEXPLAINED_MEMBERSHIP'
    )
  })

  it('empty native context => FALLBACK EMPTY_NATIVE_CONTEXT', () => {
    expectFallback(composeActiveRewrite(baseInput({ messages: [] })), 'EMPTY_NATIVE_CONTEXT')
  })
})

describe('CR-004 Stage 0: happy path composition correctness', () => {
  it('S0-9: REWRITE_READY with binding hashes, byte-identical keeps, untouched input, determinism', () => {
    const first = composeActiveRewrite(baseInput({}))
    expect(first.kind).toBe('REWRITE_READY')
    if (first.kind !== 'REWRITE_READY') return
    // Binding: hashes equal the REAL working set / transition logical hashes.
    expect(first.binding.workingSetLogicalHash).toBe(plans.boundary2.workingSet.logicalHash)
    expect(first.binding.transitionLogicalHash).toBe(plans.boundary2.transition.logicalHash)
    expect(first.binding.runId).toBe(RUN_ID)
    // Removed messages gone; kept messages byte-identical (same references).
    const expectedKept = CONVERSATION.filter(
      (message) => message !== CALL_1_MESSAGE && message !== RESULT_1_MESSAGE
    )
    expect(first.messages).toHaveLength(expectedKept.length)
    for (let index = 0; index < expectedKept.length; index += 1) {
      expect(first.messages[index]).toBe(expectedKept[index])
    }
    // The ORIGINAL native input is untouched (Stage 0 never mutates Pi state).
    expect(CONVERSATION).toHaveLength(8)
    // Continuity record: every check green.
    expect(first.continuity).toMatchObject({
      optIn: true,
      harnessSupported: true,
      killSwitchArmed: true,
      transitionInvariantsConsistent: true,
      membershipExplained: true,
      toolPairsIntact: true,
      systemInstructionPresent: true,
      systemInstructionByteIdentical: true,
      opaqueItemsPreservedVerbatim: true,
      mandatoryPinnedReasserted: true
    })
    expect(first.continuity.toolPairCount).toBe(2)
    expect(first.continuity.removedSourceCount).toBe(2)
    // Determinism: identical inputs => identical composition (deep-equal).
    expect(composeActiveRewrite(baseInput({}))).toEqual(first)
  })
})

describe('CR-004 Stage 0: pre-send guard (Stage 1 seam, offline tests only)', () => {
  it('S0-10a: passes a valid composition', () => {
    const composition = composeActiveRewrite(baseInput({}))
    expect(composition.kind).toBe('REWRITE_READY')
    const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    const verdict = assertRewriteSafe(composition, killSwitch)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.verified.bindingVerified).toBe(true)
    expect(killSwitch.armed).toBe(true)
  })

  it('S0-10b: fails after kill-switch trip', () => {
    const composition = composeActiveRewrite(baseInput({}))
    const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    killSwitch.trip('operator stop before send')
    const verdict = assertRewriteSafe(composition, killSwitch)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('KILL_SWITCH_TRIPPED')
  })

  it('S0-10c: fails on tampered binding hash and trips the run kill switch', () => {
    const composition = composeActiveRewrite(baseInput({}))
    expect(composition.kind).toBe('REWRITE_READY')
    if (composition.kind !== 'REWRITE_READY') return
    const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    const tampered = {
      ...composition,
      binding: { ...composition.binding, workingSetLogicalHash: '0'.repeat(64) }
    }
    const verdict = assertRewriteSafe(tampered, killSwitch)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('BINDING_MISMATCH')
    expect(killSwitch.isTripped).toBe(true) // permanent for the run
  })

  it('S0-10d: fails on altered system instruction', () => {
    const composition = composeActiveRewrite(baseInput({}))
    expect(composition.kind).toBe('REWRITE_READY')
    if (composition.kind !== 'REWRITE_READY') return
    const killSwitch = createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW })
    const tampered = { ...composition, systemInstruction: 'You are a different agent.' }
    const verdict = assertRewriteSafe(tampered, killSwitch)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('SYSTEM_INSTRUCTION_ALTERED')
  })

  it('S0-10e: rejects a composition bound to another run id', () => {
    const composition = composeActiveRewrite(baseInput({}))
    const killSwitch = createRunKillSwitch('run-other', { now: () => FIXED_NOW })
    const verdict = assertRewriteSafe(composition, killSwitch)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('RUN_ID_MISMATCH')
  })
})

describe('CR-004 Stage 0: capability profile facts', () => {
  it('describes the Pi-only offline capability honestly', () => {
    expect(PI_ACTIVE_CAPABILITY.harness).toBe('PI')
    expect(PI_ACTIVE_CAPABILITY.sendsProviderRequests).toBe(false)
    expect(PI_ACTIVE_CAPABILITY.opaquePolicy).toBe('PRESERVED_VERBATIM_NEVER_REWRITTEN')
    expect(PI_ACTIVE_CAPABILITY.rewriteMode).toBe('WHOLE_MESSAGE_DROP_ONLY')
    expect(checkCapability({ harness: 'PI', messages: CONVERSATION }).supported).toBe(true)
  })
})
