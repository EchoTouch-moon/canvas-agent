import { existsSync } from 'node:fs'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { createRunKillSwitch, type RunKillSwitch } from '../active/kill-switch'
import {
  assertRewriteSafe,
  type PreSendGuardResult
} from '../active/pre-send-guard'
import {
  composeActiveRewrite,
  type ActiveRewriteComposition,
  type ActiveRewriteReady
} from '../active/rewrite-composer'
import type { C0ScenarioExecutor } from '../smoke/c0-scenarios'
import type { PiContentBlockView, PiMessageView } from '../pi-message-mapper'

// CR-004 Stage 1 — Active intervention extension (Pi-only, first Active send).
//
// This extension wraps the SAME observation machinery the C0 executor uses
// (PiContextShadowObserver + the enriched shadow planner path via
// C0ScenarioExecutor), so the Working Set is always planned over REAL
// conversation sources (decomposePiMessage attributions). On every `context`
// event it:
//
//   1. checks the operator kill-switch file (if configured); presence trips
//      the in-process per-Run kill switch permanently;
//   2. evaluates the INTERVENTION BOUNDARY: an edit/write-class toolCall for
//      some path P has ALREADY appeared in a prior assistant message, earlier
//      read-class tool results for P exist and are already active in the
//      latest planned Working Set, the once-only latch is unset, and the kill
//      switch is armed;
//   3. at that boundary it marks the earlier read results for P as superseded
//      (SOURCE_SUPERSEDED lifecycle signals + exclusions — the exact E4
//      vocabulary of c0-scenarios), advances the observation/planning chain,
//      then composes the Active rewrite (activeModeOptIn, harness 'PI', the
//      per-Run kill switch) over the REAL planned Working Set + Transition;
//      REWRITE_READY + pre-send guard PASS => the composition's messages
//      REPLACE the model-visible context (the first Active rewrite) and the
//      once-only latch is set. ANY fallback or guard failure records its
//      machine-readable reason, sets the latch (one attempt only — a fallback
//      is evidence, the leg continues natively), and returns the originals.
//
// After the latch, later events observe only. The extension performs no
// provider call itself: it only returns the replacement message list through
// Pi's context seam. Evidence per event goes to an in-memory collector
// (metadata-only: hashes, counts and source keys; never message content).

/** Tool names treated as read-class evidence (results become superseded). */
export const ACTIVE_READ_TOOLS = ['read'] as const
/** Tool names treated as edit/write-class (their appearance is the boundary). */
export const ACTIVE_EDIT_TOOLS = ['edit', 'write'] as const

export interface InterventionBoundary {
  /** Repository path the edit/write-class toolCall targets. */
  readonly path: string
  /** toolCallId of the first qualifying edit/write-class call. */
  readonly editToolCallId: string
  /** toolCallIds of earlier read-class calls for the same path whose results are in context. */
  readonly readToolCallIds: readonly string[]
}

export interface ActiveRewriteEventEvidence {
  /** Observer sequence for this context event (1-based, monotonic). */
  readonly sequence: number
  /** CR-001 token estimate for the observed native context. */
  readonly observedTokenEstimate: number
  readonly boundaryReached: boolean
  /** Whether the intervention attempt actually ran (compose + guard). */
  readonly interventionAttempted: boolean
  readonly compositionVerdict: 'NOT_ATTEMPTED' | 'REWRITE_READY' | 'FALLBACK_NATIVE'
  readonly fallbackReason?: string
  /** Bounded detail for exception-class fallbacks (never message content). */
  readonly compositionError?: string
  readonly guardVerdict: 'NOT_ATTEMPTED' | 'PASS' | 'FALLBACK_NATIVE'
  readonly guardFallbackReason?: string
  /** True when the composition's messages were returned as the Active rewrite. */
  readonly sentRewrite: boolean
  readonly bindingHashes?:
    | {
        readonly workingSetLogicalHash: string
        readonly transitionLogicalHash: string
        readonly compositionHash: string
      }
    | undefined
  readonly killSwitchTripped: boolean
  /** toolCall blocks dropped from MIXED assistant messages (Stage 0 amendment). */
  readonly toolBlocksRemoved: number
  /** The path whose earlier reads the intervention superseded, if any. */
  readonly interventionPath?: string
  /** Sorted REMOVEd source keys (audit only; present when composed READY). */
  readonly removedSourceKeys?: readonly string[]
  /** Message count of the composed rewrite (present when composed READY). */
  readonly composedMessageCount?: number
}

