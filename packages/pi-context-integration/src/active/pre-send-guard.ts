import {
  computeTransitionLogicalHash,
  computeWorkingSetLogicalHash,
  sha256Hex
} from '@canvas-agent/context-runtime'
import {
  activeMessagesHash,
  activeSystemInstructionHash,
  type ActiveFallbackReason,
  type ActiveRewriteComposition,
  type ActiveRewriteReady
} from './rewrite-composer'
import type { RunKillSwitch } from './kill-switch'

// CR-004 Stage 0 — pre-send guard.
//
// STAGE 0 SENDS NOTHING. There is no send path anywhere in this module tree:
// no provider client is imported or constructed, no ModelRuntime, no session,
// no network, no fs, and no clock is read. This guard exists so Stage 1 (a
// separately authorized Active canary) can re-validate a composition
// immediately before a hypothetical send. In Stage 0 it is exercised only by
// tests; no production code path calls it.
//
// Semantics: re-validate that the per-Run opt-in is still recorded, the kill
// switch is still armed, the binding hashes re-derive and match the Working
// Set / Transition the composition claims, and the composed payload still
// satisfies the continuity checks (system instruction single + byte-identical,
// tool pairs intact, opaque content untouched). Any failure returns a
// FALLBACK_NATIVE verdict AND trips the run kill switch, so the failure is
// permanent for the run — fail closed, never a partial rewrite.

export interface PreSendGuardOk {
  readonly ok: true
  readonly verified: {
    readonly optIn: boolean
    readonly killSwitchArmed: boolean
    readonly bindingVerified: boolean
    readonly systemInstructionByteIdentical: boolean
    readonly toolPairsIntact: boolean
    readonly opaqueUntouched: boolean
    readonly compositionHashVerified: boolean
  }
}

export interface PreSendGuardFallback {
  readonly ok: false
  readonly reason: ActiveFallbackReason
  readonly detail?: string
}

export type PreSendGuardResult = PreSendGuardOk | PreSendGuardFallback

function fail(
  killSwitch: RunKillSwitch,
  reason: ActiveFallbackReason,
  detail?: string
): PreSendGuardFallback {
  // A pre-send failure is permanent for the run: trip the kill switch so every
  // later attempt for this run also falls back to the Native context.
  killSwitch.trip(`pre-send guard: ${reason}`)
  return { ok: false, reason, ...(detail !== undefined ? { detail } : {}) }
}

function rederiveWorkingSetHash(composition: ActiveRewriteReady): string {
  const ws = composition.plannedFrom.workingSet
  return computeWorkingSetLogicalHash({
    runtimeSessionId: ws.runtimeSessionId,
    sequence: ws.sequence,
    plannedFromUniverseSequence: ws.plannedFromUniverseSequence,
    plannedFromUniverseHash: ws.plannedFromUniverseHash,
    previousWorkingSetId: ws.previousWorkingSetId,
    policyVersion: ws.policyVersion,
    planningRequestHash: ws.planningRequestHash,
    items: ws.items
  })
}

function rederiveTransitionHash(composition: ActiveRewriteReady): string {
  const transition = composition.plannedFrom.transition
  return computeTransitionLogicalHash({
    runtimeSessionId: transition.runtimeSessionId,
    sequence: transition.sequence,
    fromWorkingSetId: transition.fromWorkingSetId,
    toWorkingSetId: transition.toWorkingSetId,
    orderedDecisions: transition.orderedDecisions,
    fromTokenEstimate: transition.fromTokenEstimate,
    toTokenEstimate: transition.toTokenEstimate,
    policyVersion: transition.policyVersion
  })
}

/** Composed tool pairs must stay intact: every call has its result and vice versa. */
function composedToolPairsIntact(composition: ActiveRewriteReady): boolean {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of composition.messages) {
    const blocks = Array.isArray(message.content) ? message.content : []
    for (const block of blocks) {
      if (typeof block !== 'object' || block === null) continue
      const typed = block as { type?: unknown; id?: unknown }
      if (typed.type === 'toolCall' && typeof typed.id === 'string') calls.add(typed.id)
    }
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      results.add(message.toolCallId)
    }
  }
  for (const id of calls) {
    if (!results.has(id)) return false
  }
  for (const id of results) {
    if (!calls.has(id)) return false
  }
  return true
}

