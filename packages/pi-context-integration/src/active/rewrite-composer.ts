import {
  sha256Hex,
  type ContextTransition,
  type ContextWorkingSet
} from '@canvas-agent/context-runtime'
import { buildMessageFingerprint, type PiMessageView } from '../pi-message-mapper'
import { PI_ACTIVE_HARNESS, checkCapability } from './capability-profile'
import type { RunKillSwitch } from './kill-switch'
import { analyzeNativeMessages } from './native-message-analysis'

// CR-004 Stage 0 — OFFLINE Active-rewrite composer (Pi-only).
//
// Composes a candidate Active rewrite of the native Pi AgentMessage list from
// a policy-v0 Working Set + Transition: messages whose sources were REMOVEd
// are dropped as WHOLE messages; everything else is carried through by
// reference (byte-identical). The system instruction is NOT an AgentMessage in
// Pi (it is assembled out-of-band), so it travels as a single leading string
// and must be byte-identical. Opaque/reasoning blocks are always preserved
// verbatim.
//
// Amendment (2026-08-27, pre-Stage-1): pair-consistent tool-block removal.
// Real-task assistant messages usually MIX text/thinking blocks with toolCall
// blocks; whole-message-only removal would make every real rewrite fall back
// (MESSAGE_MIXED_REMOVAL). When a transition REMOVEs the source of a toolCall
// block inside such a mixed assistant message, the composer now drops ONLY
// that toolCall block (text/thinking blocks stay byte-identical) AND the
// paired toolResult message, so the tool-call/result pair leaves the context
// together or not at all.
//
// Fail closed: ANY unsupported or inconsistent item returns FALLBACK_NATIVE —
// never a partial rewrite. This module sends nothing: no provider client, no
// ModelRuntime, no session, no network, no fs, no clock. Deterministic: the
// same inputs compose identical outputs (no timestamps inside).

export const ACTIVE_FALLBACK_REASONS = [
  'NOT_OPTED_IN',
  'HARNESS_UNSUPPORTED',
  'UNSUPPORTED_MESSAGE_KIND',
  'EMPTY_NATIVE_CONTEXT',
  'KILL_SWITCH_TRIPPED',
  'KILL_SWITCH_TRIPPED_MID_COMPOSITION',
  'SYSTEM_INSTRUCTION_ABSENT',
  'SYSTEM_INSTRUCTION_ALTERED',
  'SYSTEM_INSTRUCTION_DUPLICATED',
  'TRANSITION_INVARIANT_VIOLATED',
  'BUDGET_INVARIANT_VIOLATED',
  'UNEXPLAINED_MEMBERSHIP',
  'MESSAGE_MIXED_REMOVAL',
  'EMPTY_REMAINDER_AFTER_BLOCK_REMOVAL',
  'TOOL_PAIR_SPLIT',
  'OPAQUE_CONTENT_DROPPED',
  'MANDATORY_ITEM_MISSING',
  'BINDING_MISMATCH',
  'RUN_ID_MISMATCH',
  'COMPOSITION_TAMPERED'
] as const
export type ActiveFallbackReason = (typeof ACTIVE_FALLBACK_REASONS)[number]

export interface ActiveRewriteBinding {
  readonly workingSetLogicalHash: string
  readonly transitionLogicalHash: string
  readonly runId: string
}

export interface ActiveRewriteContinuity {
  readonly optIn: boolean
  readonly harnessSupported: boolean
  readonly killSwitchArmed: boolean
  readonly transitionInvariantsConsistent: boolean
  readonly membershipExplained: boolean
  readonly toolPairsIntact: boolean
  readonly toolPairCount: number
  readonly systemInstructionPresent: boolean
  readonly systemInstructionByteIdentical: boolean
  readonly opaqueItemsPreservedVerbatim: boolean
  readonly opaqueBlockCount: number
  readonly mandatoryPinnedReasserted: boolean
  readonly removedSourceCount: number
  /**
   * toolCall blocks dropped from MIXED assistant messages (amendment
   * 2026-08-27): each dropped block's paired toolResult message was dropped
   * too, and every other block of the message survived byte-identical.
   */
  readonly toolBlocksRemoved: number
}

export interface ActiveRewriteFallback {
  readonly kind: 'FALLBACK_NATIVE'
  readonly reason: ActiveFallbackReason
  readonly detail?: string
}

