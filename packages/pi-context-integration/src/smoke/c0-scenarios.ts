import { randomBytes } from 'node:crypto'
import {
  createAvailableObservation,
  createRepresentation,
  evaluateC0Scenario,
  planWorkingSet,
  sha256Hex,
  type C0DecisionRecord,
  type C0ScenarioVerdict,
  type ContextPlanningRequest,
  type ContextRepresentation,
  type ContextRepresentationNeed,
  type ContextTransition,
  type ContextUniverseEntry,
  type ContextUniverseRevision,
  type ContextWorkingSet,
  type ContextWorkingSetItem,
  type DecisionKind,
  type ReasonCode,
  type RemovalRecord,
  type SourceLifecycleSignal,
  type TaskPhase
} from '@canvas-agent/context-runtime'
import {
  EnrichedPiShadowObserver,
  type ExternalObservation
} from '../extension/enriched-shadow-extension'
import { PiContextShadowObserver } from '../extension/shadow-extension'
import type { PiMessageView } from '../pi-message-mapper'

// CSPV-C0 canary scenario core (docs/plan/cspv-c0-run-contract-2026-08-27.md).
//
// This module owns everything the C0 runner and its unit tests share:
//   - the E1-E4 scripted lifecycle scenarios (prompts, scripted messages,
//     lifecycle signal patches, expected decision chains);
//   - the run-identity vocabulary and budget/stop-condition ledgers;
//   - C0ScenarioExecutor: the REAL planner->evaluator wiring. Universe
//     revisions are derived from the observed conversation exactly like the
//     shadow-planner smoke (PiContextShadowObserver -> EnrichedPiShadowObserver),
//     scripted lifecycle patches are applied to the planning request exactly
//     like the deterministic B1 suite (tests/fixtures/policy-lifecycle), and
//     every boundary is planned with the REAL policy-v0 planWorkingSet.
//
// No provider, no network, no ModelRuntime anywhere in this module: the
// credential-free DRY_RUN mode and the unit tests exercise it end to end with
// zero provider calls.

// ---------------------------------------------------------------------------
// Run identity (contract section 2)
// ---------------------------------------------------------------------------

/** c0-<ISO-date>-<8-hex>, e.g. c0-2026-08-27-3f9a2c1d */
export const C0_RUN_ID_PATTERN = /^c0-\d{8}-[0-9a-f]{8}$/

export function isValidC0RunId(runId: string | undefined): runId is string {
  return runId !== undefined && C0_RUN_ID_PATTERN.test(runId)
}

