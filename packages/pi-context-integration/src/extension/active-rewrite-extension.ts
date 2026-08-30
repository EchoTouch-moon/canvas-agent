import { createHash } from 'node:crypto'
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
import type { C0PlanningSnapshot, C0ScenarioExecutor } from '../smoke/c0-scenarios'
import type { PiContentBlockView, PiMessageView } from '../pi-message-mapper'

// CR-004 — Active intervention extension (Pi-only, bounded repeated sends).
//
// REMOVAL POLICY v3 ('v3-verify-window-dedup', M3 matrix arm ACTIVE_V3):
// v3 = v2 + duplicate-read dedup + a verification-window deferral, targeting
// the one M2 cell where v2 stayed above native (L2: verification-heavy re-reads
// of edited files AFTER editing stops, when NO further edit boundary exists to
// trigger a sweep — docs/verification/cr004-m2-matrix-analysis-2026-08-27.md):
//
//   - DUPLICATE-READ DEDUP (a NEW intervention trigger, not tied to edits):
//     when the SAME path has been read multiple times with IDENTICAL
//     tool-result content (readContentHash = first 16 hex of sha256 over the
//     toolResult text, mirroring readTargetHash style) and NO edit of that
//     path occurred between the reads, every older duplicate read pair is
//     superseded — the information is fully preserved in the newer copy. The
//     arrival of such a duplicate read opens an intervention boundary even
//     with no edit in flight, so verification re-reads become removable the
//     moment they duplicate. Dedup sweeps are coarse (all paths' dedup
//     candidates, oldest-first, same maxBlocksPerIntervention cap) and feed
//     the SAME bounded send/attempt budget as edit-triggered sweeps.
//   - VERIFICATION-WINDOW DEFERRAL: while a verification sequence is in
//     flight — the most recent tool activity is bash-class toolCalls (tool
//     name 'bash') within the last K tool events (default K = 2) —
//     edit-triggered sweeps are DEFERRED (nothing is removed mid-verification;
//     the model's working set stays stable while it is actively checking).
//     The pending edit trigger stays eligible and the sweep resumes at the
//     next non-verification boundary. Dedup removals are still allowed during
//     a verification window (pure win: information preserved). Deferred
//     boundary evaluations are recorded (deferredByVerifyWindow + the per-leg
//     deferredSweeps count, reason 'verification-window').
//   - Edit-triggered sweeps under v3 keep v2's retain-latest + coarse
//     semantics EXACTLY (v3 = v2 + dedup + verify-window; default policy
//     remains v1-per-edit, so Stage 1 / C0 semantics are untouched).
//
// REMOVAL POLICY v2 ('v2-retain-latest-coarse', M2 matrix arm ACTIVE_V2):
// at each intervention boundary (same trigger: a NEW edit toolCall observed)
// the lifecycle sweep covers EVERY edited path, not just the trigger path:
// for every path E that has at least one edit toolCall in the basis, every
// still-active read pair for E is marked superseded EXCEPT the LATEST read
// for E (retain-latest — the model keeps the freshest content it saw, so it
// never needs to re-fetch; this targets the L2 re-read pattern from
// docs/verification/cr004-matrix-run-analysis-2026-08-27.md). Reads of paths
// with NO edit toolCall are never removed (conservative: unedited
// exploration stays). One intervention may therefore remove many blocks at
// once (coarse sweeps), bounded by `maxBlocksPerIntervention` (default 12):
// with more candidates the OLDEST ones up to the cap are removed and the
// rest wait for the next boundary. The composer/guard seam is UNCHANGED —
// v2 only changes WHICH read pairs the lifecycle signals mark superseded
// before planning.
//
// This extension wraps the SAME observation machinery the C0 executor uses
// (PiContextShadowObserver + the enriched shadow planner path via
// C0ScenarioExecutor), so the Working Set is always planned over REAL
// conversation sources (decomposePiMessage attributions). On every `context`
// event it:
//
//   1. checks the operator kill-switch file (if configured); presence trips
//      the in-process per-Run kill switch permanently;
//   2. records privacy-safe read-target telemetry: every read-class toolCall
//      seen for the first time this event contributes readTargetHash = the
//      first 16 hex of sha256 over its primary string argument (the path);
//   3. builds the model-visible BASIS for this request: the native message
//      list with the toolCall blocks + paired toolResults removed by every
//      prior SENT intervention of this leg carried out (a removal persists
//      for the rest of the leg — superseded evidence does not re-enter the
//      model-visible context);
//   4. evaluates INTERVENTION BOUNDARIES over the basis: for EVERY
//      edit/write-class toolCall for some path P with earlier read-class
//      calls for P whose results are in the basis, not yet superseded, and
//      still active in the latest planned Working Set — each such NEW
//      boundary may fire an intervention while sends remain under
//      `maxInterventions` and attempts under `maxAttempts`;
//   5. at a firing boundary it TRANSACTIONALLY proposes superseding the
//      earlier still-active read results for P (SOURCE_SUPERSEDED lifecycle
//      signals + exclusions — the exact E4 vocabulary of c0-scenarios,
//      accumulated across interventions): the executor is snapshotted, the
//      proposal is applied as a TRIAL turn, and the observation/planning
//      chain advances OVER THE BASIS (so observations measure the context the
//      model actually sees); the Active rewrite is then composed (activeMode-
//      OptIn, harness 'PI', the per-Run kill switch) over the basis + the
//      REAL planned Working Set + Transition and validated by the pre-send
//      guard. REWRITE_READY + guard PASS => COMMIT: the composition's
//      messages REPLACE the model-visible context (an Active rewrite send),
//      the removal joins the carried basis, and the readTargetHashes of the
//      removed pairs are recorded. ANY fallback or guard failure first
//      RESTORES the executor's pre-attempt snapshot and re-observes the event
//      natively — the working-set/transition history is then byte-identical
//      to a never-attempted event — and records its machine-readable reason,
//      returning the basis unchanged.
//
// Composing over the carried basis (not the raw native list) is what makes a
// SECOND intervention composable at all: sources removed by earlier
// interventions are absent from both the basis and the Working Set, so
// membership classification stays consistent instead of fail-closing with
// UNEXPLAINED_MEMBERSHIP.
//
// Bounds: each leg allows at most `maxAttempts` composition attempts
// (default 8) of which at most `maxInterventions` may be sent rewrites
// (default 5). The same boundary (same edit toolCallId) is never attempted
// twice; already-superseded read pairs are never removed twice. The legacy
// single-pair Stage 1 behavior is exactly `maxInterventions: 1,
// maxAttempts: 1` (the Stage 1 runner pins those). Kill-switch and guard-trip
// semantics are unchanged: once tripped, every remaining event of the leg
// observes only (permanent native).
//
// The extension performs no provider call itself: it only returns the
// replacement message list through Pi's context seam. Evidence per event goes
// to an in-memory collector (metadata-only: hashes, counts and source keys;
// never message content).