/** One-shot intervention summary for the run's pairing evidence. */
export interface ActiveRewriteInterventionSummary {
  readonly boundarySequence: number | null
  readonly interventionPath: string | null
  readonly compositionVerdict: 'NOT_ATTEMPTED' | 'REWRITE_READY' | 'FALLBACK_NATIVE'
  readonly fallbackReason?: string
  readonly guardVerdict: 'NOT_ATTEMPTED' | 'PASS' | 'FALLBACK_NATIVE'
  readonly guardFallbackReason?: string
  readonly sentRewrite: boolean
  readonly killSwitchTripped: boolean
  readonly bindingHashes?:
    | {
        readonly workingSetLogicalHash: string
        readonly transitionLogicalHash: string
        readonly compositionHash: string
      }
    | undefined
  readonly toolBlocksRemoved: number
  readonly removedSourceKeys: readonly string[]
  readonly composedMessageCount: number | null
  readonly latchSetAtSequence: number | null
}

export interface ActiveRewriteEvidenceCollector {
  readonly events: readonly ActiveRewriteEventEvidence[]
  /** Summary of the single intervention attempt (idle until the latch sets). */
  readonly intervention: ActiveRewriteInterventionSummary
  record(event: ActiveRewriteEventEvidence): void
}

export function idleInterventionSummary(): ActiveRewriteInterventionSummary {
  return {
    boundarySequence: null,
    interventionPath: null,
    compositionVerdict: 'NOT_ATTEMPTED',
    guardVerdict: 'NOT_ATTEMPTED',
    sentRewrite: false,
    killSwitchTripped: false,
    toolBlocksRemoved: 0,
    removedSourceKeys: [],
    composedMessageCount: null,
    latchSetAtSequence: null
  }
}

function interventionSummaryFrom(
  event: ActiveRewriteEventEvidence,
  sequence: number
): ActiveRewriteInterventionSummary {
  return {
    boundarySequence: event.boundaryReached ? sequence : null,
    interventionPath: event.interventionPath ?? null,
    compositionVerdict: event.compositionVerdict,
    ...(event.fallbackReason !== undefined ? { fallbackReason: event.fallbackReason } : {}),
    guardVerdict: event.guardVerdict,
    ...(event.guardFallbackReason !== undefined
      ? { guardFallbackReason: event.guardFallbackReason }
      : {}),
    sentRewrite: event.sentRewrite,
    killSwitchTripped: event.killSwitchTripped,
    ...(event.bindingHashes !== undefined ? { bindingHashes: event.bindingHashes } : {}),
    toolBlocksRemoved: event.toolBlocksRemoved,
    removedSourceKeys: [...(event.removedSourceKeys ?? [])],
    composedMessageCount: event.composedMessageCount ?? null,
    latchSetAtSequence: sequence
  }
}

export class InMemoryActiveRewriteEvidenceCollector implements ActiveRewriteEvidenceCollector {
  private readonly evidence: ActiveRewriteEventEvidence[] = []
  private latched: ActiveRewriteInterventionSummary | null = null

  record(event: ActiveRewriteEventEvidence): void {
    this.evidence.push(event)
    if (event.interventionAttempted && this.latched === null) {
      this.latched = interventionSummaryFrom(event, event.sequence)
    }
  }

  get events(): readonly ActiveRewriteEventEvidence[] {
    return [...this.evidence]
  }

  get intervention(): ActiveRewriteInterventionSummary {
    return this.latched ?? idleInterventionSummary()
  }
}

export interface ActiveRewriteExtensionOptions {
  /** Run identity the composition binds to (must match the kill switch run). */
  readonly runId: string
  /**
   * The out-of-band Pi system instruction carrier. The Active seam never
   * rewrites it; it travels byte-identical through the composition record.
   */
  readonly systemInstruction: string
  /** The shared observation/planning machinery (same wiring the C0 executor uses). */
  readonly executor: C0ScenarioExecutor
  /** Per-Run kill switch; trips are permanent for this run. Default: fresh switch. */
  readonly killSwitch?: RunKillSwitch
  /** Operator kill-switch file: its presence trips the run kill switch at the event check. */
  readonly killSwitchFilePath?: string
  /** Injectable file check for deterministic offline tests. */
  readonly killSwitchFileCheck?: () => boolean
  readonly evidence: ActiveRewriteEvidenceCollector
  readonly readToolNames?: readonly string[]
  readonly editToolNames?: readonly string[]
}

function normalizePath(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value
}

function pathOf(block: PiContentBlockView): string | null {
  const args = block.arguments
  if (typeof args !== 'object' || args === null) return null
  const record = args as Record<string, unknown>
  for (const field of ['path', 'filePath'] as const) {
    const value = record[field]
    if (typeof value === 'string' && value.length > 0) return normalizePath(value)
  }
  return null
}

function blocksOf(message: PiMessageView): readonly PiContentBlockView[] {
  const content = message.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) {
    return content.filter(
      (block): block is PiContentBlockView =>
        typeof block === 'object' &&
        block !== null &&
        typeof (block as { type?: unknown }).type === 'string'
    )
  }
  return []
}