/** Fresh single-use run identity suggestion; the Lead must export it. */
export function suggestC0RunId(now: Date = new Date()): string {
  const isoDate = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `c0-${isoDate}-${randomBytes(4).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Budgets and stop conditions (contract sections 7-8)
// ---------------------------------------------------------------------------

export const C0_BUDGETS = {
  maxScenarioRuns: 4,
  // Amendment 1 (2026-08-27): 12 -> 24 after live run c0-20260827-8cdb65c4
  // measured 4 (E1) and 6 (E2) records per scenario. Amendment 2 (same day):
  // 24 -> 48 for subset-targeted runs after c0-20260827-9faf18ac saw a single
  // E3 turn burst to 14 records (27 > 24, terminal S-7). See contract section 7.
  maxProviderCalls: 48,
  maxWallClockMs: 60 * 60 * 1000
} as const

export type C0StopConditionId =
  | 'S-1'
  | 'S-2'
  | 'S-3'
  | 'S-4'
  | 'S-5'
  | 'S-6'
  | 'S-7'
  | 'S-8'

export interface C0StopLedgers {
  /** Actual provider transport calls in LIVE mode; DRY_RUN keeps this at zero. */
  readonly providerCallRecords: number
  readonly scenarioRunsCompleted: number
  readonly elapsedMs: number
  readonly replayMismatches: number
  readonly mandatoryEvictions: number
  readonly unexplainedDecisions: number
  readonly orphanRehydrates: number
}

export type C0StopDecision =
  | { readonly stop: false }
  | { readonly stop: true; readonly condition: C0StopConditionId; readonly reason: string }

// Ledger-driven stop checks. The remaining contract conditions are
// event-driven and handled by the runner directly:
//   S-1 provider binding failure / provider failure after the first model call
//   S-2 schema or validation failure (unexpected observation/planner errors)
//   S-5 unexplained materialization failure (impossible in SHADOW mode)
//   S-8 operator kill-switch
export function evaluateC0StopConditions(ledgers: C0StopLedgers): C0StopDecision {
  if (ledgers.replayMismatches > 0) {
    return {
      stop: true,
      condition: 'S-3',
      reason: `replay mismatch count ${ledgers.replayMismatches} > 0`
    }
  }
  if (ledgers.mandatoryEvictions > 0) {
    return {
      stop: true,
      condition: 'S-4',
      reason: `mandatory/pinned eviction count ${ledgers.mandatoryEvictions} > 0`
    }
  }
  if (ledgers.unexplainedDecisions > 0) {
    return {
      stop: true,
      condition: 'S-6',
      reason: `unexplained decision count ${ledgers.unexplainedDecisions} > 0`
    }
  }
  if (ledgers.orphanRehydrates > 0) {
    return {
      stop: true,
      condition: 'S-6',
      reason: `orphan REHYDRATE count ${ledgers.orphanRehydrates} > 0 (no originating REMOVE)`
    }
  }
  if (ledgers.providerCallRecords > C0_BUDGETS.maxProviderCalls) {
    return {
      stop: true,
      condition: 'S-7',
      reason: `provider-call budget breached: ${ledgers.providerCallRecords} > ${C0_BUDGETS.maxProviderCalls}`
    }
  }
  if (ledgers.scenarioRunsCompleted > C0_BUDGETS.maxScenarioRuns) {
    return {
      stop: true,
      condition: 'S-7',
      reason: `scenario-run budget breached: ${ledgers.scenarioRunsCompleted} > ${C0_BUDGETS.maxScenarioRuns}`
    }
  }
  if (ledgers.elapsedMs > C0_BUDGETS.maxWallClockMs) {
    return {
      stop: true,
      condition: 'S-7',
      reason: `wall-clock budget breached: ${ledgers.elapsedMs}ms > ${C0_BUDGETS.maxWallClockMs}ms`
    }
  }
  return { stop: false }
}

/** True when starting another provider turn would necessarily exceed the call budget. */
export function providerCallBudgetExhausted(providerCallRecords: number): boolean {
  return providerCallRecords >= C0_BUDGETS.maxProviderCalls
}

// ---------------------------------------------------------------------------
// Scenario vocabulary (contract section 4)
// ---------------------------------------------------------------------------

export type C0ScenarioId = 'E1' | 'E2' | 'E3' | 'E4'

/** Normalized lifecycle event kinds the canary drives (types.ts vocabulary). */
export type C0LifecycleEventKind =
  | 'SOURCE_RULED_OUT'
  | 'SOURCE_SUPERSEDED'
  | 'FAILURE_OBSERVED'
  | 'PHASE_CHANGED'
  | 'DETAIL_REQUESTED'

export interface C0LifecycleEventSpec {
  readonly kind: C0LifecycleEventKind
  readonly sourceKeys: readonly string[]
  readonly evidenceRef: string
}

/** Scripted planning-request patch, mirroring RequestPatch semantics (B1). */
export interface C0SignalPatch {
  readonly taskPhase?: TaskPhase
  readonly excludedSourceKeys?: readonly string[]
  readonly currentTargetSourceKeys?: readonly string[]
  /** Overrides the observed recent-evidence keys when present (E4). */
  readonly recentEvidenceSourceKeys?: readonly string[]
  readonly representationNeeds?: readonly ContextRepresentationNeed[]
}

export interface C0ExpectedDecision {
  readonly kind: DecisionKind
  readonly sourceKey: string
  readonly requiredReasonCodes?: readonly ReasonCode[]
  readonly requiredAnyReasonCodes?: readonly ReasonCode[]
  readonly representationKind?: string
}

export interface C0ScenarioFixtureFile {
  readonly path: string
  readonly content: string
}

export interface C0ScenarioTurn {
  readonly label: string
  /** Live prompt text; also the scripted user message in DRY_RUN. */
  readonly prompt: string
  /** Scripted tool traffic appended at this turn (metadata-only, deterministic). */
  readonly append?: readonly PiMessageView[]
  readonly events?: readonly C0LifecycleEventSpec[]
  readonly patch?: C0SignalPatch
}

export interface C0ScenarioDefinition {
  readonly id: C0ScenarioId
  readonly name: string
  readonly intent: string
  readonly turns: readonly C0ScenarioTurn[]
  readonly expectedChain: readonly C0ExpectedDecision[]
  readonly requiredFinalActiveSourceKeys?: readonly string[]
  readonly forbiddenFinalActiveSourceKeys?: readonly string[]
  /** Minimal fixture files written for the live provider run. */
  readonly fixtureFiles?: readonly C0ScenarioFixtureFile[]
}

function userTurn(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function readCall(callId: string, path: string): PiMessageView {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: callId, name: 'read', arguments: { path } }]
  }
}

function readResult(callId: string, text: string): PiMessageView {
  return {
    role: 'toolResult',
    content: [{ type: 'text', text }],
    toolCallId: callId,
    toolName: 'read',
    isError: false
  }
}

/**
 * A scripted logical source is the run-event pair emitted by one read tool
 * call: `run/tool-call://<callId>` + `run/tool-result://<callId>`.
 */
export function c0RunEventSourceKeys(callId: string): readonly string[] {
  return [`run/tool-call://${callId}`, `run/tool-result://${callId}`]
}

// --- E1: Distractor Elimination -------------------------------------------

const E1_TARGET = 'c0-e1-target'
const E1_DISTRACTOR_A = 'c0-e1-distractor-a'
const E1_DISTRACTOR_B = 'c0-e1-distractor-b'

const E1_TURN_1_PROMPT =
  'Investigate the HTTP client. Read src/api/client.ts, src/experimental/client-v0.ts and src/api/client.test.ts with the read tool, then report one line per file.'
const E1_TURN_2_PROMPT =
  'The audit in docs/audit.md rules out the experimental client v0 as a distractor. Exclude src/experimental/client-v0.ts from further analysis and continue with the maintained client only.'
const E1_TURN_3_PROMPT = 'Summarize the maintained client and its tests in two lines.'

export const C0_E1_DISTRACTOR_ELIMINATION: C0ScenarioDefinition = {
  id: 'E1',
  name: 'Distractor Elimination',
  intent:
    'Several plausible sources are investigated; one is clearly ruled out while the true target remains active.',
  fixtureFiles: [
    { path: 'src/api/client.ts', content: 'export function clientFetch() { /* maintained */ }\n' },
    { path: 'src/experimental/client-v0.ts', content: 'export function legacyClient() { /* experimental */ }\n' },
    { path: 'src/api/client.test.ts', content: 'test("clientFetch", () => {})\n' }
  ],
  turns: [
    {
      label: 'investigate',
      prompt: E1_TURN_1_PROMPT,
      append: [
        readCall(E1_TARGET, 'src/api/client.ts'),
        readResult(E1_TARGET, 'maintained client: clientFetch'),
        readCall(E1_DISTRACTOR_A, 'src/experimental/client-v0.ts'),
        readResult(E1_DISTRACTOR_A, 'experimental client v0: legacyClient'),
        readCall(E1_DISTRACTOR_B, 'src/api/client.test.ts'),
        readResult(E1_DISTRACTOR_B, 'maintained client tests')
      ],
      patch: { currentTargetSourceKeys: c0RunEventSourceKeys(E1_TARGET) }
    },
    {
      label: 'rule-out-distractor',
      prompt: E1_TURN_2_PROMPT,
      events: [
        {
          kind: 'SOURCE_RULED_OUT',
          sourceKeys: c0RunEventSourceKeys(E1_DISTRACTOR_A),
          evidenceRef: 'evidence:E1:ruled-out:experimental-client-v0'
        }
      ],
      patch: { excludedSourceKeys: c0RunEventSourceKeys(E1_DISTRACTOR_A) }
    },
    {
      label: 'confirm',
      prompt: E1_TURN_3_PROMPT
    }
  ],
  expectedChain: [
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E1_TARGET}`,
      requiredReasonCodes: ['CURRENT_TARGET']
    },
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E1_DISTRACTOR_A}`,
      requiredReasonCodes: ['RECENT_RUN_EVIDENCE']
    },
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E1_DISTRACTOR_B}`,
      requiredReasonCodes: ['RECENT_RUN_EVIDENCE']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-call://${E1_DISTRACTOR_A}`,
      requiredReasonCodes: ['RULED_OUT']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-result://${E1_DISTRACTOR_A}`,
      requiredReasonCodes: ['RULED_OUT']
    }
  ],
  requiredFinalActiveSourceKeys: [
    ...c0RunEventSourceKeys(E1_TARGET),
    ...c0RunEventSourceKeys(E1_DISTRACTOR_B)
  ],
  forbiddenFinalActiveSourceKeys: c0RunEventSourceKeys(E1_DISTRACTOR_A)
}

// --- E2: Wrong Path Recovery ----------------------------------------------

const E2_REOPEN = 'c0-e2-reopen-a'

const E2_TURN_1_PROMPT =
  'Investigate the regression in src/reopen-a.ts. Read it with the read tool and summarize the current behavior.'