/** Tool names treated as read-class evidence (results become superseded). */
export const ACTIVE_READ_TOOLS = ['read'] as const
/** Tool names treated as edit/write-class (their appearance is the boundary). */
export const ACTIVE_EDIT_TOOLS = ['edit', 'write'] as const
/**
 * Tool names classified as verification-class (bash-class) for the v3
 * verification window: the model running tests/oracles.
 */
export const ACTIVE_VERIFY_TOOLS = ['bash'] as const

/**
 * Removal policy selection (M3 contract):
 * - `v1-per-edit` — Stage 1 / M1 behavior: each boundary removes the earlier
 *   still-active read pairs of the TRIGGER path only (one block per edit).
 * - `v2-retain-latest-coarse` — coarse sweep over ALL edited paths at each
 *   boundary, retaining the LATEST read per edited path; bounded by
 *   `maxBlocksPerIntervention` (oldest-first).
 * - `v3-verify-window-dedup` — v2 semantics PLUS duplicate-read dedup (a NEW
 *   read of an already-read path with IDENTICAL tool-result content and no
 *   path edit between the reads opens an intervention boundary; older
 *   duplicates are superseded) and a verification-window deferral
 *   (edit-triggered sweeps defer while the last K tool events are bash-class;
 *   dedup still fires).
 * - `v4-batched-retain-latest` — v2 coarse-sweep semantics, but an edit
 *   boundary is deferred until at least `minCandidateBlocks` older read pairs
 *   are eligible. This is an experimental mechanism-screen arm; it never
 *   changes the default policy or the v2/v3 contracts.
 */
export type ActiveRemovalPolicy =
  | 'v1-per-edit'
  | 'v2-retain-latest-coarse'
  | 'v3-verify-window-dedup'
  | 'v4-batched-retain-latest'

/** Default bound on SENT Active rewrites per leg (matrix contract). */
export const ACTIVE_DEFAULT_MAX_INTERVENTIONS = 5
/** Default bound on composition ATTEMPTS per leg (matrix contract). */
export const ACTIVE_DEFAULT_MAX_ATTEMPTS = 8
/** Default v2/v3 cap on read pairs removed by ONE intervention (matrix contract). */
export const ACTIVE_DEFAULT_MAX_BLOCKS_PER_INTERVENTION = 12
/** Default v3 verification-window width in trailing tool events (M3 contract). */
export const ACTIVE_DEFAULT_VERIFY_WINDOW_EVENTS = 2
/** Fixed M6 batch threshold: at least two stale read pairs before a rewrite. */
export const ACTIVE_V4_MIN_CANDIDATE_BLOCKS = 2

export interface InterventionBoundary {
  /** Repository path the edit/write-class toolCall targets. */
  readonly path: string
  /** toolCallId of the qualifying edit/write-class call. */
  readonly editToolCallId: string
  /** toolCallIds of earlier read-class calls for the same path whose results are in context. */
  readonly readToolCallIds: readonly string[]
}

/** Privacy-safe identity of one read-class tool call target. */
export interface ReadTargetRecord {
  readonly toolCallId: string
  /** First 16 hex chars of sha256 over the primary string argument (the path). */
  readonly readTargetHash: string
}

export interface ActiveRewriteEventEvidence {
  /** Observer sequence for this context event (1-based, monotonic). */
  readonly sequence: number
  /** CR-001 token estimate for the observed native context. */
  readonly observedTokenEstimate: number
  readonly boundaryReached: boolean
  /** Whether the intervention attempt actually ran (compose + guard). */
  readonly interventionAttempted: boolean
  /** 1-based attempt index, present only when interventionAttempted. */
  readonly interventionIndex?: number
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
  /** readTargetHashes of the read pairs this intervention removed (attempted). */
  readonly removedReadTargetHashes?: readonly string[]
  /** Removal policy of the attempted intervention (present when attempted). */
  readonly policy?: ActiveRemovalPolicy
  /** What opened the attempted boundary: an edit toolCall or a duplicate read. */
  readonly trigger?: 'edit' | 'dedup'
  /** Privacy-safe toolCall identity for a deferred edit boundary. */
  readonly triggerToolCallId?: string
  /**
   * True when this event's boundary evaluation DEFERRED an edit-triggered
   * sweep because a verification sequence was in flight (v3 only): the pending
   * trigger stays eligible and the sweep resumes at the next non-verification
   * boundary. Reason: 'verification-window'.
   */
  readonly deferredByVerifyWindow?: boolean
  /** True when v4 held an edit boundary below its fixed batch threshold. */
  readonly deferredByBatchThreshold?: boolean
  /** Fixed v4 threshold recorded with a batch deferral. */
  readonly batchThreshold?: number
  /** Eligible candidate read pairs the sweep found this boundary (pre-cap). */
  readonly candidateBlocks?: number
  /** Read pairs this intervention marks superseded (post-cap). */
  readonly removedBlocks?: number
  /** readTargetHash of the retained LATEST read per swept (edited) path. */
  readonly retainedLatestReadTargets?: readonly string[]
  /** Read-class toolCalls first observed at this event (privacy-safe hashes). */
  readonly readTargets?: readonly ReadTargetRecord[]
}

/** One intervention attempt summary (SENT or FALLBACK) for leg telemetry. */
export interface ActiveRewriteInterventionSummary {
  readonly boundarySequence: number | null
  readonly interventionPath: string | null
  /** 1-based attempt index; 0 on the idle summary. */
  readonly interventionIndex: number
  readonly attemptOutcome: 'NONE' | 'SENT' | 'FALLBACK'
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
  /** readTargetHashes of the read pairs this attempt removed. */
  readonly removedReadTargetHashes: readonly string[]
  /** Removal policy of this attempt; null on the idle summary. */
  readonly policy: ActiveRemovalPolicy | null
  /** What opened this attempt's boundary; null on the idle summary. */
  readonly trigger: 'edit' | 'dedup' | null
  /** Eligible candidate read pairs the sweep found (pre-cap). */
  readonly candidateBlocks: number
  /** Read pairs this attempt marks superseded (post-cap). */
  readonly removedBlocks: number
  /** readTargetHash of the retained LATEST read per swept (edited) path. */
  readonly retainedLatestReadTargets: readonly string[]
}

export interface ActiveRewriteEvidenceCollector {
  readonly events: readonly ActiveRewriteEventEvidence[]
  /** The FIRST intervention attempt (Stage 1 single-pair compat). */
  readonly intervention: ActiveRewriteInterventionSummary
  /** Every intervention attempt in sequence order (SENT and FALLBACK). */
  readonly interventions: readonly ActiveRewriteInterventionSummary[]
  readonly sendsUsed: number
  readonly attemptsUsed: number
  record(event: ActiveRewriteEventEvidence): void
}