function resultCallIds(messages: readonly PiMessageView[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      ids.add(message.toolCallId)
    }
  }
  return ids
}

/**
 * Deterministically detect the intervention boundary in a native message
 * list: the FIRST edit/write-class toolCall (message order, then block order)
 * for some path P that appears in an assistant message AFTER an earlier
 * read-class toolCall for the same P whose toolResult is also already present.
 * Pure function of the message list; no clock, no I/O.
 */
export function detectInterventionBoundary(
  messages: readonly PiMessageView[],
  options: {
    readonly readToolNames?: readonly string[]
    readonly editToolNames?: readonly string[]
  } = {}
): InterventionBoundary | undefined {
  const readTools = new Set<string>(options.readToolNames ?? ACTIVE_READ_TOOLS)
  const editTools = new Set<string>(options.editToolNames ?? ACTIVE_EDIT_TOOLS)
  const results = resultCallIds(messages)
  // path -> read call ids observed so far (scan order)
  const readsByPath = new Map<string, string[]>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of blocksOf(message)) {
      if (block.type !== 'toolCall' || typeof block.id !== 'string' || block.id === '') continue
      const name = block.name ?? ''
      const path = pathOf(block)
      if (readTools.has(name)) {
        if (path === null) continue
        const calls = readsByPath.get(path) ?? []
        calls.push(block.id)
        readsByPath.set(path, calls)
        continue
      }
      if (editTools.has(name) && path !== null) {
        const reads = (readsByPath.get(path) ?? []).filter((callId) => results.has(callId))
        if (reads.length > 0) {
          return { path, editToolCallId: block.id, readToolCallIds: reads }
        }
      }
    }
  }
  return undefined
}

function workingSetKeys(executor: C0ScenarioExecutor): ReadonlySet<string> {
  return new Set(executor.latestWorkingSet?.items.flatMap((item) => item.sourceKeys) ?? [])
}

/**
 * Pi extension factory for the Stage 1 Active intervention leg. The `context`
 * handler observes every event; at the (single) intervention boundary it
 * returns the composed rewrite, otherwise the original messages.
 */