export interface ActiveRewriteReady {
  readonly kind: 'REWRITE_READY'
  /** Single leading system instruction, byte-identical to the input. */
  readonly systemInstruction: string
  /**
   * Composed message list: original order, REMOVEd sources dropped whole;
   * MIXED assistant messages that lost REMOVEd toolCall blocks appear as new
   * message objects with those blocks removed (all other blocks byte-identical).
   */
  readonly messages: readonly PiMessageView[]
  readonly binding: ActiveRewriteBinding
  readonly continuity: ActiveRewriteContinuity
  /** Source keys the transition REMOVEd (sorted; audit only). */
  readonly removedSourceKeys: readonly string[]
  readonly systemInstructionHash: string
  readonly messagesHash: string
  readonly compositionHash: string
  /** Inputs the pre-send guard re-derives binding hashes from (references). */
  readonly plannedFrom: {
    readonly workingSet: ContextWorkingSet
    readonly transition: ContextTransition
    readonly harness: string
    readonly optIn: boolean
  }
}

export type ActiveRewriteComposition = ActiveRewriteFallback | ActiveRewriteReady

export interface ComposeActiveRewriteInput {
  readonly messages: readonly PiMessageView[]
  readonly workingSet: ContextWorkingSet
  readonly transition: ContextTransition
  readonly runId: string
  readonly killSwitch: RunKillSwitch
  /** Explicit per-Run experimental opt-in. Default false => immediate fallback. */
  readonly activeModeOptIn?: boolean
  /** Harness id; the Active capability profile supports 'PI' only. */
  readonly harness?: string
  /** The out-of-band Pi system instruction; absent/empty => fallback. */
  readonly systemInstruction?: string
  /** Deterministic test hook, invoked after all checks just before the final kill-switch re-check. */
  readonly beforeFinalValidation?: () => void
}

function fallback(reason: ActiveFallbackReason, detail?: string): ActiveRewriteFallback {
  return { kind: 'FALLBACK_NATIVE', reason, ...(detail !== undefined ? { detail } : {}) }
}

/** Deterministic fingerprint of one native message (reuses the mapper's). */
export function activeMessageFingerprint(message: PiMessageView): string {
  const toolContext: { toolName?: string; toolCallId?: string; isError?: boolean } = {}
  if (message.toolName !== undefined) toolContext.toolName = message.toolName
  if (message.toolCallId !== undefined) toolContext.toolCallId = message.toolCallId
  if (message.isError !== undefined) toolContext.isError = message.isError
  const { fingerprintText, binaryBlocks } = buildMessageFingerprint(message, toolContext)
  const binary = binaryBlocks
    .map((block) => `${block.type}:${String(block.byteLength)}:${block.contentHash}`)
    .join(',')
  return `${fingerprintText}|${binary}`
}

export function activeSystemInstructionHash(systemInstruction: string): string {
  return sha256Hex(`active-system-v1|${systemInstruction}`)
}

export function activeMessagesHash(messages: readonly PiMessageView[]): string {
  return sha256Hex(
    ['active-messages-v1', ...messages.map((message) => activeMessageFingerprint(message))].join(
      '\u241F'
    )
  )
}

function checkTransitionInvariants(
  workingSet: ContextWorkingSet,
  transition: ContextTransition
): ActiveFallbackReason | undefined {
  if (transition.toWorkingSetId !== workingSet.workingSetId) {
    return 'TRANSITION_INVARIANT_VIOLATED'
  }
  if (transition.fromWorkingSetId !== workingSet.previousWorkingSetId) {
    return 'TRANSITION_INVARIANT_VIOLATED'
  }
  if (transition.runtimeSessionId !== workingSet.runtimeSessionId) {
    return 'TRANSITION_INVARIANT_VIOLATED'
  }
  if (transition.toTokenEstimate !== workingSet.totalTokenEstimate) {
    return 'TRANSITION_INVARIANT_VIOLATED'
  }
  if (workingSet.totalTokenEstimate > workingSet.budget.maxSemanticTokens) {
    return 'BUDGET_INVARIANT_VIOLATED'
  }
  const itemKeys = new Set<string>()
  for (const item of workingSet.items) {
    for (const key of item.sourceKeys) itemKeys.add(key)
  }
  const decisionKeys = new Set<string>()
  for (const decision of transition.orderedDecisions) {
    if (decisionKeys.has(decision.sourceKey)) return 'TRANSITION_INVARIANT_VIOLATED'
    decisionKeys.add(decision.sourceKey)
    if (decision.kind === 'REMOVE' && itemKeys.has(decision.sourceKey)) {
      // The transition claims REMOVE for a source the Working Set still holds.
      return 'TRANSITION_INVARIANT_VIOLATED'
    }
    if (decision.kind !== 'REMOVE' && !itemKeys.has(decision.sourceKey)) {
      // A membership decision (KEEP/ADD/REPLACE/REHYDRATE/...) without an item.
      return 'TRANSITION_INVARIANT_VIOLATED'
    }
  }
  return undefined
}