const E2_TURN_2_PROMPT =
  'The triage log rules out src/reopen-a.ts as the cause. Exclude it from further analysis.'
const E2_TURN_3_PROMPT =
  'The build failed again and the log points back into src/reopen-a.ts. Re-open that file with full detail.'

export const C0_E2_WRONG_PATH_RECOVERY: C0ScenarioDefinition = {
  id: 'E2',
  name: 'Wrong Path Recovery',
  intent:
    'Source A is investigated and removed as ruled out; later failure evidence points back to A.',
  fixtureFiles: [{ path: 'src/reopen-a.ts', content: 'export function reopenA() { /* suspect */ }\n' }],
  turns: [
    {
      label: 'investigate',
      prompt: E2_TURN_1_PROMPT,
      append: [readCall(E2_REOPEN, 'src/reopen-a.ts'), readResult(E2_REOPEN, 'reopen-a current behavior')],
      patch: { currentTargetSourceKeys: c0RunEventSourceKeys(E2_REOPEN) }
    },
    {
      label: 'rule-out',
      prompt: E2_TURN_2_PROMPT,
      events: [
        {
          kind: 'SOURCE_RULED_OUT',
          sourceKeys: c0RunEventSourceKeys(E2_REOPEN),
          evidenceRef: 'evidence:E2:ruled-out:reopen-a'
        }
      ],
      patch: { excludedSourceKeys: c0RunEventSourceKeys(E2_REOPEN) }
    },
    {
      label: 'failure-reopen',
      prompt: E2_TURN_3_PROMPT,
      events: [
        {
          kind: 'FAILURE_OBSERVED',
          sourceKeys: c0RunEventSourceKeys(E2_REOPEN),
          evidenceRef: 'evidence:E2:failure:reopen-a'
        },
        {
          kind: 'DETAIL_REQUESTED',
          sourceKeys: c0RunEventSourceKeys(E2_REOPEN),
          evidenceRef: 'evidence:E2:detail:reopen-a'
        }
      ],
      patch: {
        excludedSourceKeys: [],
        currentTargetSourceKeys: c0RunEventSourceKeys(E2_REOPEN),
        representationNeeds: [
          {
            sourceKey: `run/tool-result://${E2_REOPEN}`,
            preferredKind: 'FULL',
            reasonCode: 'DETAIL_REQUIRED'
          }
        ]
      }
    }
  ],
  expectedChain: [
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E2_REOPEN}`,
      requiredReasonCodes: ['CURRENT_TARGET']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-call://${E2_REOPEN}`,
      requiredReasonCodes: ['RULED_OUT']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-result://${E2_REOPEN}`,
      requiredReasonCodes: ['RULED_OUT']
    },
    {
      kind: 'REHYDRATE',
      sourceKey: `run/tool-call://${E2_REOPEN}`,
      requiredAnyReasonCodes: ['NEW_FAILURE_EVIDENCE', 'DETAIL_REQUIRED']
    },
    {
      kind: 'REHYDRATE',
      sourceKey: `run/tool-result://${E2_REOPEN}`,
      requiredAnyReasonCodes: ['NEW_FAILURE_EVIDENCE', 'DETAIL_REQUIRED'],
      representationKind: 'FULL'
    }
  ],
  requiredFinalActiveSourceKeys: c0RunEventSourceKeys(E2_REOPEN)
}

// --- E3: Phase Shift --------------------------------------------------------

const E3_DETAIL = 'c0-e3-phase-detail'

const E3_TURN_1_PROMPT =
  'Investigation phase. Read src/phase-detail.ts with the read tool and keep its complete content available.'
const E3_TURN_2_PROMPT =
  'Implementation phase. The full investigation detail is no longer needed; keep only a reference to src/phase-detail.ts.'
const E3_TURN_3_PROMPT =
  'Verification phase. The exact full content of src/phase-detail.ts is required again.'

export const C0_E3_PHASE_SHIFT: C0ScenarioDefinition = {
  id: 'E3',
  name: 'Phase Shift',
  intent:
    'Investigation needs full detail; implementation drops it; verification needs the full detail again.',
  fixtureFiles: [{ path: 'src/phase-detail.ts', content: 'export const phaseDetail = { steps: 3 }\n' }],
  turns: [
    {
      label: 'investigate-full',
      prompt: E3_TURN_1_PROMPT,
      append: [readCall(E3_DETAIL, 'src/phase-detail.ts'), readResult(E3_DETAIL, 'phase detail full content')],
      patch: {
        taskPhase: 'INVESTIGATE',
        currentTargetSourceKeys: c0RunEventSourceKeys(E3_DETAIL),
        representationNeeds: [
          {
            sourceKey: `run/tool-result://${E3_DETAIL}`,
            preferredKind: 'FULL',
            reasonCode: 'DETAIL_REQUIRED'
          }
        ]
      }
    },
    {
      label: 'implement-narrow',
      prompt: E3_TURN_2_PROMPT,
      events: [
        {
          kind: 'PHASE_CHANGED',
          sourceKeys: c0RunEventSourceKeys(E3_DETAIL),
          evidenceRef: 'evidence:E3:phase-implement'
        }
      ],
      patch: {
        taskPhase: 'IMPLEMENT',
        excludedSourceKeys: c0RunEventSourceKeys(E3_DETAIL),
        currentTargetSourceKeys: [],
        representationNeeds: [
          {
            sourceKey: `run/tool-result://${E3_DETAIL}`,
            preferredKind: 'REFERENCE',
            reasonCode: 'REPRESENTATION_NARROWED'
          }
        ]
      }
    },
    {
      label: 'verify-detail',
      prompt: E3_TURN_3_PROMPT,
      events: [
        {
          kind: 'DETAIL_REQUESTED',
          sourceKeys: c0RunEventSourceKeys(E3_DETAIL),
          evidenceRef: 'evidence:E3:verify-detail'
        }
      ],
      patch: {
        taskPhase: 'VERIFY',
        excludedSourceKeys: [],
        currentTargetSourceKeys: c0RunEventSourceKeys(E3_DETAIL),
        representationNeeds: [
          {
            sourceKey: `run/tool-result://${E3_DETAIL}`,
            preferredKind: 'FULL',
            reasonCode: 'DETAIL_REQUIRED'
          }
        ]
      }
    }
  ],
  expectedChain: [
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E3_DETAIL}`,
      requiredReasonCodes: ['CURRENT_TARGET']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-call://${E3_DETAIL}`,
      requiredReasonCodes: ['PHASE_IRRELEVANT']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-result://${E3_DETAIL}`,
      requiredReasonCodes: ['PHASE_IRRELEVANT']
    },
    {
      kind: 'REHYDRATE',
      sourceKey: `run/tool-call://${E3_DETAIL}`,
      requiredReasonCodes: ['DETAIL_REQUIRED']
    },
    {
      kind: 'REHYDRATE',
      sourceKey: `run/tool-result://${E3_DETAIL}`,
      requiredReasonCodes: ['DETAIL_REQUIRED'],
      representationKind: 'FULL'
    }
  ],
  requiredFinalActiveSourceKeys: c0RunEventSourceKeys(E3_DETAIL)
}