export function idleInterventionSummary(): ActiveRewriteInterventionSummary {
  return {
    boundarySequence: null,
    interventionPath: null,
    interventionIndex: 0,
    attemptOutcome: 'NONE',
    compositionVerdict: 'NOT_ATTEMPTED',
    guardVerdict: 'NOT_ATTEMPTED',
    sentRewrite: false,
    killSwitchTripped: false,
    toolBlocksRemoved: 0,
    removedSourceKeys: [],
    composedMessageCount: null,
    latchSetAtSequence: null,
    removedReadTargetHashes: [],
    policy: null,
    trigger: null,
    candidateBlocks: 0,
    removedBlocks: 0,
    retainedLatestReadTargets: []
  }
}

function interventionSummaryFrom(
  event: ActiveRewriteEventEvidence,
  sequence: number
): ActiveRewriteInterventionSummary {
  return {
    boundarySequence: event.boundaryReached ? sequence : null,
    interventionPath: event.interventionPath ?? null,
    interventionIndex: event.interventionIndex ?? 0,
    attemptOutcome: event.sentRewrite ? 'SENT' : 'FALLBACK',
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
    latchSetAtSequence: sequence,
    removedReadTargetHashes: [...(event.removedReadTargetHashes ?? [])],
    policy: event.policy ?? null,
    // M1/M2-era evidence predates the trigger field; every such attempt was
    // edit-triggered.
    trigger: event.trigger ?? 'edit',
    candidateBlocks: event.candidateBlocks ?? 0,
    removedBlocks: event.removedBlocks ?? 0,
    retainedLatestReadTargets: [...(event.retainedLatestReadTargets ?? [])]
  }
}

export class InMemoryActiveRewriteEvidenceCollector implements ActiveRewriteEvidenceCollector {
  private readonly evidence: ActiveRewriteEventEvidence[] = []
  private readonly attempts: ActiveRewriteInterventionSummary[] = []

  record(event: ActiveRewriteEventEvidence): void {
    this.evidence.push(event)
    if (event.interventionAttempted) {
      this.attempts.push(interventionSummaryFrom(event, event.sequence))
    }
  }

  get events(): readonly ActiveRewriteEventEvidence[] {
    return [...this.evidence]
  }

  get interventions(): readonly ActiveRewriteInterventionSummary[] {
    return [...this.attempts]
  }

  /** First intervention attempt; the Stage 1 single-pair compat accessor. */
  get intervention(): ActiveRewriteInterventionSummary {
    return this.attempts[0] ?? idleInterventionSummary()
  }

  get sendsUsed(): number {
    return this.attempts.filter((attempt) => attempt.sentRewrite).length
  }

  get attemptsUsed(): number {
    return this.attempts.length
  }

  /** Read pairs removed by DEDUP-triggered attempts (v3 per-leg metric). */
  get dedupRemovals(): number {
    return this.attempts.reduce(
      (total, attempt) => total + (attempt.trigger === 'dedup' ? attempt.removedBlocks : 0),
      0
    )
  }

  /**
   * Boundary evaluations that DEFERRED an edit-triggered sweep because a
   * verification window was open (v3 per-leg metric; reason
   * 'verification-window'). One per event at which a deferral happened.
   */
  get deferredSweeps(): number {
    return this.evidence.filter((event) => event.deferredByVerifyWindow === true).length
  }

  /** v4 edit boundaries held below the fixed batch threshold. */
  get batchDeferrals(): number {
    return this.evidence.filter((event) => event.deferredByBatchThreshold === true).length
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
  /** Max SENT Active rewrites per leg. Default 5; Stage 1 single-pair = 1. */
  readonly maxInterventions?: number
  /** Max composition attempts per leg. Default 8; Stage 1 single-pair = 1. */
  readonly maxAttempts?: number
  /**
   * Removal policy. Default `v1-per-edit` (Stage 1 / M1 semantics, unchanged).
   * `v2-retain-latest-coarse` sweeps ALL edited paths at each boundary and
   * retains the LATEST read per edited path (M2 ACTIVE_V2 arm).
   * `v3-verify-window-dedup` keeps the v2 sweep semantics and adds
   * duplicate-read dedup plus the verification-window deferral (M3 ACTIVE_V3).
   */
  readonly removalPolicy?: ActiveRemovalPolicy
  /** v2/v3 cap on read pairs removed by ONE intervention (oldest-first). Default 12. */
  readonly maxBlocksPerIntervention?: number
  /** v3 verification-window width in trailing tool events. Default 2. */
  readonly verifyWindowEvents?: number
  /** v3 verification-class (bash-class) tool names. Default ['bash']. */
  readonly verifyToolNames?: readonly string[]
  /** v4-only minimum eligible stale read pairs before sending a rewrite. */
  readonly minCandidateBlocks?: number
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

/**
 * Privacy-safe target identity: first 16 hex of sha256 over the NORMALIZED
 * path ('./'-prefix stripped), so equivalent path spellings share a hash and
 * re-read detection matches them.
 */
export function readTargetHashOf(path: string): string {
  return createHash('sha256').update(normalizePath(path), 'utf8').digest('hex').slice(0, 16)
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
 * Deterministically detect ALL intervention boundaries in a native message
 * list, in scan order (message order, then block order): every edit/write-
 * class toolCall for some path P that appears AFTER earlier read-class
 * toolCalls for the same P whose toolResults are also already present. Each
 * candidate carries the read calls accumulated for P up to that edit. Pure
 * function of the message list; no clock, no I/O.
 */
export function detectInterventionBoundaries(
  messages: readonly PiMessageView[],
  options: {
    readonly readToolNames?: readonly string[]
    readonly editToolNames?: readonly string[]
  } = {}
): readonly InterventionBoundary[] {
  const readTools = new Set<string>(options.readToolNames ?? ACTIVE_READ_TOOLS)
  const editTools = new Set<string>(options.editToolNames ?? ACTIVE_EDIT_TOOLS)
  const results = resultCallIds(messages)
  // path -> read call ids observed so far (scan order)
  const readsByPath = new Map<string, string[]>()
  const boundaries: InterventionBoundary[] = []
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
          boundaries.push({ path, editToolCallId: block.id, readToolCallIds: reads })
        }
      }
    }
  }
  return boundaries
}

/**
 * The FIRST intervention boundary in scan order (legacy Stage 1 accessor;
 * exactly detectInterventionBoundaries(...)[0]).
 */