/**
 * Compose an Active rewrite offline. Returns REWRITE_READY only when every
 * safety property holds; otherwise FALLBACK_NATIVE with a reason. Never sends.
 */
export function composeActiveRewrite(input: ComposeActiveRewriteInput): ActiveRewriteComposition {
  // 1. Explicit per-Run opt-in: Native context stays the default.
  if (input.activeModeOptIn !== true) {
    return fallback('NOT_OPTED_IN', 'active mode requires an explicit per-Run experimental opt-in')
  }
  // 2. Kill switch already tripped: permanent Native fallback for this run.
  if (input.killSwitch.isTripped) {
    const record = input.killSwitch.tripRecord
    return fallback(
      'KILL_SWITCH_TRIPPED',
      record === undefined ? 'run kill switch is tripped' : `${record.reason} @ ${record.trippedAt}`
    )
  }
  const harness = input.harness ?? PI_ACTIVE_HARNESS
  const capability = checkCapability({ harness, messages: input.messages })
  if (!capability.supported) {
    return fallback(capability.reason ?? 'HARNESS_UNSUPPORTED', capability.detail)
  }
  if (input.messages.length === 0) {
    return fallback('EMPTY_NATIVE_CONTEXT', 'nothing to compose: the native message list is empty')
  }
  const systemInstruction = input.systemInstruction ?? ''
  if (systemInstruction.length === 0) {
    return fallback('SYSTEM_INSTRUCTION_ABSENT', 'the system instruction must be present')
  }

  // 3. Working Set / Transition structural invariants.
  const invariantFailure = checkTransitionInvariants(input.workingSet, input.transition)
  if (invariantFailure !== undefined) {
    return fallback(invariantFailure, 'working set / transition invariants are inconsistent')
  }

  // 4. Membership classification with the SAME source derivation as the planner.
  const retainedKeys = new Set<string>()
  for (const item of input.workingSet.items) {
    for (const key of item.sourceKeys) retainedKeys.add(key)
  }
  const removedKeys = new Set<string>()
  for (const decision of input.transition.orderedDecisions) {
    if (decision.kind === 'REMOVE') removedKeys.add(decision.sourceKey)
  }
  const analysis = analyzeNativeMessages(input.messages, {
    runtimeSessionId: input.runId,
    modelCallSequence: input.workingSet.sequence
  })

  // Amendment (2026-08-27): per-message removal plan. WHOLE keeps the Stage 0
  // whole-message-drop semantics; BLOCKS drops only the REMOVEd toolCall
  // blocks of a MIXED assistant message (text/thinking stay byte-identical,
  // the paired toolResult message is dropped alongside by the pair check).
  interface BlockRemovalPlan {
    readonly droppedToolCallIds: readonly string[]
    readonly droppedBlockIndexes: readonly number[]
  }
  type AssistantRemovalPlan =
    | { readonly kind: 'BLOCKS'; readonly ids: readonly string[]; readonly indexes: readonly number[] }
    | { readonly kind: 'WHOLE' }
    | {
        readonly kind: 'REFUSE'
        readonly reason: ActiveFallbackReason
        readonly detail: string
      }

  const isToolCallBlock = (block: unknown): block is { type: string; id?: unknown } =>
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'toolCall'

  // Plan removal for an assistant message carrying REMOVEd tool-call sources.
  // Returns undefined when the message needs the legacy whole-message path.
  const planAssistantRemoval = (
    message: (typeof analysis.messages)[number],
    original: PiMessageView
  ): AssistantRemovalPlan | undefined => {
    if (message.role !== 'assistant') return undefined
    // Removed assistant sources are always run/tool-call:// identities (the
    // shadow decomposition attributes only toolCall blocks EXACTly); refuse
    // defensively if any other shape ever appears.
    for (const key of message.sourceKeys) {
      if (removedKeys.has(key) && !key.startsWith('run/tool-call://')) {
        return {
          kind: 'REFUSE',
          reason: 'MESSAGE_MIXED_REMOVAL',
          detail: `message ${String(message.index)} carries REMOVEd source '${key}' that is not a tool-call identity`
        }
      }
    }
    const content = original.content
    if (!Array.isArray(content)) return undefined // no blocks to drop; legacy path decides
    const ids: string[] = []
    const indexes: number[] = []
    let textBlockPresent = false
    let meaningfulRemainder = false
    for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
      const block = content[blockIndex]
      if (isToolCallBlock(block)) {
        const id = block.id
        if (typeof id === 'string' && id !== '' && removedKeys.has(`run/tool-call://${id}`)) {
          ids.push(id)
          indexes.push(blockIndex)
          continue
        }
        meaningfulRemainder = true // retained (or unattributed) toolCall block stays
        continue
      }
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text'
      ) {
        textBlockPresent = true
        const text = (block as { text?: unknown }).text
        if (typeof text === 'string' && text.length > 0) meaningfulRemainder = true
        continue
      }
      // thinking / image / structured / unrecognized entries are kept verbatim
      // and keep the message alive; only text blocks may be empty.
      meaningfulRemainder = true
    }
    if (indexes.length === 0) return undefined // no removable call block here
    if (meaningfulRemainder) return { kind: 'BLOCKS', ids, indexes }
    if (!textBlockPresent && message.opaqueBlockCount === 0) return { kind: 'WHOLE' }
    return {
      kind: 'REFUSE',
      reason: 'EMPTY_REMAINDER_AFTER_BLOCK_REMOVAL',
      detail: `dropping toolCall block(s) ${ids.join(', ')} would leave message ${String(
        message.index
      )} with no meaningful content${textBlockPresent ? ' (text block present but empty)' : ''}`
    }
  }

  const dropped = new Set<number>()
  const blockRemovals = new Map<number, BlockRemovalPlan>()
  let toolBlocksRemoved = 0
  for (const message of analysis.messages) {
    const removedSources: string[] = []
    let retainedSource = false
    for (const key of message.sourceKeys) {
      if (removedKeys.has(key)) removedSources.push(key)
      else if (retainedKeys.has(key)) retainedSource = true
      else {
        return fallback(
          'UNEXPLAINED_MEMBERSHIP',
          `message ${String(message.index)} maps to source '${key}' that is neither retained nor REMOVEd`
        )
      }
    }
    if (removedSources.length === 0) continue

    const plan = planAssistantRemoval(message, input.messages[message.index]!)
    if (plan !== undefined) {
      if (plan.kind === 'REFUSE') return fallback(plan.reason, plan.detail)
      if (plan.kind === 'BLOCKS') {
        blockRemovals.set(message.index, {
          droppedToolCallIds: plan.ids,
          droppedBlockIndexes: plan.indexes
        })
        toolBlocksRemoved += plan.ids.length
        continue
      }
      // WHOLE: a pure toolCall message whose calls are all REMOVEd falls
      // through to the legacy whole-drop checks below (it cannot carry a
      // retained source — a retained call block would be a meaningful
      // remainder — but the check below stays as a belt-and-suspenders guard).
    }
    if (retainedSource) {
      return fallback(
        'MESSAGE_MIXED_REMOVAL',
        `message ${String(message.index)} mixes REMOVEd sources (${removedSources.join(', ')}) with retained sources`
      )
    }
    if (message.opaqueBlockCount > 0) {
      return fallback(
        'OPAQUE_CONTENT_DROPPED',
        `message ${String(message.index)} carries opaque/reasoning blocks and may not be dropped`
      )
    }
    if (!message.droppable) {
      return fallback(
        'MESSAGE_MIXED_REMOVAL',
        `message ${String(message.index)} mixes REMOVEd sources (${removedSources.join(', ')}) with unattributed content`
      )
    }
    dropped.add(message.index)
  }

  // 5. Tool-call/result pair continuity: all-or-nothing, now at block
  // granularity — a toolCall dropped as a BLOCK counts as dropped.
  const callFateOf = (pair: (typeof analysis.toolPairs)[number]): 'kept' | 'dropped' | 'absent' => {
    const index = pair.callMessageIndex
    if (index === undefined) return 'absent'
    if (dropped.has(index)) return 'dropped'
    const plan = blockRemovals.get(index)
    if (plan !== undefined && plan.droppedToolCallIds.includes(pair.toolCallId)) {
      return 'dropped'
    }
    return 'kept'
  }
  const resultFateOf = (
    pair: (typeof analysis.toolPairs)[number]
  ): 'kept' | 'dropped' | 'absent' => {
    const index = pair.resultMessageIndex
    if (index === undefined) return 'absent'
    return dropped.has(index) ? 'dropped' : 'kept'
  }
  for (const pair of analysis.toolPairs) {
    if (pair.callMessageIndex === undefined || pair.resultMessageIndex === undefined) continue
    const callFate = callFateOf(pair)
    const resultFate = resultFateOf(pair)
    if (callFate !== resultFate) {
      return fallback(
        'TOOL_PAIR_SPLIT',
        `tool pair '${pair.toolCallId}' would be split (call ${callFate}, result ${resultFate})`
      )
    }
  }

  // 6. Mandatory/pinned re-assertion against the composed output. A message
  // that only lost REMOVEd toolCall blocks still carries its retained sources.
  const keptKeys = new Set<string>()
  for (const message of analysis.messages) {
    if (dropped.has(message.index)) continue
    for (const key of message.sourceKeys) {
      if (!removedKeys.has(key)) keptKeys.add(key)
    }
  }
  for (const item of input.workingSet.items) {
    if (item.protection !== 'MANDATORY' && item.protection !== 'PINNED') continue
    for (const key of item.sourceKeys) {
      if (!keptKeys.has(key)) {
        return fallback(
          'MANDATORY_ITEM_MISSING',
          `working set claims ${item.protection} for '${key}' but no composed message carries it`
        )
      }
    }
  }

  // 7. Final kill-switch re-check (a trip during composition is permanent).
  input.beforeFinalValidation?.()
  if (input.killSwitch.isTripped) {
    const record = input.killSwitch.tripRecord
    return fallback(
      'KILL_SWITCH_TRIPPED_MID_COMPOSITION',
      record === undefined ? 'run kill switch tripped during composition' : `${record.reason} @ ${record.trippedAt}`
    )
  }

  // Amendment output rule: BLOCKS messages are rebuilt as new message objects
  // whose content array drops exactly the planned toolCall blocks; every other
  // block travels by reference (byte-identical) and the original input array
  // is never mutated.
  const composed: PiMessageView[] = []
  for (let index = 0; index < input.messages.length; index += 1) {
    if (dropped.has(index)) continue
    const plan = blockRemovals.get(index)
    const original = input.messages[index]!
    if (plan === undefined || !Array.isArray(original.content)) {
      composed.push(original)
      continue
    }
    const content = original.content.filter(
      (_, blockIndex) => !plan.droppedBlockIndexes.includes(blockIndex)
    )
    composed.push({ ...original, content })
  }
  const systemInstructionHash = activeSystemInstructionHash(systemInstruction)
  const messagesHash = activeMessagesHash(composed)
  const compositionHash = sha256Hex(
    `active-composition-v1|${systemInstructionHash}|${messagesHash}`
  )
  return {
    kind: 'REWRITE_READY',
    systemInstruction,
    messages: composed,
    binding: {
      workingSetLogicalHash: input.workingSet.logicalHash,
      transitionLogicalHash: input.transition.logicalHash,
      runId: input.runId
    },
    continuity: {
      optIn: true,
      harnessSupported: true,
      killSwitchArmed: true,
      transitionInvariantsConsistent: true,
      membershipExplained: true,
      toolPairsIntact: true,
      toolPairCount: analysis.toolPairs.length,
      systemInstructionPresent: true,
      systemInstructionByteIdentical: true,
      opaqueItemsPreservedVerbatim: true,
      opaqueBlockCount: analysis.opaqueBlockCount,
      mandatoryPinnedReasserted: true,
      removedSourceCount: removedKeys.size,
      toolBlocksRemoved
    },
    removedSourceKeys: [...removedKeys].sort(),
    systemInstructionHash,
    messagesHash,
    compositionHash,
    plannedFrom: {
      workingSet: input.workingSet,
      transition: input.transition,
      harness,
      optIn: true
    }
  }
}
