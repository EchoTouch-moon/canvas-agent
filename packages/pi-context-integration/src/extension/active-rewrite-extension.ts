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
import type { C0ScenarioExecutor } from '../smoke/c0-scenarios'
import type { PiContentBlockView, PiMessageView } from '../pi-message-mapper'

// CR-004 — Active intervention extension (Pi-only, bounded repeated sends).
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
//   5. at a firing boundary it marks the earlier still-active read results
//      for P as superseded (SOURCE_SUPERSEDED lifecycle signals + exclusions
//      — the exact E4 vocabulary of c0-scenarios, accumulated across
//      interventions), advances the observation/planning chain OVER THE BASIS
//      (so observations measure the context the model actually sees), then
//      composes the Active rewrite (activeModeOptIn, harness 'PI', the
//      per-Run kill switch) over the basis + the REAL planned Working Set +
//      Transition; REWRITE_READY + pre-send guard PASS => the composition's
//      messages REPLACE the model-visible context (an Active rewrite send),
//      the removal joins the carried basis, and the readTargetHashes of the
//      removed pairs are recorded. ANY fallback or guard failure records its
//      machine-readable reason and returns the basis unchanged.
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
 * Removal policy selection (M2 contract):
 * - `v1-per-edit` — Stage 1 / M1 behavior: each boundary removes the earlier
 *   still-active read pairs of the TRIGGER path only (one block per edit).
 * - `v2-retain-latest-coarse` — coarse sweep over ALL edited paths at each
 *   boundary, retaining the LATEST read per edited path; bounded by
 *   `maxBlocksPerIntervention` (oldest-first).
 */
export type ActiveRemovalPolicy = 'v1-per-edit' | 'v2-retain-latest-coarse'

/** Default bound on SENT Active rewrites per leg (matrix contract). */
export const ACTIVE_DEFAULT_MAX_INTERVENTIONS = 5
/** Default bound on composition ATTEMPTS per leg (matrix contract). */
export const ACTIVE_DEFAULT_MAX_ATTEMPTS = 8
/** Default v2 cap on read pairs removed by ONE intervention (matrix contract). */
export const ACTIVE_DEFAULT_MAX_BLOCKS_PER_INTERVENTION = 12

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
   */
  readonly removalPolicy?: ActiveRemovalPolicy
  /** v2 cap on read pairs removed by ONE intervention (oldest-first). Default 12. */
  readonly maxBlocksPerIntervention?: number
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

  // Bounded repeated-intervention state (per leg):
  let attemptsUsed = 0
  let sendsUsed = 0
  /** Boundaries already attempted (by edit toolCallId) — never retried. */
  const attemptedEditToolCallIds = new Set<string>()
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
      //    A boundary qualifies when it is NEW (its edit toolCallId was never
      //    attempted), has at least one earlier read pair for the path that is
      //    not yet superseded, and that read pair is ACTIVE in the latest
      //    planned Working Set so the intervention plan can actually REMOVE it
      //    (policy-v0 REMOVEs only previously-active sources); otherwise the
      //    boundary waits for the next event instead of wasting an attempt.
      //    Policy v2 keeps the SAME trigger (a NEW edit toolCall observed) but
      //    sweeps ALL edited paths: every still-active read pair of an edited
      //    path is a candidate EXCEPT the path's LATEST read (retain-latest),
      //    capped oldest-first at maxBlocksPerIntervention.
      interface PlannedIntervention {
        readonly policy: ActiveRemovalPolicy
        readonly triggerEditToolCallId: string
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
      if (
        attemptsUsed < maxAttempts &&
        sendsUsed < maxInterventions &&
        !killSwitch.isTripped
      ) {
        const activeKeys = workingSetKeys(options.executor)
        const isActiveRead = (callId: string): boolean =>
          activeKeys.has(`run/tool-result://${callId}`) ||
          activeKeys.has(`run/tool-call://${callId}`)
        if (removalPolicy === 'v2-retain-latest-coarse') {
          const view = scanEditReadStructure(basis, toolNameOptions)
          const trigger = view.edits.find(
            (edit) => !attemptedEditToolCallIds.has(edit.toolCallId)
          )
          if (trigger !== undefined) {
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
            if (candidates.length > 0) {
              candidates.sort((a, b) => a.order - b.order)
              const capped = candidates.slice(0, maxBlocksPerIntervention)
              fire = {
                policy: 'v2-retain-latest-coarse',
                triggerEditToolCallId: trigger.toolCallId,
                interventionPath: trigger.path,
                readToolCallIds: capped.map((candidate) => candidate.callId),
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
              triggerEditToolCallId: candidate.editToolCallId,
              interventionPath: candidate.path,
              readToolCallIds: stillActiveReads,
              candidateBlocks: stillActiveReads.length,
              retainedLatestReadTargets: []
            }
            break
          }
        }
      }

      if (fire !== undefined) {
        // 5. Mark the earlier still-active read results as superseded —
        //    the exact E4 lifecycle vocabulary (SOURCE_SUPERSEDED) the C0
        //    scenario suite uses, plus the paired exclusions that let
        //    policy-v0 emit REMOVE with reason SUPERSEDED. Exclusions
        //    accumulate so every prior intervention stays in force. Under v2
        //    the marked pairs span every swept (edited) path, not just the
        //    trigger path; the composer/guard seam is unchanged.
        const newSupersededKeys: string[] = []
        for (const callId of fire.readToolCallIds) {
          supersededReadCallIds.add(callId)
          newSupersededKeys.push(`run/tool-call://${callId}`, `run/tool-result://${callId}`)
        }
        supersededSourceKeys.push(...newSupersededKeys)
        attemptedEditToolCallIds.add(fire.triggerEditToolCallId)
        attemptsUsed += 1
        options.executor.beginTurn({
          label:
            fire.policy === 'v2-retain-latest-coarse'
              ? `active-intervention-v2:${fire.interventionPath}`
              : `active-intervention:${fire.interventionPath}`,
          prompt: '',
          events: [
            {
              kind: 'SOURCE_SUPERSEDED',
              sourceKeys: newSupersededKeys,
              evidenceRef: `cr004:intervention${
                fire.policy === 'v2-retain-latest-coarse' ? '-v2' : ''
              }:${fire.triggerEditToolCallId}:${fire.interventionPath}`
            }
          ],
          patch: { excludedSourceKeys: [...supersededSourceKeys] }
        })
      }

      // 6. Advance the observation/planning chain OVER THE BASIS so the
      //    observation measures the context the model actually sees (drops at
      //    interventions become visible in the trajectory).
      options.executor.observeBoundary(basis)
      const sequence = options.executor.observationCount
      const observedTokenEstimate =
        options.executor.base.inMemory.last()?.observedMessageTokenEstimate ?? 0
      const readTargetsPatch =
        newReadTargets.length > 0 ? { readTargets: newReadTargets } : {}

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
          toolBlocksRemoved: 0,
          ...readTargetsPatch
        })
        // The carried basis (== the native list before any send) is returned.
        return { messages: basis as unknown as ContextEvent['messages'] }
      }

      // 6. THE intervention attempt — bounded, every outcome recorded.
      const boundary = fire
      const policyTelemetry = {
        policy: boundary.policy,
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

      sendsUsed += 1
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