export function detectInterventionBoundary(
  messages: readonly PiMessageView[],
  options: {
    readonly readToolNames?: readonly string[]
    readonly editToolNames?: readonly string[]
  } = {}
): InterventionBoundary | undefined {
  return detectInterventionBoundaries(messages, options)[0]
}

/** One read-class call (result present) with its global scan-order index. */
export interface CoarseSweepReadCall {
  readonly callId: string
  readonly order: number
}

/** All result-present read calls of ONE path, in scan order (oldest first). */
export interface CoarseSweepReadEntry {
  readonly path: string
  readonly reads: readonly CoarseSweepReadCall[]
}

/**
 * Policy-v2 sweep input: every edit/write-class toolCall with a resolved path
 * (in scan order — the trigger candidates), plus every result-present read
 * call grouped per path (in scan order). Pure function of the message list;
 * no clock, no I/O. Filtering to EDITED paths, retain-latest, working-set
 * activity and the oldest-first cap are applied by the extension on top of
 * this view.
 */
export interface CoarseSweepView {
  readonly edits: readonly { readonly toolCallId: string; readonly path: string }[]
  readonly readsByPath: readonly CoarseSweepReadEntry[]
}

/**
 * Deterministic edit/read structure scan for the v2 coarse sweep. Reads whose
 * toolResult is not yet present are excluded (an in-flight read is not
 * supersedeable evidence); edits with no resolvable path are ignored.
 */
export function scanEditReadStructure(
  messages: readonly PiMessageView[],
  options: {
    readonly readToolNames?: readonly string[]
    readonly editToolNames?: readonly string[]
  } = {}
): CoarseSweepView {
  const readTools = new Set<string>(options.readToolNames ?? ACTIVE_READ_TOOLS)
  const editTools = new Set<string>(options.editToolNames ?? ACTIVE_EDIT_TOOLS)
  const results = resultCallIds(messages)
  const readsByPath = new Map<string, CoarseSweepReadCall[]>()
  const edits: { toolCallId: string; path: string }[] = []
  let order = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of blocksOf(message)) {
      if (block.type !== 'toolCall' || typeof block.id !== 'string' || block.id === '') continue
      const name = block.name ?? ''
      const path = pathOf(block)
      order += 1
      if (readTools.has(name)) {
        if (path === null || !results.has(block.id)) continue
        const calls = readsByPath.get(path) ?? []
        calls.push({ callId: block.id, order })
        readsByPath.set(path, calls)
        continue
      }
      if (editTools.has(name) && path !== null) {
        edits.push({ toolCallId: block.id, path })
      }
    }
  }
  return {
    edits,
    readsByPath: [...readsByPath.entries()].map(([path, reads]) => ({ path, reads }))
  }
}

/**
 * Privacy-safe content identity of a read's toolResult: first 16 hex of
 * sha256 over the result TEXT content (readTargetHash style, but over the
 * content rather than the path). Computed here, where the raw messages are
 * visible; never the content itself.
 */
export function readContentHashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/** One older duplicate read call (identical content to a later read). */
export interface DuplicateReadCall {
  readonly callId: string
  readonly order: number
  readonly readContentHash: string
}

/** All supersedeable older duplicates of ONE path, in scan order (oldest first). */
export interface DuplicateReadEntry {
  readonly path: string
  /** The newest read whose content the duplicates reproduce (kept). */
  readonly anchorCallId: string
  readonly duplicates: readonly DuplicateReadCall[]
}

/** Policy-v3 dedup sweep input (pure function of the message list). */
export interface DuplicateSweepView {
  readonly entries: readonly DuplicateReadEntry[]
  /**
   * Read calls whose arrival ESTABLISHED a duplication (they duplicate an
   * earlier read of the same path), in scan order — the dedup trigger
   * candidates ("the duplicate just arrived").
   */
  readonly triggerReadCalls: readonly { readonly callId: string; readonly order: number; readonly path: string }[]
}

/**
 * Deterministic duplicate-read scan for the v3 dedup sweep. A read call is an
 * OLDER DUPLICATE (supersedeable) when a LATER read of the SAME path carries
 * IDENTICAL tool-result content (readContentHash) and NO edit of that path
 * occurred between the two reads — the information is fully preserved in the
 * later copy. Reads whose toolResult is not yet present are excluded. Pure
 * function of the message list; no clock, no I/O.
 */
export function scanDuplicateReads(
  messages: readonly PiMessageView[],
  options: {
    readonly readToolNames?: readonly string[]
    readonly editToolNames?: readonly string[]
  } = {}
): DuplicateSweepView {
  const readTools = new Set<string>(options.readToolNames ?? ACTIVE_READ_TOOLS)
  const editTools = new Set<string>(options.editToolNames ?? ACTIVE_EDIT_TOOLS)
  // toolResult text per toolCallId (content identity of the evidence).
  const resultTextByCallId = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'toolResult' || typeof message.toolCallId !== 'string') continue
    const text = blocksOf(message)
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
    resultTextByCallId.set(message.toolCallId, text)
  }
  interface ScanRead {
    readonly callId: string
    readonly order: number
    readonly readContentHash: string
  }
  const readsByPath = new Map<string, ScanRead[]>()
  const editOrdersByPath = new Map<string, number[]>()
  let order = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of blocksOf(message)) {
      if (block.type !== 'toolCall' || typeof block.id !== 'string' || block.id === '') continue
      const name = block.name ?? ''
      const path = pathOf(block)
      order += 1
      if (readTools.has(name)) {
        if (path === null) continue
        const resultText = resultTextByCallId.get(block.id)
        // An in-flight read (no result yet) is not supersedeable evidence and
        // cannot anchor a duplication either.
        if (resultText === undefined) continue
        const read: ScanRead = {
          callId: block.id,
          order,
          readContentHash: readContentHashOf(resultText)
        }
        const calls = readsByPath.get(path) ?? []
        calls.push(read)
        readsByPath.set(path, calls)
        continue
      }
      if (editTools.has(name) && path !== null) {
        const orders = editOrdersByPath.get(path) ?? []
        orders.push(order)
        editOrdersByPath.set(path, orders)
      }
    }
  }
  const entries: DuplicateReadEntry[] = []
  const triggerReadCalls: { callId: string; order: number; path: string }[] = []
  for (const [path, reads] of readsByPath) {
    const editOrders = editOrdersByPath.get(path) ?? []
    const hasEditBetween = (from: number, to: number): boolean =>
      editOrders.some((editOrder) => editOrder > from && editOrder < to)
    const duplicates: DuplicateReadCall[] = []
    let anchor: ScanRead | undefined
    for (let index = 0; index < reads.length; index += 1) {
      const read = reads[index]!
      const laterDuplicate = reads.find(
        (other, otherIndex) =>
          otherIndex > index &&
          other.readContentHash === read.readContentHash &&
          !hasEditBetween(read.order, other.order)
      )
      if (laterDuplicate === undefined) continue
      duplicates.push({
        callId: read.callId,
        order: read.order,
        readContentHash: read.readContentHash
      })
      // The newest read that anchors at least one older duplicate.
      if (anchor === undefined || laterDuplicate.order > anchor.order) {
        anchor = laterDuplicate
      }
    }
    if (duplicates.length === 0 || anchor === undefined) continue
    entries.push({ path, anchorCallId: anchor.callId, duplicates })
    triggerReadCalls.push({ callId: anchor.callId, order: anchor.order, path })
  }
  return { entries, triggerReadCalls }
}