// --- E4: Superseded Evidence ------------------------------------------------

const E4_OLD = 'c0-e4-failure-old'
const E4_NEW = 'c0-e4-failure-new'

const E4_TURN_1_PROMPT =
  'Review the latest verification run. Read logs/test-run-100.log with the read tool and summarize the failure.'
const E4_TURN_2_PROMPT =
  'A newer run supersedes it. Read logs/test-run-101.log and base your analysis on the new failure only.'
const E4_TURN_3_PROMPT = 'Confirm the current failure set in one line.'

export const C0_E4_SUPERSEDED_EVIDENCE: C0ScenarioDefinition = {
  id: 'E4',
  name: 'Superseded Evidence',
  intent: 'An old failure is repaired and a new failure replaces it.',
  fixtureFiles: [
    { path: 'logs/test-run-100.log', content: 'FAIL auth: token expiry\n' },
    { path: 'logs/test-run-101.log', content: 'FAIL regression: config reload\n' }
  ],
  turns: [
    {
      label: 'review-old-failure',
      prompt: E4_TURN_1_PROMPT,
      append: [readCall(E4_OLD, 'logs/test-run-100.log'), readResult(E4_OLD, 'old failure: auth token expiry')]
    },
    {
      label: 'supersede',
      prompt: E4_TURN_2_PROMPT,
      append: [readCall(E4_NEW, 'logs/test-run-101.log'), readResult(E4_NEW, 'new failure: config reload regression')],
      events: [
        {
          kind: 'FAILURE_OBSERVED',
          sourceKeys: c0RunEventSourceKeys(E4_NEW),
          evidenceRef: 'evidence:E4:new-failure'
        },
        {
          kind: 'SOURCE_SUPERSEDED',
          sourceKeys: c0RunEventSourceKeys(E4_OLD),
          evidenceRef: 'evidence:E4:old-superseded'
        }
      ],
      patch: {
        excludedSourceKeys: c0RunEventSourceKeys(E4_OLD),
        recentEvidenceSourceKeys: c0RunEventSourceKeys(E4_NEW)
      }
    },
    {
      label: 'confirm',
      prompt: E4_TURN_3_PROMPT
    }
  ],
  expectedChain: [
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E4_OLD}`,
      requiredReasonCodes: ['RECENT_RUN_EVIDENCE']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-call://${E4_OLD}`,
      requiredReasonCodes: ['SUPERSEDED']
    },
    {
      kind: 'REMOVE',
      sourceKey: `run/tool-result://${E4_OLD}`,
      requiredReasonCodes: ['SUPERSEDED']
    },
    {
      kind: 'ADD',
      sourceKey: `run/tool-result://${E4_NEW}`,
      requiredReasonCodes: ['NEW_FAILURE_EVIDENCE']
    }
  ],
  requiredFinalActiveSourceKeys: c0RunEventSourceKeys(E4_NEW),
  forbiddenFinalActiveSourceKeys: c0RunEventSourceKeys(E4_OLD)
}

export const C0_SCENARIOS: readonly C0ScenarioDefinition[] = [
  C0_E1_DISTRACTOR_ELIMINATION,
  C0_E2_WRONG_PATH_RECOVERY,
  C0_E3_PHASE_SHIFT,
  C0_E4_SUPERSEDED_EVIDENCE
]

// Contract amendment 2 (2026-08-27, pre-execution): a run may target a subset
// of scenarios when earlier runs already banked terminal evidence for the
// others (e.g. run c0-20260827-8cdb65c4 and c0-20260827-9faf18ac both
// recorded E1/E2 PASS). The subset is explicit, validated, recorded in the
// manifest, and never changes the per-scenario semantics.
export function parseC0ScenarioSubset(
  value: string | undefined
): { readonly scenarios: readonly C0ScenarioDefinition[]; readonly error?: undefined } | { readonly scenarios?: undefined; readonly error: string } {
  if (value === undefined) {
    return { scenarios: C0_SCENARIOS }
  }
  const requested = value
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token !== '')
  if (requested.length === 0) {
    return { error: 'CANVAS_C0_ONLY was set but contained no scenario ids' }
  }
  const known = new Set(C0_SCENARIOS.map((scenario) => scenario.id))
  const seen = new Set<string>()
  for (const id of requested) {
    if (!known.has(id as C0ScenarioId)) {
      return { error: `unknown scenario id "${id}" (expected a subset of E1,E2,E3,E4)` }
    }
    if (seen.has(id)) {
      return { error: `duplicate scenario id "${id}"` }
    }
    seen.add(id)
  }
  return {
    scenarios: C0_SCENARIOS.filter((scenario) => seen.has(scenario.id))
  }
}

// ---------------------------------------------------------------------------
// Executor: observation seam -> universe -> scripted patch -> REAL planner
// ---------------------------------------------------------------------------

export const C0_POLICY_VERSION = 'policy-v0-c0-lifecycle'

/** Fixed clock for the scripted path so hashes are reproducible in tests. */
export const C0_SCRIPTED_NOW = '2026-08-27T00:00:00.000Z'

interface MutableC0PlanningState {
  taskPhase: TaskPhase
  excludedSourceKeys: string[]
  currentTargetSourceKeys: string[]
  recentEvidenceSourceKeys: string[] | null
  representationNeeds: ContextRepresentationNeed[]
  sourceLifecycleSignals: SourceLifecycleSignal[]
}

function initialC0PlanningState(): MutableC0PlanningState {
  return {
    taskPhase: 'GENERAL',
    excludedSourceKeys: [],
    currentTargetSourceKeys: [],
    recentEvidenceSourceKeys: null,
    representationNeeds: [],
    sourceLifecycleSignals: []
  }
}

// B1 mapping of normalized trace events to SourceLifecycleSignals
// (tests/fixtures/policy-lifecycle/runner.ts lifecycleSignalForEvent).
function lifecycleSignalForEvent(
  event: C0LifecycleEventSpec,
  sourceKey: string
): SourceLifecycleSignal {
  const kind =
    event.kind === 'SOURCE_RULED_OUT'
      ? 'RULED_OUT'
      : event.kind === 'SOURCE_SUPERSEDED'
        ? 'SUPERSEDED'
        : event.kind === 'FAILURE_OBSERVED'
          ? 'NEW_FAILURE_EVIDENCE'
          : event.kind === 'PHASE_CHANGED'
            ? 'PHASE_IRRELEVANT'
            : 'DETAIL_REQUIRED'
  return {
    sourceKey,
    kind,
    evidenceRef: event.evidenceRef
  }
}