/**
 * Re-validate a composition immediately before a hypothetical send. Ok, or
 * FALLBACK_NATIVE with the kill switch tripped (permanent for the run).
 */
export function assertRewriteSafe(
  composition: ActiveRewriteComposition,
  killSwitch: RunKillSwitch
): PreSendGuardResult {
  if (composition.kind === 'FALLBACK_NATIVE') {
    // A fallback composition is by definition not sendable as an Active rewrite.
    killSwitch.trip(`pre-send guard: ${composition.reason}`)
    return { ok: false, reason: composition.reason }
  }
  if (killSwitch.isTripped) {
    const record = killSwitch.tripRecord
    return {
      ok: false,
      reason: 'KILL_SWITCH_TRIPPED',
      detail: record === undefined ? 'run kill switch is tripped' : `${record.reason} @ ${record.trippedAt}`
    }
  }
  if (composition.plannedFrom.optIn !== true) {
    return fail(killSwitch, 'NOT_OPTED_IN', 'composition does not record an active-mode opt-in')
  }
  if (composition.binding.runId !== killSwitch.runId) {
    return fail(
      killSwitch,
      'RUN_ID_MISMATCH',
      `composition run '${composition.binding.runId}' does not match kill-switch run '${killSwitch.runId}'`
    )
  }
  if (composition.systemInstruction.length === 0) {
    return fail(killSwitch, 'SYSTEM_INSTRUCTION_ABSENT')
  }

  // Binding re-derivation: hashes must match both the source objects and the
  // binding the composition carries.
  const wsHash = rederiveWorkingSetHash(composition)
  if (
    wsHash !== composition.plannedFrom.workingSet.logicalHash ||
    wsHash !== composition.binding.workingSetLogicalHash
  ) {
    return fail(killSwitch, 'BINDING_MISMATCH', 'working set logical hash mismatch')
  }
  const transitionHash = rederiveTransitionHash(composition)
  if (
    transitionHash !== composition.plannedFrom.transition.logicalHash ||
    transitionHash !== composition.binding.transitionLogicalHash
  ) {
    return fail(killSwitch, 'BINDING_MISMATCH', 'transition logical hash mismatch')
  }

  // Payload re-derivation: the system instruction must still hash to the same
  // value (byte-identical), and the message list must not have been tampered
  // with (this also covers opaque/reasoning blocks, which are fingerprinted).
  if (activeSystemInstructionHash(composition.systemInstruction) !== composition.systemInstructionHash) {
    return fail(killSwitch, 'SYSTEM_INSTRUCTION_ALTERED')
  }
  if (activeMessagesHash(composition.messages) !== composition.messagesHash) {
    return fail(killSwitch, 'COMPOSITION_TAMPERED', 'composed message fingerprints changed')
  }
  if (
    sha256Hex(
      `active-composition-v1|${composition.systemInstructionHash}|${composition.messagesHash}`
    ) !== composition.compositionHash
  ) {
    return fail(killSwitch, 'COMPOSITION_TAMPERED', 'composition hash mismatch')
  }
  if (!composedToolPairsIntact(composition)) {
    return fail(killSwitch, 'TOOL_PAIR_SPLIT', 'composed output contains a split tool pair')
  }
  for (const message of composition.messages) {
    if (message.role === 'system') {
      return fail(killSwitch, 'SYSTEM_INSTRUCTION_DUPLICATED')
    }
  }

  return {
    ok: true,
    verified: {
      optIn: true,
      killSwitchArmed: true,
      bindingVerified: true,
      systemInstructionByteIdentical: true,
      toolPairsIntact: true,
      opaqueUntouched: true,
      compositionHashVerified: true
    }
  }
}