/**
 * The v3 verification window: OPEN while the most recent tool activity is
 * bash-class — operational definition: EVERY one of the last
 * `verifyWindowEvents` (default 2) toolCall blocks in scan order (message
 * order, then block order) is a verification-class tool call, and at least one
 * exists. While open, edit-triggered sweeps defer. Pure function of the
 * message list; no clock, no I/O.
 */
export function isVerificationWindowOpen(
  messages: readonly PiMessageView[],
  options: {
    readonly verifyToolNames?: readonly string[]
    readonly verifyWindowEvents?: number
  } = {}
): boolean {
  const verifyTools = new Set<string>(options.verifyToolNames ?? ACTIVE_VERIFY_TOOLS)
  const windowEvents = options.verifyWindowEvents ?? ACTIVE_DEFAULT_VERIFY_WINDOW_EVENTS
  const tail: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of blocksOf(message)) {
      if (block.type !== 'toolCall' || typeof block.id !== 'string' || block.id === '') continue
      tail.push(block.name ?? '')
      if (tail.length > windowEvents) tail.shift()
    }
  }
  return tail.length > 0 && tail.every((name) => verifyTools.has(name))
}

function workingSetKeys(executor: C0ScenarioExecutor): ReadonlySet<string> {
  return new Set(executor.latestWorkingSet?.items.flatMap((item) => item.sourceKeys) ?? [])
}

function isToolCallBlockWithId(block: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof block !== 'object' || block === null) return false
  const record = block as { type?: unknown; id?: unknown }
  if (record.type !== 'toolCall') return false
  return typeof record.id === 'string' && ids.has(record.id)
}

/**
 * The model-visible BASIS: the native message list with every removal of a
 * prior SENT intervention carried out — paired toolResult messages dropped,
 * toolCall blocks dropped from mixed assistant messages, and assistant
 * messages left with no blocks dropped whole. Returns the ORIGINAL list by
 * reference when nothing is carried (the identity Stage 1 relies on).
 */
export function applyCarriedRemovals(
  messages: readonly PiMessageView[],
  removedToolCallIds: ReadonlySet<string>
): readonly PiMessageView[] {
  if (removedToolCallIds.size === 0) return messages
  const basis: PiMessageView[] = []
  let changed = false
  for (const message of messages) {
    if (
      message.role === 'toolResult' &&
      typeof message.toolCallId === 'string' &&
      removedToolCallIds.has(message.toolCallId)
    ) {
      changed = true // paired toolResult of a removed toolCall: drop whole
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const filtered = message.content.filter(
        (block) => !isToolCallBlockWithId(block, removedToolCallIds)
      )
      if (filtered.length !== message.content.length) {
        changed = true
        if (filtered.length > 0) {
          basis.push({ ...message, content: filtered })
        }
        // filtered.length === 0: the composer only accepts block removals that
        // leave a meaningful remainder, so this is a whole-message drop.
        continue
      }
    }
    basis.push(message)
  }
  return changed ? basis : messages
}