export interface C0ChainDecision {
  readonly kind: DecisionKind
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: string | null
  readonly reasonCodes: readonly ReasonCode[]
}

export interface C0BoundaryRecord {
  readonly turnLabel: string
  readonly modelCallSequence: number | null
  readonly transitionSequence: number
  readonly transitionId: string
  readonly transitionLogicalHash: string
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly replayVerified: boolean
  readonly decisionCount: number
}

export interface C0ScenarioExecutorOptions {
  readonly runtimeSessionId: string
  readonly now?: () => string
  readonly policyVersion?: string
  readonly maxSemanticTokens?: number
}

/** Transactional planning snapshot of {@link C0ScenarioExecutor}. */
export interface C0PlanningSnapshot {
  readonly enriched: ReturnType<EnrichedPiShadowObserver['snapshotForTransaction']>
  readonly state: MutableC0PlanningState
  readonly previousWorkingSet: ContextWorkingSet | null
  readonly latestTransition: ContextTransition | null
  readonly removalHistory: readonly RemovalRecord[]
  readonly planningSequence: number
  readonly turnLabel: string
  readonly representationsById: ReadonlyMap<string, ContextRepresentation>
  readonly boundaries: readonly C0BoundaryRecord[]
  readonly records: readonly C0DecisionRecord[]
  readonly chain: readonly C0ChainDecision[]
  readonly universeVersionIds: ReadonlySet<string>
}

/** Deterministic JSON with recursively sorted keys (digest input). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Canonical identity for the frozen C0 scenario corpus.
 *
 * The live runner records this digest in its manifest so an evidence
 * directory can be checked against the exact prompts, scripted tool traffic,
 * lifecycle events, fixtures and expected decision chain used by the run.
 * This is deliberately derived from plain JSON data only; no provider or
 * filesystem access is involved.
 */
export const C0_CORPUS_MANIFEST_ID = 'cspv-c0-corpus-v1'

export function c0CorpusManifest(): {
  readonly manifestId: string
  readonly policyVersion: string
  readonly scenarios: readonly C0ScenarioDefinition[]
} {
  return {
    manifestId: C0_CORPUS_MANIFEST_ID,
    policyVersion: C0_POLICY_VERSION,
    scenarios: C0_SCENARIOS
  }
}

export function c0CorpusManifestHash(): string {
  return sha256Hex(stableStringify(c0CorpusManifest()))
}

export class C0ScenarioExecutor {
  readonly base: PiContextShadowObserver
  readonly enriched: EnrichedPiShadowObserver
  private readonly policyVersion: string
  private readonly createdAt: string
  private readonly maxSemanticTokens: number
  private state: MutableC0PlanningState = initialC0PlanningState()
  private previousWorkingSet: ContextWorkingSet | null = null
  private latestTransition: ContextTransition | null = null
  private removalHistory: RemovalRecord[] = []
  private planningSequence = 0
  private turnLabel = 'unstarted'
  private readonly representationsById = new Map<string, ContextRepresentation>()
  readonly boundaries: C0BoundaryRecord[] = []
  readonly records: C0DecisionRecord[] = []
  readonly chain: C0ChainDecision[] = []
  readonly universeVersionIds = new Set<string>()

  constructor(options: C0ScenarioExecutorOptions) {
    this.base = new PiContextShadowObserver({
      runtimeSessionId: options.runtimeSessionId,
      ...(options.now !== undefined ? { now: options.now } : {})
    })
    this.enriched = new EnrichedPiShadowObserver({ base: this.base })
    this.policyVersion = options.policyVersion ?? C0_POLICY_VERSION
    this.createdAt = options.now?.() ?? new Date().toISOString()
    this.maxSemanticTokens = options.maxSemanticTokens ?? 1000
  }

  get runtimeSessionId(): string {
    return this.base.runtimeSession.runtimeSessionId
  }

  get observationCount(): number {
    return this.base.inMemory.observations.length
  }

  get replayMismatchCount(): number {
    return this.boundaries.filter((boundary) => !boundary.replayVerified).length
  }

  /**
   * Evaluate safety stops against the executor's current records.
   *
   * The live runner calls this from the Pi context hook itself, before the
   * current prompt can proceed to another provider boundary. This is separate
   * from `finalizeScenarioRun`: a terminal safety decision must abort the live
   * session even when the prompt emits several context events in one turn.
   */
  currentSafetyStop(): C0StopDecision {
    const evaluator = evaluateC0Scenario({
      records: this.records,
      universeVersionIds: [...this.universeVersionIds]
    })
    return evaluateC0StopConditions({
      providerCallRecords: 0,
      scenarioRunsCompleted: 0,
      elapsedMs: 0,
      replayMismatches: this.replayMismatchCount,
      mandatoryEvictions: evaluator.counts.mandatoryEvictions,
      unexplainedDecisions: evaluator.counts.unexplainedDecisions,
      orphanRehydrates: evaluator.counts.orphanRehydrates
    })
  }

  finalActiveSourceKeys(): readonly string[] {
    return (this.previousWorkingSet?.items ?? []).flatMap((item) => item.sourceKeys)
  }

  /**
   * Latest planned Working Set (null before the first boundary). Read-only
   * accessor for the CR-004 Stage 1 Active seam, which composes its rewrite
   * from the SAME planner output that produced the observed chain.
   */
  get latestWorkingSet(): ContextWorkingSet | null {
    return this.previousWorkingSet
  }

  /** Latest planned Transition (null before the first boundary). Read-only Stage 1 accessor. */
  get latestTransitionResult(): ContextTransition | null {
    return this.latestTransition
  }

  /**
   * Transactional planning snapshot (CR-004 hardening): everything
   * `beginTurn` + `observeBoundary` mutate — the planning state, the planned
   * Working Set / Transition chain, the decision history, the representation
   * registry, and the underlying observation seam (enriched observer
   * snapshot). `restorePlanningState` rewinds ALL of it so an intervention
   * attempt that fails composition/guard leaves the executor exactly as it
   * was before the attempt; the event is then re-observed natively.
   */
  snapshotPlanningState(): C0PlanningSnapshot {
    return {
      enriched: this.enriched.snapshotForTransaction(),
      state: this.state,
      previousWorkingSet: this.previousWorkingSet,
      latestTransition: this.latestTransition,
      removalHistory: this.removalHistory,
      planningSequence: this.planningSequence,
      turnLabel: this.turnLabel,
      representationsById: new Map(this.representationsById),
      boundaries: [...this.boundaries],
      records: [...this.records],
      chain: [...this.chain],
      universeVersionIds: new Set(this.universeVersionIds)
    }
  }