export function createActiveRewriteExtension(
  options: ActiveRewriteExtensionOptions
): ExtensionFactory {
  const killSwitch =
    options.killSwitch ??
    createRunKillSwitch(options.runId, { now: () => new Date().toISOString() })
  const killSwitchFilePath = options.killSwitchFilePath
  const fileCheck =
    options.killSwitchFileCheck ??
    (killSwitchFilePath !== undefined ? () => existsSync(killSwitchFilePath) : () => false)
  let latchSet = false

  return (pi: ExtensionAPI) => {
    pi.on('context', async (event: ContextEvent) => {
      // 1. Operator kill-switch file: presence trips the run switch (permanent).
      if (fileCheck()) {
        killSwitch.trip(`operator kill-switch file present: ${options.killSwitchFilePath ?? ''}`)
      }

      const messages = event.messages as unknown as readonly PiMessageView[]

      // 2. Boundary evaluation (skipped once the latch is set or the switch
      //    tripped). The read pair must already be ACTIVE in the latest
      //    planned Working Set so the intervention plan can actually REMOVE it
      //    (policy-v0 REMOVEs only previously-active sources); otherwise the
      //    boundary waits for the next event instead of wasting the single
      //    attempt on a guaranteed fallback.
      let fire: InterventionBoundary | undefined
      if (!latchSet && !killSwitch.isTripped) {
        const candidate = detectInterventionBoundary(messages, {
          ...(options.readToolNames !== undefined ? { readToolNames: options.readToolNames } : {}),
          ...(options.editToolNames !== undefined ? { editToolNames: options.editToolNames } : {})
        })
        if (candidate !== undefined) {
          const activeKeys = workingSetKeys(options.executor)
          const planned = candidate.readToolCallIds.every((callId) => {
            // The call side may already have left the Working Set; the RESULT
            // side is the evidence the rewrite removes.
            return (
              activeKeys.has(`run/tool-result://${callId}`) ||
              activeKeys.has(`run/tool-call://${callId}`)
            )
          })
          if (planned) fire = candidate
        }
      }

      if (fire !== undefined) {
        // 3. Mark the earlier read results for P as superseded — the exact E4
        //    lifecycle vocabulary (SOURCE_SUPERSEDED) the C0 scenario suite
        //    uses, plus the paired exclusions that let policy-v0 emit REMOVE
        //    with reason SUPERSEDED.
        const supersededKeys: string[] = []
        for (const callId of fire.readToolCallIds) {
          supersededKeys.push(`run/tool-call://${callId}`, `run/tool-result://${callId}`)
        }
        options.executor.beginTurn({
          label: `active-intervention:${fire.path}`,
          prompt: '',
          events: [
            {
              kind: 'SOURCE_SUPERSEDED',
              sourceKeys: supersededKeys,
              evidenceRef: `cr004-s1:intervention:${fire.editToolCallId}:${fire.path}`
            }
          ],
          patch: { excludedSourceKeys: supersededKeys }
        })
      }

      // 4. Advance the observation/planning chain (identical bookkeeping to
      //    the shadow path: one sequence per event, replay-verified boundary).
      options.executor.observeBoundary(messages)
      const sequence = options.executor.observationCount
      const observedTokenEstimate =
        options.executor.base.inMemory.last()?.observedMessageTokenEstimate ?? 0

      if (fire === undefined) {
        options.evidence.record({
          sequence,
          observedTokenEstimate,
          boundaryReached: false,
          interventionAttempted: false,
          compositionVerdict: 'NOT_ATTEMPTED',
          guardVerdict: 'NOT_ATTEMPTED',
          sentRewrite: false,
          killSwitchTripped: killSwitch.isTripped,
          toolBlocksRemoved: 0
        })
        return { messages: event.messages }
      }

      // 5. THE intervention attempt — once only, whatever the outcome.
      const boundary = fire
      latchSet = true
      const workingSet = options.executor.latestWorkingSet
      const transition = options.executor.latestTransitionResult

      const recordFallback = (
        reason: string,
        detail?: string,
        guardReason?: string,
        composition?: ActiveRewriteReady
      ): { messages: ContextEvent['messages'] } => {
        options.evidence.record({
          sequence,
          observedTokenEstimate,
          boundaryReached: true,
          interventionAttempted: true,
          compositionVerdict: composition === undefined ? 'FALLBACK_NATIVE' : 'REWRITE_READY',
          ...(reason !== 'GUARD' ? { fallbackReason: reason } : {}),
          ...(detail !== undefined ? { compositionError: detail } : {}),
          guardVerdict: guardReason === undefined ? 'NOT_ATTEMPTED' : 'FALLBACK_NATIVE',
          ...(guardReason !== undefined ? { guardFallbackReason: guardReason } : {}),
          sentRewrite: false,
          ...(composition?.binding !== undefined
            ? {
                bindingHashes: {
                  workingSetLogicalHash: composition.binding.workingSetLogicalHash,
                  transitionLogicalHash: composition.binding.transitionLogicalHash,
                  compositionHash: composition.compositionHash
                }
              }
            : {}),
          killSwitchTripped: killSwitch.isTripped,
          toolBlocksRemoved: composition?.continuity.toolBlocksRemoved ?? 0,
          interventionPath: boundary.path
        })
        return { messages: event.messages }
      }

      if (workingSet === null || transition === null) {
        // Defensive: the boundary just planned, so both must exist.
        return recordFallback('COMPOSITION_ERROR', 'planner produced no working set/transition')
      }

      let composition: ActiveRewriteComposition
      try {
        composition = composeActiveRewrite({
          messages,
          workingSet,
          transition,
          runId: options.runId,
          killSwitch,
          activeModeOptIn: true,
          harness: 'PI',
          systemInstruction: options.systemInstruction
        })
      } catch (error) {
        // An exception inside the composer is an unexplained materialization
        // failure: record the bounded message and continue natively.
        const detail = error instanceof Error ? error.message : String(error)
        return recordFallback('COMPOSITION_ERROR', detail)
      }

      if (composition.kind === 'FALLBACK_NATIVE') {
        return recordFallback(composition.reason)
      }

      const guard: PreSendGuardResult = assertRewriteSafe(composition, killSwitch)
      if (!guard.ok) {
        // The Stage 0 guard already tripped the run kill switch (fail closed,
        // permanent); a guard fallback IS evidence (contract S-5).
        return recordFallback('GUARD', undefined, guard.reason, composition)
      }

      options.evidence.record({
        sequence,
        observedTokenEstimate,
        boundaryReached: true,
        interventionAttempted: true,
        compositionVerdict: 'REWRITE_READY',
        guardVerdict: 'PASS',
        sentRewrite: true,
        bindingHashes: {
          workingSetLogicalHash: composition.binding.workingSetLogicalHash,
          transitionLogicalHash: composition.binding.transitionLogicalHash,
          compositionHash: composition.compositionHash
        },
        killSwitchTripped: killSwitch.isTripped,
        toolBlocksRemoved: composition.continuity.toolBlocksRemoved,
        interventionPath: boundary.path,
        removedSourceKeys: composition.removedSourceKeys,
        composedMessageCount: composition.messages.length
      })
      // THE FIRST ACTIVE REWRITE: the composition's messages replace the
      // model-visible context for this request.
      return { messages: composition.messages as unknown as ContextEvent['messages'] }
    })
  }
}