/**
 * Pi extension factory for the Active intervention leg. The `context` handler
 * observes every event; at each NEW qualifying boundary (within the send /
 * attempt bounds) it returns the composed rewrite, otherwise the original
 * messages.
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
  const maxInterventions = options.maxInterventions ?? ACTIVE_DEFAULT_MAX_INTERVENTIONS
  const maxAttempts = options.maxAttempts ?? ACTIVE_DEFAULT_MAX_ATTEMPTS
  const removalPolicy: ActiveRemovalPolicy = options.removalPolicy ?? 'v1-per-edit'
  const maxBlocksPerIntervention =
    options.maxBlocksPerIntervention ?? ACTIVE_DEFAULT_MAX_BLOCKS_PER_INTERVENTION
  const minCandidateBlocks = options.minCandidateBlocks ?? ACTIVE_V4_MIN_CANDIDATE_BLOCKS
  if (!Number.isInteger(minCandidateBlocks) || minCandidateBlocks < 1) {
    throw new Error(`minCandidateBlocks must be a positive integer (got ${minCandidateBlocks})`)
  }
  const verifyWindowOptions = {
    ...(options.verifyToolNames !== undefined
      ? { verifyToolNames: options.verifyToolNames }
      : {}),
    ...(options.verifyWindowEvents !== undefined
      ? { verifyWindowEvents: options.verifyWindowEvents }
      : {})
  }

  // Bounded repeated-intervention state (per leg):
  let attemptsUsed = 0
  let sendsUsed = 0
  /** Edit boundaries already attempted (by edit toolCallId) — never retried. */
  const attemptedEditToolCallIds = new Set<string>()
  /**
   * Dedup boundaries already attempted (by the duplicate read's toolCallId —
   * the newer copy whose arrival opened the boundary) — never retried.
   */
  const attemptedDedupTriggerCallIds = new Set<string>()
  /** Edit boundaries already recorded as below-threshold v4 deferrals. */
  const batchDeferredEditToolCallIds = new Set<string>()
  /** Read pairs already superseded by an attempt — never removed twice. */
  const supersededReadCallIds = new Set<string>()
  /** Accumulated exclusion keys so earlier interventions stay excluded. */
  const supersededSourceKeys: string[] = []
  /** Read toolCalls already counted in telemetry (by toolCallId). */
  const observedReadCallIds = new Set<string>()
  /** toolCallIds removed by SENT rewrites — carried out of every later basis. */
  const carriedRemovalToolCallIds = new Set<string>()

  return (pi: ExtensionAPI) => {
    pi.on('context', async (event: ContextEvent) => {
      // 1. Operator kill-switch file: presence trips the run switch (permanent).
      if (fileCheck()) {
        killSwitch.trip(`operator kill-switch file present: ${options.killSwitchFilePath ?? ''}`)
      }

      const messages = event.messages as unknown as readonly PiMessageView[]
      // 3. The model-visible basis: native minus every prior SENT removal.
      const basis = applyCarriedRemovals(messages, carriedRemovalToolCallIds)

      // 2. Read-target telemetry: every read-class toolCall seen for the
      //    first time at this event contributes a privacy-safe hash.
      const telemetryReadTools = new Set<string>(options.readToolNames ?? ACTIVE_READ_TOOLS)
      const newReadTargets: ReadTargetRecord[] = []
      for (const message of messages) {
        if (message.role !== 'assistant') continue
        for (const block of blocksOf(message)) {
          if (
            block.type !== 'toolCall' ||
            typeof block.id !== 'string' ||
            block.id === '' ||
            observedReadCallIds.has(block.id)
          ) {
            continue
          }
          if (!telemetryReadTools.has(block.name ?? '')) continue
          const path = pathOf(block)
          if (path === null) continue
          observedReadCallIds.add(block.id)
          newReadTargets.push({ toolCallId: block.id, readTargetHash: readTargetHashOf(path) })
        }
      }

      // 4. Boundary evaluation over the basis — bounded repeated intervention.
      //    A boundary qualifies when it is NEW (its trigger toolCallId — an
      //    edit toolCall, or under v3 the duplicate read's toolCallId — was
      //    never attempted), has at least one earlier read pair for the path
      //    that is not yet superseded, and that read pair is ACTIVE in the
      //    latest planned Working Set so the intervention plan can actually
      //    REMOVE it (policy-v0 REMOVEs only previously-active sources);
      //    otherwise the boundary waits for the next event instead of wasting
      //    an attempt. Policy v2 keeps the SAME trigger (a NEW edit toolCall
      //    observed) but sweeps ALL edited paths: every still-active read pair
      //    of an edited path is a candidate EXCEPT the path's LATEST read
      //    (retain-latest), capped oldest-first at
      //    maxBlocksPerIntervention. Policy v3 keeps the v2 sweep for
      //    edit-triggered boundaries, DEFERS it while a verification window is
      //    open (recorded, resumed at the next non-verification boundary), and
      //    adds the dedup-only trigger (a NEW duplicate read opens a boundary
      //    with NO edit in flight; dedup removals are allowed even inside a
      //    verification window — pure win, information preserved). Dedup
      //    sweeps are coarse too: every path's supersedeable older duplicates,
      //    oldest-first, under the SAME cap; both trigger kinds feed the same
      //    bounded send/attempt budget.
      interface PlannedIntervention {
        readonly policy: ActiveRemovalPolicy
        readonly trigger: 'edit' | 'dedup'
        /** Edit toolCallId for 'edit' triggers; the newer duplicate read's for 'dedup'. */
        readonly triggerToolCallId: string
        readonly interventionPath: string
        readonly readToolCallIds: readonly string[]
        readonly candidateBlocks: number
        readonly retainedLatestReadTargets: readonly string[]
      }
      const toolNameOptions = {
        ...(options.readToolNames !== undefined ? { readToolNames: options.readToolNames } : {}),
        ...(options.editToolNames !== undefined ? { editToolNames: options.editToolNames } : {})
      }
      let fire: PlannedIntervention | undefined
      /** True when THIS event's boundary evaluation deferred an edit sweep. */
      let deferredByVerifyWindow = false
      /** v4 detail for a below-threshold edit boundary (no attempt consumed). */
      let batchDeferral:
        | {
            readonly triggerToolCallId: string
            readonly interventionPath: string
            readonly candidateBlocks: number
            readonly retainedLatestReadTargets: readonly string[]
          }
        | undefined
      if (
        attemptsUsed < maxAttempts &&
        sendsUsed < maxInterventions &&
        !killSwitch.isTripped
      ) {
        const activeKeys = workingSetKeys(options.executor)
        const isActiveRead = (callId: string): boolean =>
          activeKeys.has(`run/tool-result://${callId}`) ||
          activeKeys.has(`run/tool-call://${callId}`)
        const coarseSweep = (
          view: CoarseSweepView
        ): { readonly candidates: readonly CoarseSweepReadCall[]; readonly retainedLatestReadTargets: readonly string[] } => {
          const editedPaths = new Set(view.edits.map((edit) => edit.path))
          const candidates: CoarseSweepReadCall[] = []
          const retainedLatestReadTargets: string[] = []
          for (const entry of view.readsByPath) {
            // Conservative: paths with NO edit toolCall are never swept.
            if (!editedPaths.has(entry.path)) continue
            for (const read of entry.reads.slice(0, -1)) {
              if (supersededReadCallIds.has(read.callId)) continue
              if (!isActiveRead(read.callId)) continue
              candidates.push(read)
            }
            // Retain-latest: the freshest read the model saw stays (the
            // readTargetHash identifies the path, so the kept latest's
            // hash is the path hash).
            if (entry.reads.length > 0) {
              retainedLatestReadTargets.push(readTargetHashOf(entry.path))
            }
          }
          return { candidates, retainedLatestReadTargets }
        }
        if (removalPolicy === 'v3-verify-window-dedup') {
          // (i) Edit-triggered v2-style sweep — DEFERRED while a verification
          //     window is open. The deferral is per boundary EVALUATION: the
          //     pending edit trigger stays eligible and the sweep resumes at
          //     the next non-verification boundary.
          const view = scanEditReadStructure(basis, toolNameOptions)
          const trigger = view.edits.find(
            (edit) => !attemptedEditToolCallIds.has(edit.toolCallId)
          )
          let editSweep:
            | {
                readonly triggerToolCallId: string
                readonly interventionPath: string
                readonly readToolCallIds: readonly string[]
                readonly candidateBlocks: number
                readonly retainedLatestReadTargets: readonly string[]
              }
            | undefined
          if (trigger !== undefined) {
            const { candidates, retainedLatestReadTargets } = coarseSweep(view)
            if (candidates.length > 0) {
              const sorted = [...candidates].sort((a, b) => a.order - b.order)
              const capped = sorted.slice(0, maxBlocksPerIntervention)
              editSweep = {
                triggerToolCallId: trigger.toolCallId,
                interventionPath: trigger.path,
                readToolCallIds: capped.map((candidate) => candidate.callId),
                candidateBlocks: candidates.length,
                retainedLatestReadTargets
              }
            }
          }
          if (editSweep !== undefined && isVerificationWindowOpen(basis, verifyWindowOptions)) {
            editSweep = undefined
            deferredByVerifyWindow = true
          }
          // (ii) Dedup-only trigger — evaluated even inside a verification
          //      window. The trigger is the NEWEST duplicate-establishing read
          //      never attempted before; the sweep covers every path's older
          //      duplicates (coarse, oldest-first, same cap).
          const dedupView = scanDuplicateReads(basis, toolNameOptions)
          const dedupTrigger = [...dedupView.triggerReadCalls]
            .reverse()
            .find((read) => !attemptedDedupTriggerCallIds.has(read.callId))
          if (dedupTrigger !== undefined) {
            const supersedeable = (callId: string): boolean =>
              !supersededReadCallIds.has(callId) && isActiveRead(callId)
            const candidates = dedupView.entries.flatMap((entry) =>
              entry.duplicates.filter((duplicate) => supersedeable(duplicate.callId))
            )
            if (candidates.length > 0) {
              candidates.sort((a, b) => a.order - b.order)
              const capped = candidates.slice(0, maxBlocksPerIntervention)
              const cappedCallIds = new Set(capped.map((candidate) => candidate.callId))
              const retainedLatestReadTargets: string[] = []
              for (const entry of dedupView.entries) {
                if (entry.duplicates.some((duplicate) => cappedCallIds.has(duplicate.callId))) {
                  // The path's newest read (the duplication anchor or later)
                  // stays; the readTargetHash identifies the path.
                  retainedLatestReadTargets.push(readTargetHashOf(entry.path))
                }
              }
              fire = {
                policy: 'v3-verify-window-dedup',
                trigger: 'dedup',
                triggerToolCallId: dedupTrigger.callId,
                interventionPath: dedupTrigger.path,
                readToolCallIds: capped.map((candidate) => candidate.callId),
                candidateBlocks: candidates.length,
                retainedLatestReadTargets
              }
            }
          }
          // (iii) Outside a verification window the edit sweep takes priority
          //       over a same-event dedup boundary when both are ready (the
          //       coarse sweep subsumes the dedup candidates of edited paths).
          if (fire === undefined && editSweep !== undefined) {
            fire = {
              policy: 'v3-verify-window-dedup',
              trigger: 'edit',
              triggerToolCallId: editSweep.triggerToolCallId,
              interventionPath: editSweep.interventionPath,
              readToolCallIds: editSweep.readToolCallIds,
              candidateBlocks: editSweep.candidateBlocks,
              retainedLatestReadTargets: editSweep.retainedLatestReadTargets
            }
          }
        } else if (
          removalPolicy === 'v2-retain-latest-coarse' ||
          removalPolicy === 'v4-batched-retain-latest'
        ) {
          const view = scanEditReadStructure(basis, toolNameOptions)
          const trigger = view.edits.find(
            (edit) => !attemptedEditToolCallIds.has(edit.toolCallId)
          )
          if (trigger !== undefined) {
            const { candidates, retainedLatestReadTargets } = coarseSweep(view)
            if (
              candidates.length > 0 &&
              (removalPolicy === 'v2-retain-latest-coarse' ||
                candidates.length >= minCandidateBlocks)
            ) {
              const sorted = [...candidates].sort((a, b) => a.order - b.order)
              const capped = sorted.slice(0, maxBlocksPerIntervention)
              fire = {
                policy: removalPolicy,
                trigger: 'edit',
                triggerToolCallId: trigger.toolCallId,
                interventionPath: trigger.path,
                readToolCallIds: capped.map((candidate) => candidate.callId),
                candidateBlocks: candidates.length,
                retainedLatestReadTargets
              }
            } else if (
              removalPolicy === 'v4-batched-retain-latest' &&
              candidates.length > 0 &&
              !batchDeferredEditToolCallIds.has(trigger.toolCallId)
            ) {
              batchDeferredEditToolCallIds.add(trigger.toolCallId)
              batchDeferral = {
                triggerToolCallId: trigger.toolCallId,
                interventionPath: trigger.path,
                candidateBlocks: candidates.length,
                retainedLatestReadTargets
              }
            }
          }
        } else {
          const candidates = detectInterventionBoundaries(basis, toolNameOptions)
          for (const candidate of candidates) {
            if (attemptedEditToolCallIds.has(candidate.editToolCallId)) continue
            const stillActiveReads = candidate.readToolCallIds.filter(
              (callId) => !supersededReadCallIds.has(callId) && isActiveRead(callId)
            )
            if (stillActiveReads.length === 0) continue
            fire = {
              policy: 'v1-per-edit',
              trigger: 'edit',
              triggerToolCallId: candidate.editToolCallId,
              interventionPath: candidate.path,
              readToolCallIds: stillActiveReads,
              candidateBlocks: stillActiveReads.length,
              retainedLatestReadTargets: []
            }
            break
          }
        }
      }

      // 5-7. TRANSACTIONAL intervention (CR-004 hardening): propose ->
      //      trial-observe -> compose -> guard -> commit. NOTHING persistent
      //      mutates until the pre-send guard PASSES. The candidate
      //      supersession is computed into LOCALS (the exact E4 vocabulary —
      //      SOURCE_SUPERSEDED signals + exclusions — applied as a TRIAL turn
      //      against a snapshotted executor); only a guard-PASS commits the
      //      patch to the live executor state (whose trial observation then
      //      STANDS as the event's single observation). On ANY fallback
      //      (compose refusal, exception, guard failure) the executor is
      //      restored to its pre-attempt snapshot and the event is re-observed
      //      natively, so the working-set/transition history is exactly what a
      //      never-attempted event would produce. Prior SENT removals stay
      //      carried either way (a SENT intervention commits; a FAILED attempt
      //      rolls back completely).
      let attemptTransaction: C0PlanningSnapshot | undefined
      const newSupersededKeys: string[] = []
      if (fire !== undefined) {
        for (const callId of fire.readToolCallIds) {
          newSupersededKeys.push(`run/tool-call://${callId}`, `run/tool-result://${callId}`)
        }
        attemptTransaction = options.executor.snapshotPlanningState()
        // Attempt accounting is leg ledger, not executor state: the attempt is
        // consumed and its trigger is never retried, even on fallback.
        attemptsUsed += 1
        if (fire.trigger === 'edit') {
          attemptedEditToolCallIds.add(fire.triggerToolCallId)
        } else {
          attemptedDedupTriggerCallIds.add(fire.triggerToolCallId)
        }
        const interventionLabel = (() => {
          if (fire.policy === 'v3-verify-window-dedup') {
            return `active-intervention-v3${fire.trigger === 'dedup' ? '-dedup' : ''}:${fire.interventionPath}`
          }
          if (fire.policy === 'v4-batched-retain-latest') {
            return `active-intervention-v4-batched:${fire.interventionPath}`
          }
          return fire.policy === 'v2-retain-latest-coarse'
            ? `active-intervention-v2:${fire.interventionPath}`
            : `active-intervention:${fire.interventionPath}`
        })()
        const evidenceRef = (() => {
          if (fire.policy === 'v3-verify-window-dedup') {
            return `cr004:intervention-v3:${fire.trigger}:${fire.triggerToolCallId}:${fire.interventionPath}`
          }
          if (fire.policy === 'v4-batched-retain-latest') {
            return `cr004:intervention-v4:${fire.trigger}:${fire.triggerToolCallId}:${fire.interventionPath}`
          }
          return `cr004:intervention${
            fire.policy === 'v2-retain-latest-coarse' ? '-v2' : ''
          }:${fire.triggerToolCallId}:${fire.interventionPath}`
        })()
        options.executor.beginTurn({
          label: interventionLabel,
          prompt: '',
          events: [
            {
              kind: 'SOURCE_SUPERSEDED',
              sourceKeys: newSupersededKeys,
              evidenceRef
            }
          ],
          // The PROPOSED exclusion view: prior committed exclusions + this
          // attempt's candidates (identical content to the committed patch).
          patch: { excludedSourceKeys: [...supersededSourceKeys, ...newSupersededKeys] }
        })
      }

      // 6. Advance the observation/planning chain OVER THE BASIS so the
      //    observation measures the context the model actually sees (drops at
      //    interventions become visible in the trajectory). Inside an attempt
      //    this observation is TRIAL state: a fallback restores the snapshot
      //    and re-observes natively.
      try {
        options.executor.observeBoundary(basis)
      } catch (error) {
        // The observation itself failed (S-2 class): restore the pre-attempt
        // snapshot so no partial trial state survives, then propagate.
        if (attemptTransaction !== undefined) {
          options.executor.restorePlanningState(attemptTransaction)
        }
        throw error
      }
      const sequence = options.executor.observationCount
      const observedTokenEstimate =
        options.executor.base.inMemory.last()?.observedMessageTokenEstimate ?? 0
      const readTargetsPatch =
        newReadTargets.length > 0 ? { readTargets: newReadTargets } : {}
      const verifyWindowPatch = deferredByVerifyWindow
        ? { deferredByVerifyWindow: true as const }
        : {}

      if (fire === undefined) {
        options.evidence.record({
          sequence,
          observedTokenEstimate,
          boundaryReached: batchDeferral !== undefined,
          interventionAttempted: false,
          compositionVerdict: 'NOT_ATTEMPTED',
          guardVerdict: 'NOT_ATTEMPTED',
          sentRewrite: false,
          killSwitchTripped: killSwitch.isTripped,
          toolBlocksRemoved: 0,
          ...(batchDeferral !== undefined
            ? {
                interventionPath: batchDeferral.interventionPath,
                policy: 'v4-batched-retain-latest' as const,
                trigger: 'edit' as const,
                triggerToolCallId: batchDeferral.triggerToolCallId,
                candidateBlocks: batchDeferral.candidateBlocks,
                removedBlocks: 0,
                retainedLatestReadTargets: [...batchDeferral.retainedLatestReadTargets],
                deferredByBatchThreshold: true as const,
                batchThreshold: minCandidateBlocks
              }
            : {}),
          ...verifyWindowPatch,
          ...readTargetsPatch
        })
        // The carried basis (== the native list before any send) is returned.
        return { messages: basis as unknown as ContextEvent['messages'] }
      }

      // 6. THE intervention attempt — bounded, every outcome recorded.
      const boundary = fire
      const policyTelemetry = {
        policy: boundary.policy,
        trigger: boundary.trigger,
        candidateBlocks: boundary.candidateBlocks,
        removedBlocks: boundary.readToolCallIds.length,
        retainedLatestReadTargets: [...boundary.retainedLatestReadTargets]
      }
      const removedReadTargetHashes = boundary.readToolCallIds.map((callId) => {
        const target = newReadTargets.find((record) => record.toolCallId === callId)
        if (target !== undefined) return target.readTargetHash
        // The read was observed at an earlier event: recover its hash from the
        // collector telemetry (privacy-safe, no path strings stored).
        const earlier = options.evidence.events
          .flatMap((event) => [...(event.readTargets ?? [])])
          .find((record) => record.toolCallId === callId)
        return earlier?.readTargetHash ?? `unknown:${callId}`
      })
      const workingSet = options.executor.latestWorkingSet
      const transition = options.executor.latestTransitionResult

      const recordFallback = (
        reason: string,
        detail?: string,
        guardReason?: string,
        composition?: ActiveRewriteReady
      ): { messages: ContextEvent['messages'] } => {
        // ROLL BACK the trial completely before recording: the executor
        // returns to its pre-attempt snapshot and the event is re-observed
        // NATIVELY, so the working-set/transition history is exactly what a
        // never-attempted event would produce. Only the attempt LEDGER
        // (attemptsUsed + the never-retried trigger) persists.
        if (attemptTransaction !== undefined) {
          options.executor.restorePlanningState(attemptTransaction)
          options.executor.observeBoundary(basis)
        }
        options.evidence.record({
          sequence,
          observedTokenEstimate,
          boundaryReached: true,
          interventionAttempted: true,
          interventionIndex: attemptsUsed,
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
          interventionPath: boundary.interventionPath,
          removedReadTargetHashes,
          ...policyTelemetry,
          ...verifyWindowPatch,
          ...readTargetsPatch
        })
        // No send: the basis (unchanged by this attempt) is returned.
        return { messages: basis as unknown as ContextEvent['messages'] }
      }

      if (workingSet === null || transition === null) {
        // Defensive: the boundary just planned, so both must exist.
        return recordFallback('COMPOSITION_ERROR', 'planner produced no working set/transition')
      }

      let composition: ActiveRewriteComposition
      try {
        composition = composeActiveRewrite({
          messages: basis,
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

      // COMMIT: the guard passed, so the trial becomes permanent. The
      // executor's trial observation STANDS as this event's single observation
      // (planned over the committed supersession), and the supersession joins
      // the live extension state — exactly one mutation per SENT attempt.
      sendsUsed += 1
      for (const callId of boundary.readToolCallIds) {
        supersededReadCallIds.add(callId)
      }
      supersededSourceKeys.push(...newSupersededKeys)
      options.evidence.record({
        sequence,
        observedTokenEstimate,
        boundaryReached: true,
        interventionAttempted: true,
        interventionIndex: attemptsUsed,
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
        interventionPath: boundary.interventionPath,
        removedSourceKeys: composition.removedSourceKeys,
        composedMessageCount: composition.messages.length,
        removedReadTargetHashes,
        ...policyTelemetry,
        ...verifyWindowPatch,
        ...readTargetsPatch
      })
      // AN ACTIVE REWRITE: the composition's messages replace the
      // model-visible context for this request, and the removal joins the
      // carried basis for every later request of this leg.
      for (const key of composition.removedSourceKeys) {
        if (key.startsWith('run/tool-call://')) {
          carriedRemovalToolCallIds.add(key.slice('run/tool-call://'.length))
        }
      }
      return { messages: composition.messages as unknown as ContextEvent['messages'] }
    })
  }
}