  restorePlanningState(snapshot: C0PlanningSnapshot): void {
    this.enriched.restoreTransaction(snapshot.enriched)
    this.state = snapshot.state
    this.previousWorkingSet = snapshot.previousWorkingSet
    this.latestTransition = snapshot.latestTransition
    this.removalHistory = [...snapshot.removalHistory]
    this.planningSequence = snapshot.planningSequence
    this.turnLabel = snapshot.turnLabel
    this.representationsById.clear()
    for (const [id, representation] of snapshot.representationsById) {
      this.representationsById.set(id, representation)
    }
    this.boundaries.length = 0
    this.boundaries.push(...snapshot.boundaries)
    this.records.length = 0
    this.records.push(...snapshot.records)
    this.chain.length = 0
    this.chain.push(...snapshot.chain)
    this.universeVersionIds.clear()
    for (const versionId of snapshot.universeVersionIds) {
      this.universeVersionIds.add(versionId)
    }
  }

  /**
   * Deterministic sha256 over the semantic planning history (boundaries,
   * decisions, chain, universe versions, final active sources, planning
   * sequence and observation count). Regression tests hash this before/after
   * a rolled-back intervention attempt to prove the history is unchanged.
   */
  planningStateDigest(): string {
    return sha256Hex(
      stableStringify({
        boundaries: this.boundaries,
        records: this.records,
        chain: this.chain,
        universeVersionIds: [...this.universeVersionIds].sort(),
        finalActiveSourceKeys: [...this.finalActiveSourceKeys()].sort(),
        planningSequence: this.planningSequence,
        observationCount: this.observationCount,
        excludedSourceKeys: this.state.excludedSourceKeys
      })
    )
  }

  /** Applies a turn's scripted events + request patch before its boundaries. */
  beginTurn(turn: C0ScenarioTurn): void {
    this.turnLabel = turn.label
    if (turn.events !== undefined) {
      for (const event of turn.events) {
        for (const sourceKey of event.sourceKeys) {
          const signal = lifecycleSignalForEvent(event, sourceKey)
          this.state = {
            ...this.state,
            sourceLifecycleSignals: [
              ...this.state.sourceLifecycleSignals.filter(
                (existing) =>
                  !(existing.sourceKey === signal.sourceKey && existing.kind === signal.kind)
              ),
              signal
            ]
          }
        }
      }
    }
    const patch = turn.patch
    if (patch !== undefined) {
      this.state = {
        taskPhase: patch.taskPhase ?? this.state.taskPhase,
        excludedSourceKeys:
          patch.excludedSourceKeys !== undefined
            ? [...patch.excludedSourceKeys]
            : this.state.excludedSourceKeys,
        currentTargetSourceKeys:
          patch.currentTargetSourceKeys !== undefined
            ? [...patch.currentTargetSourceKeys]
            : this.state.currentTargetSourceKeys,
        recentEvidenceSourceKeys:
          patch.recentEvidenceSourceKeys !== undefined
            ? [...patch.recentEvidenceSourceKeys]
            : this.state.recentEvidenceSourceKeys,
        representationNeeds:
          patch.representationNeeds !== undefined
            ? [...patch.representationNeeds]
            : this.state.representationNeeds,
        sourceLifecycleSignals: this.state.sourceLifecycleSignals
      }
    }
  }

  /**
   * Live-mode source derivation: the adapter queues the scenario's scripted
   * run-event sources as authoritative metadata-only observations. They are
   * consumed at the next model-call boundary through normal reconciliation.
   */
  queueExternalObservations(observations: readonly ExternalObservation[]): void {
    this.enriched.queueExternalObservations(observations)
  }

  /**
   * One model-call boundary: observe the conversation (CR-001 observation +
   * CR-002 universe advancement, the shadow-planner smoke path), plan the
   * Working Set with the REAL policy-v0 planner, map decisions to C0 records,
   * and verify determinism by RE-PLANNING the identical boundary inputs.
   */
  observeBoundary(messages: readonly PiMessageView[]): C0BoundaryRecord {
    const enrichedResult = this.enriched.observeModelCall(messages)
    const universe = enrichedResult.universeRevision
    for (const entry of universe.entries) {
      if (entry.admittedVersion !== null) {
        this.universeVersionIds.add(entry.admittedVersion.versionId)
      }
    }

    this.planningSequence += 1
    const request = this.makePlanningRequest(
      this.planningSequence,
      enrichedResult.recentEvidenceSourceKeys
    )

    const previousItemsByKey = new Map<string, ContextWorkingSetItem>()
    for (const item of this.previousWorkingSet?.items ?? []) {
      for (const key of item.sourceKeys) previousItemsByKey.set(key, item)
    }

    // Deterministic replay evidence: re-execute the identical boundary inputs
    // (same universe revision, same request, same previous Working Set, same
    // options) and compare transition/working-set logical hashes. Offline and
    // honest; materialization evidence stays absent (SHADOW never
    // materializes), so the evaluator reports that criterion NOT_OBSERVED.
    const first = this.planOnce(universe, request)
    const second = this.planOnce(universe, request)
    const replayVerified =
      second.transition.logicalHash === first.transition.logicalHash &&
      second.workingSet.logicalHash === first.workingSet.logicalHash

    for (const decision of first.decisions) {
      const representation = this.representationsById.get(decision.representationId)
      this.chain.push({
        kind: decision.kind,
        sourceKey: decision.sourceKey,
        sourceVersionId: decision.sourceVersionId,
        representationId: decision.representationId,
        representationKind: representation?.kind ?? null,
        reasonCodes: [...decision.reasonCodes]
      })
      const previousItem = previousItemsByKey.get(decision.sourceKey)
      this.records.push({
        decisionId: decision.decisionId,
        kind: decision.kind,
        sourceKey: decision.sourceKey,
        sourceVersionId: decision.sourceVersionId,
        representationId: decision.representationId,
        reasonCodes: [...decision.reasonCodes],
        transitionSequence: first.transition.sequence,
        modelCallSequence: universe.modelCallSequence ?? null,
        ...(decision.kind === 'REMOVE' && previousItem !== undefined
          ? { protection: previousItem.protection }
          : {}),
        replayVerified
      })
      if (decision.kind === 'REMOVE') {
        this.removalHistory = [
          ...this.removalHistory,
          {
            sourceKey: decision.sourceKey,
            originalRemovalReasonCodes: [...decision.reasonCodes],
            removedAtSequence: this.planningSequence,
            removedFromWorkingSetId: decision.fromWorkingSetId
          }
        ]
      }
    }

    const boundary: C0BoundaryRecord = {
      turnLabel: this.turnLabel,
      modelCallSequence: universe.modelCallSequence ?? null,
      transitionSequence: first.transition.sequence,
      transitionId: first.transition.transitionId,
      transitionLogicalHash: first.transition.logicalHash,
      fromWorkingSetId: first.transition.fromWorkingSetId,
      toWorkingSetId: first.transition.toWorkingSetId,
      replayVerified,
      decisionCount: first.decisions.length
    }
    this.boundaries.push(boundary)
    this.previousWorkingSet = first.workingSet
    this.latestTransition = first.transition
    return boundary
  }

  private planOnce(
    universe: ContextUniverseRevision,
    request: ContextPlanningRequest
  ): ReturnType<typeof planWorkingSet> {
    return planWorkingSet({
      universe,
      request,
      previousWorkingSet: this.previousWorkingSet,
      options: {
        policyVersion: this.policyVersion,
        createdAt: this.createdAt,
        represent: (entry: ContextUniverseEntry) => this.representEntry(entry)
      }
    })
  }

  private makePlanningRequest(
    sequence: number,
    observedRecentEvidenceSourceKeys: readonly string[]
  ): ContextPlanningRequest {
    return {
      runtimeSessionId: this.runtimeSessionId,
      recompositionSequence: sequence,
      taskPhase: this.state.taskPhase,
      budget: { maxSemanticTokens: this.maxSemanticTokens },
      pinnedSourceKeys: [],
      excludedSourceKeys: [...this.state.excludedSourceKeys],
      currentTargetSourceKeys: [...this.state.currentTargetSourceKeys],
      latestVerificationSourceKeys: [],
      recentEvidenceSourceKeys:
        this.state.recentEvidenceSourceKeys ?? [...observedRecentEvidenceSourceKeys],
      sourceLifecycleSignals: [...this.state.sourceLifecycleSignals],
      removalHistory: [...this.removalHistory],
      representationNeeds: [...this.state.representationNeeds],
      previousWorkingSetId: this.previousWorkingSet?.workingSetId ?? null
    }
  }

  // Deterministic metadata-only representations mirroring the frozen fixture
  // token model (FULL 40 / LINE_RANGE 14 / SUMMARY 10 / REFERENCE 6).
  private representEntry(entry: ContextUniverseEntry): ContextRepresentation | null {
    const version = entry.admittedVersion
    if (version === null) return null
    const need = this.state.representationNeeds.find(
      (candidate) => candidate.sourceKey === entry.source.sourceKey
    )
    const kind = need?.preferredKind ?? 'REFERENCE'
    const representation = createRepresentation({
      kind,
      sourceVersionIds: [version.versionId],
      contentHash: `c0-repr:${kind}:${version.contentHash}`,
      tokenEstimate: kind === 'FULL' ? 40 : kind === 'LINE_RANGE' ? 14 : 6,
      lossiness: kind === 'FULL' || kind === 'LINE_RANGE' ? 'NONE' : 'BOUNDED',
      derivation: {
        harness: 'cspv-c0',
        sourceKey: entry.source.sourceKey,
        sourceVersionId: version.versionId
      }
    })
    this.representationsById.set(representation.id, representation)
    return representation
  }
}

// ---------------------------------------------------------------------------
// Scripted turn observations (live-mode source derivation)
// ---------------------------------------------------------------------------

function scriptedToolCallIds(messages: readonly PiMessageView[]): readonly string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    for (const block of message.content ?? []) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'toolCall' &&
        typeof (block as { id?: unknown }).id === 'string'
      ) {
        const id = (block as { id: string }).id
        if (id.length > 0) ids.push(id)
      }
    }
  }
  return ids
}

/**
 * Metadata-only observations for the scripted sources introduced by one turn.
 * Used ONLY by the live runner: the provider's real messages do not contain the
 * scenario's synthetic tool-call ids, so the adapter (this runner) supplies the
 * normalized run-event identities through the sanctioned external-observation
 * seam. Content hashes are deterministic functions of the script.
 */
export function turnScriptedObservations(
  scenario: C0ScenarioDefinition,
  turn: C0ScenarioTurn,
  observedAt: string
): readonly ExternalObservation[] {
  const observations: ExternalObservation[] = []
  for (const callId of scriptedToolCallIds(turn.append ?? [])) {
    for (const sourceKey of c0RunEventSourceKeys(callId)) {
      const contentHash = sha256Hex(`c0-script|${scenario.id}|${sourceKey}`)
      observations.push({
        observation: createAvailableObservation(sourceKey, contentHash, observedAt),
        descriptor: {
          sourceKey,
          sourceKind: sourceKey.startsWith('run/tool-call://')
            ? 'run-tool-call'
            : 'run-tool-result',
          provenance: 'C0_SCENARIO_SCRIPT'
        }
      })
    }
  }
  return observations
}

// ---------------------------------------------------------------------------
// Scenario verdict: expected chain + Gate D evaluator
// ---------------------------------------------------------------------------

export type C0ScenarioOutcome = 'PASS' | 'FAIL' | 'NOT_OBSERVED'

export interface C0ScenarioRunResult {
  readonly scenarioId: C0ScenarioId
  readonly runtimeSessionId: string
  readonly records: readonly C0DecisionRecord[]
  readonly boundaries: readonly C0BoundaryRecord[]
  readonly chain: readonly C0ChainDecision[]
  readonly finalActiveSourceKeys: readonly string[]
  readonly universeVersionIds: readonly string[]
  readonly replayMismatchCount: number
  readonly evaluator: C0ScenarioVerdict
  readonly chainFailures: readonly string[]
  readonly chainSatisfied: boolean
  readonly scenarioVerdict: C0ScenarioOutcome
  readonly stopCondition: { readonly condition: C0StopConditionId; readonly reason: string } | null
}

function expectedDecisionMatches(
  expected: C0ExpectedDecision,
  decision: C0ChainDecision
): boolean {
  if (decision.kind !== expected.kind || decision.sourceKey !== expected.sourceKey) {
    return false
  }
  if (
    expected.representationKind !== undefined &&
    decision.representationKind !== expected.representationKind
  ) {
    return false
  }
  for (const reasonCode of expected.requiredReasonCodes ?? []) {
    if (!decision.reasonCodes.includes(reasonCode)) return false
  }
  if (
    expected.requiredAnyReasonCodes !== undefined &&
    !expected.requiredAnyReasonCodes.some((reasonCode) =>
      decision.reasonCodes.includes(reasonCode)
    )
  ) {
    return false
  }
  return true
}

export function validateC0ExpectedChain(
  scenario: C0ScenarioDefinition,
  chain: readonly C0ChainDecision[],
  finalActiveSourceKeys: readonly string[]
): readonly string[] {
  const failures: string[] = []
  const used = new Set<number>()
  for (const expected of scenario.expectedChain) {
    const matchIndex = chain.findIndex(
      (decision, index) => !used.has(index) && expectedDecisionMatches(expected, decision)
    )
    if (matchIndex < 0) {
      const reasons = [
        ...(expected.requiredReasonCodes ?? []),
        ...(expected.requiredAnyReasonCodes ?? [])
      ].join('|')
      failures.push(
        `missing ${expected.kind} for ${expected.sourceKey}` +
          (reasons.length > 0 ? ` (${reasons})` : '')
      )
      continue
    }
    used.add(matchIndex)
  }
  const activeKeys = new Set(finalActiveSourceKeys)
  for (const sourceKey of scenario.requiredFinalActiveSourceKeys ?? []) {
    if (!activeKeys.has(sourceKey)) {
      failures.push(`required active source missing: ${sourceKey}`)
    }
  }
  for (const sourceKey of scenario.forbiddenFinalActiveSourceKeys ?? []) {
    if (activeKeys.has(sourceKey)) {
      failures.push(`forbidden active source remains: ${sourceKey}`)
    }
  }
  return failures
}

/**
 * Composite scenario verdict. The evaluator's own `overall` stays FAIL whenever
 * any Gate D criterion is NOT_OBSERVED (by design: a readiness gate needs
 * positive evidence). For the C0 canary the honest per-scenario verdict is:
 *   NOT_OBSERVED - the scenario produced no decision records at all;
 *   FAIL         - the expected chain diverged, any criterion actively FAILED,
 *                  provenance broke, or a fail-closed stop condition fired;
 *   PASS         - chain satisfied and everything observable in SHADOW mode is
 *                  positive. NOT_OBSERVED criteria (materialization, and the
 *                  rehydrate criteria of E1/E4 whose nominal chains contain no
 *                  REHYDRATE per the manifest) do not block a C0 scenario PASS;
 *                  they are Gate D evidence gaps, recorded verbatim.
 */
export function computeC0ScenarioVerdict(
  scenario: C0ScenarioDefinition,
  input: {
    readonly records: readonly C0DecisionRecord[]
    readonly chain: readonly C0ChainDecision[]
    readonly finalActiveSourceKeys: readonly string[]
    readonly universeVersionIds: readonly string[]
    readonly replayMismatchCount: number
  }
): {
  readonly evaluator: C0ScenarioVerdict
  readonly chainFailures: readonly string[]
  readonly chainSatisfied: boolean
  readonly scenarioVerdict: C0ScenarioOutcome
  readonly stopCondition: { readonly condition: C0StopConditionId; readonly reason: string } | null
} {
  const evaluator = evaluateC0Scenario({
    records: input.records,
    universeVersionIds: input.universeVersionIds
  })
  const chainFailures = [
    ...validateC0ExpectedChain(scenario, input.chain, input.finalActiveSourceKeys)
  ]
  const chainSatisfied = chainFailures.length === 0

  const stop = evaluateC0StopConditions({
    providerCallRecords: 0,
    scenarioRunsCompleted: 0,
    elapsedMs: 0,
    replayMismatches: input.replayMismatchCount,
    mandatoryEvictions: evaluator.counts.mandatoryEvictions,
    unexplainedDecisions: evaluator.counts.unexplainedDecisions,
    orphanRehydrates: evaluator.counts.orphanRehydrates
  })

  let scenarioVerdict: C0ScenarioOutcome
  if (input.records.length === 0) {
    scenarioVerdict = 'NOT_OBSERVED'
  } else if (stop.stop) {
    scenarioVerdict = 'FAIL'
  } else if (!chainSatisfied) {
    scenarioVerdict = 'FAIL'
  } else if (evaluator.counts.provenanceRetained !== 1) {
    scenarioVerdict = 'FAIL'
  } else if (Object.values(evaluator.criteria).some((verdict) => verdict === 'FAIL')) {
    scenarioVerdict = 'FAIL'
  } else {
    scenarioVerdict = 'PASS'
  }

  return {
    evaluator,
    chainFailures,
    chainSatisfied,
    scenarioVerdict,
    stopCondition: stop.stop ? { condition: stop.condition, reason: stop.reason } : null
  }
}

// ---------------------------------------------------------------------------
// Credential-free scripted driver (DRY_RUN + unit tests)
// ---------------------------------------------------------------------------

export interface C0ScenarioRunOptions {
  readonly runtimeSessionId?: string
  readonly now?: () => string
  readonly policyVersion?: string
}

/**
 * Runs one scenario end to end with scripted deterministic messages: the SAME
 * executor -> REAL policy-v0 planner -> evaluator wiring the live runner uses.
 * Zero provider calls.
 */
export function runScenarioOnScriptedMessages(
  scenario: C0ScenarioDefinition,
  options: C0ScenarioRunOptions = {}
): C0ScenarioRunResult {
  const now = options.now ?? (() => C0_SCRIPTED_NOW)
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: options.runtimeSessionId ?? `c0-script:${scenario.id.toLowerCase()}`,
    now,
    ...(options.policyVersion !== undefined ? { policyVersion: options.policyVersion } : {})
  })
  runScriptedTurns(scenario, executor)
  return finalizeScenarioRun(scenario, executor)
}

/**
 * Drives an executor through a scenario's scripted turns: the turn prompt is
 * the scripted user message, turn.append adds the scripted tool traffic, and
 * each turn ends in one observed model-call boundary. Shared by the
 * credential-free DRY_RUN mode and the unit tests.
 */
export function runScriptedTurns(
  scenario: C0ScenarioDefinition,
  executor: C0ScenarioExecutor
): void {
  const conversation: PiMessageView[] = []
  for (const turn of scenario.turns) {
    executor.beginTurn(turn)
    conversation.push(userTurn(turn.prompt), ...(turn.append ?? []))
    executor.observeBoundary(conversation)
  }
}

/** Computes the full run result from a completed executor (shared by both modes). */
export function finalizeScenarioRun(
  scenario: C0ScenarioDefinition,
  executor: C0ScenarioExecutor
): C0ScenarioRunResult {
  const verdict = computeC0ScenarioVerdict(scenario, {
    records: executor.records,
    chain: executor.chain,
    finalActiveSourceKeys: executor.finalActiveSourceKeys(),
    universeVersionIds: [...executor.universeVersionIds],
    replayMismatchCount: executor.replayMismatchCount
  })
  return {
    scenarioId: scenario.id,
    runtimeSessionId: executor.runtimeSessionId,
    records: [...executor.records],
    boundaries: [...executor.boundaries],
    chain: [...executor.chain],
    finalActiveSourceKeys: [...executor.finalActiveSourceKeys()],
    universeVersionIds: [...executor.universeVersionIds],
    replayMismatchCount: executor.replayMismatchCount,
    evaluator: verdict.evaluator,
    chainFailures: verdict.chainFailures,
    chainSatisfied: verdict.chainSatisfied,
    scenarioVerdict: verdict.scenarioVerdict,
    stopCondition: verdict.stopCondition
  }
}
