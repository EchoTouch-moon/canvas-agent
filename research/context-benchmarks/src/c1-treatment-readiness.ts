import {
  computeTransitionLogicalHash,
  computeWorkingSetLogicalHash,
  createDecisionId,
  planWorkingSet,
  seedUniverse,
  createRepresentation,
  sha256Hex,
  type ContextPlanningRequest,
  type ContextRepresentation,
  type ContextDecision,
  type ContextTransition,
  type ContextUniverseRevision,
  type ContextWorkingSet,
  type ContextWorkingSetItem,
  type RemovalRecord,
  type SourceLifecycleSignal,
  type SnapshotLikeSeed
} from '@canvas-agent/context-runtime'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import {
  activeMessagesHash,
  analyzeNativeMessages,
  assertRewriteSafe,
  composeActiveRewrite,
  createRunKillSwitch,
  type ActiveRewriteReady,
  type RunKillSwitch
} from '@canvas-agent/pi-context-integration/experimental'

export const C1_C_READINESS_ID = 'C1-C_TREATMENT_READINESS_V1'
export const C1_C_PARENT_REVISION = '64e09980b0f8ef3b0830dbaec360c2aa0e3a9960'
export const C1_C_CONTRACT_SHA256 =
  '1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4'
export const C1_C_ASSIGNMENT_MATRIX_SHA256 =
  '630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7'
export const C1_C_TASK_MANIFEST_SHA256 =
  '2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38'
export const C1_C_TREATMENT_REVISION = '5dc3c3abb37383cd679f39712e2c316d89efdeab'

const READINESS_PROVIDER = 'step-plan'
const READINESS_MODEL = 'step-3.7-flash'
const READINESS_ENDPOINT = 'https://api.stepfun.com/step_plan/v1/chat/completions'
const READINESS_TASK_ID = 'c1-c-treatment-readiness-synthetic-v1'
const READINESS_PAIR_ID = 'c1-c-readiness-pair-01'
const READINESS_NATIVE_RUN_ID = 'c1-c-20260901-native-01'
const READINESS_RUNTIME_RUN_ID = 'c1-c-20260901-runtime-01'
const READINESS_TURN_ID = 'turn-01'
const READINESS_MODEL_CALL_ID = 'model-call-01'
const READINESS_RUNTIME_SESSION_ID = 'c1-c-readiness-runtime-session-v1'
const READINESS_NOW = '2026-09-01T00:00:00.000Z'
const READINESS_POLICY_VERSION = 'policy-v0-c1-c-treatment-readiness-v1'
const READINESS_FIXTURE_ID = 'c1-c-treatment-readiness-fixture-v1'
const READINESS_FIXTURE_HASH = sha256Hex(
  'c1-c-treatment-readiness-fixture-v1|target|distractor|tool-structure'
)
const READINESS_EVALUATOR_ID = 'c1-c-readiness-oracle-v1'
const READINESS_MAX_SEMANTIC_TOKENS = 100
const READINESS_MAX_PROVIDER_CALLS = 24

const TARGET_CALL_ID = 'c1-c-target-read'
const DISTRACTOR_CALL_ID = 'c1-c-distractor-read'
const TARGET_CALL_KEY = `run/tool-call://${TARGET_CALL_ID}`
const TARGET_RESULT_KEY = `run/tool-result://${TARGET_CALL_ID}`
const DISTRACTOR_CALL_KEY = `run/tool-call://${DISTRACTOR_CALL_ID}`
const DISTRACTOR_RESULT_KEY = `run/tool-result://${DISTRACTOR_CALL_ID}`
const TARGET_KEYS = Object.freeze([TARGET_CALL_KEY, TARGET_RESULT_KEY])
const DISTRACTOR_KEYS = Object.freeze([DISTRACTOR_CALL_KEY, DISTRACTOR_RESULT_KEY])
const ALL_READINESS_KEYS = Object.freeze([...TARGET_KEYS, ...DISTRACTOR_KEYS])

const T4_EVALUATE_KEY = 'repository/file://src/parser/evaluate.js'
const T4_CACHE_KEY = 'repository/file://src/search/cache.js'
const T4_EVALUATE_CALL_ID = 'c1-c-t4-evaluate-read'
const T4_CACHE_CALL_ID = 'c1-c-t4-cache-read'
const T4_EVALUATE_PROVIDER_KEYS = Object.freeze([
  `run/tool-call://${T4_EVALUATE_CALL_ID}`,
  `run/tool-result://${T4_EVALUATE_CALL_ID}`
])
const T4_CACHE_PROVIDER_KEYS = Object.freeze([
  `run/tool-call://${T4_CACHE_CALL_ID}`,
  `run/tool-result://${T4_CACHE_CALL_ID}`
])
const T4_PROVIDER_KEYS_BY_SOURCE: ReadonlyMap<string, readonly string[]> = new Map([
  [T4_EVALUATE_KEY, T4_EVALUATE_PROVIDER_KEYS],
  [T4_CACHE_KEY, T4_CACHE_PROVIDER_KEYS]
])
const T4_TASK_ID = 'c1-c-t4-lifecycle-synthetic-v1'
const T4_PAIR_ID = 'c1-c-t4-lifecycle-pair-01'
const T4_COLD_RUN_ID = 'c1-c-20260901-t4-cold-01'
const T4_RESTORED_RUN_ID = 'c1-c-20260901-t4-restored-01'

export type C1ReadinessVerdict = 'PASS' | 'FAIL'
export type C1ReadinessArm = 'NATIVE' | 'RUNTIME'
export type C1ReadinessFailureCode =
  | 'MATERIALIZATION_FAILED'
  | 'CONTEXT_REPLACEMENT_FAILED'
  | 'BINDING_MISMATCH'
  | 'STALE_REVISION'
  | 'INVALID_TRANSITION'
  | 'UNEXPECTED_READINESS_FAILURE'

export const C1_C_FAILURE_INJECTIONS = Object.freeze([
  'MATERIALIZATION_FAILED',
  'CONTEXT_REPLACEMENT_FAILED',
  'BINDING_MISMATCH',
  'STALE_REVISION',
  'INVALID_TRANSITION'
] as const)
export type C1ReadinessFailureInjection = (typeof C1_C_FAILURE_INJECTIONS)[number]

export const C1_C_REQUIRED_GATES = Object.freeze([
  'nativeFidelity',
  'runtimeTreatmentActive',
  'structuralPreservation',
  'silentFallback',
  'evidenceJoin',
  'budgetEnforcement',
  't4LifecycleChain'
] as const)
export type C1ReadinessGateId = (typeof C1_C_REQUIRED_GATES)[number]

export interface C1ReadinessCheck {
  readonly checkId: string
  readonly verdict: C1ReadinessVerdict
  readonly observed: string
}

export interface C1ReadinessGate {
  readonly gateId: string
  readonly verdict: C1ReadinessVerdict
  readonly checks: readonly C1ReadinessCheck[]
}

export interface C1ReadinessProviderUsage {
  readonly status: 'NOT_OBSERVED_IN_READINESS'
  readonly providerCalls: 0
  readonly providerReportedTokens: 'NOT_APPLICABLE'
  readonly cost: 'NOT_APPLICABLE'
}

export interface C1TreatmentReadinessReport {
  readonly readinessId: typeof C1_C_READINESS_ID
  readonly schemaVersion: 1
  readonly status: C1ReadinessVerdict
  readonly overallVerdict: C1ReadinessVerdict
  readonly executionMode: 'CREDENTIAL_FREE_NO_NETWORK'
  readonly provider: typeof READINESS_PROVIDER
  readonly model: typeof READINESS_MODEL
  readonly endpoint: typeof READINESS_ENDPOINT
  readonly providerCalls: 0
  readonly usage: C1ReadinessProviderUsage
  readonly contractBinding: {
    readonly contractId: 'C1_RUN_CONTRACT_V1'
    readonly contractSha256: typeof C1_C_CONTRACT_SHA256
    readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
    readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
    readonly parentRevision: typeof C1_C_PARENT_REVISION
    readonly treatmentRevision: typeof C1_C_TREATMENT_REVISION
  }
  readonly requiredGates: readonly C1ReadinessGateId[]
  readonly nativeFidelity: C1ReadinessGate
  readonly runtimeTreatmentActive: C1ReadinessGate
  readonly structuralPreservation: C1ReadinessGate
  readonly silentFallback: C1ReadinessGate
  readonly evidenceJoin: C1ReadinessGate
  readonly budgetEnforcement: C1ReadinessGate
  readonly t4LifecycleChain: C1ReadinessGate
}

export interface C1TreatmentFailureProbeResult {
  readonly injection: C1ReadinessFailureInjection
  readonly status: 'TERMINAL_FAILURE'
  readonly failureCode: C1ReadinessFailureCode
  readonly fallbackSent: false
  readonly capturedProviderBoundRequests: 0
  readonly killSwitchTripped: true
}

interface ReadinessSourceFixture {
  readonly sourceKey: string
  readonly content: string
  readonly sourceKind: string
}

interface MaterializedContextEntry {
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: string
  readonly content: string
}

interface MaterializedWorkingSet {
  readonly entries: readonly MaterializedContextEntry[]
  readonly sourceKeys: readonly string[]
  readonly fingerprint: string
}

interface PlanningContext {
  readonly universe: ContextUniverseRevision
  readonly representationsById: Map<string, ContextRepresentation>
}

interface MainPlanningFixture extends PlanningContext {
  readonly initial: {
    readonly workingSet: ContextWorkingSet
    readonly transition: ContextTransition
  }
  readonly runtime: {
    readonly workingSet: ContextWorkingSet
    readonly transition: ContextTransition
  }
}

interface T4ProviderBoundSnapshot {
  readonly phase: 'COLD' | 'RESTORED'
  readonly request: CapturedProviderBoundRequest
  readonly materialized: MaterializedWorkingSet
  readonly providerSourceKeys: readonly string[]
}

interface T4LifecycleProbeCheck {
  readonly checkId: string
  readonly pass: boolean
  readonly observed: string
}

interface T4LifecycleProbeResult {
  readonly lifecyclePass: boolean
  readonly pass: boolean
  readonly checks: readonly T4LifecycleProbeCheck[]
  readonly observed: string
}

interface ReadinessProviderPayload {
  readonly api: 'openai-completions'
  readonly systemInstruction: string
  readonly developerMessages: readonly string[]
  readonly messages: readonly PiMessageView[]
  readonly tools: readonly ReadinessToolDefinition[]
  readonly providerNativeMetadata: Readonly<{
    readonly reasoningFormat: 'text'
    readonly responseFormat: 'text'
    readonly streaming: false
  }>
}

interface ReadinessToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: 'read' | 'edit'
    readonly description: string
    readonly parameters: Readonly<Record<string, string>>
  }
}

interface CapturedProviderBoundRequest {
  readonly taskId: string
  readonly pairId: string
  readonly arm: C1ReadinessArm
  readonly runId: string
  readonly turnId: string
  readonly modelCallId: string
  readonly workingSetId: string
  readonly transitionId: string
  readonly workingSetLogicalHash: string
  readonly transitionLogicalHash: string
  readonly materializedWorkingSetFingerprint: string
  readonly fixtureId: typeof READINESS_FIXTURE_ID
  readonly fixtureHash: typeof READINESS_FIXTURE_HASH
  readonly evaluatorId: typeof READINESS_EVALUATOR_ID
  readonly executionBudget: {
    readonly maxSemanticTokens: typeof READINESS_MAX_SEMANTIC_TOKENS
    readonly maxProviderCalls: typeof READINESS_MAX_PROVIDER_CALLS
  }
  readonly modelVisibleContextFingerprint: string
  readonly payload: ReadinessProviderPayload
  readonly semanticRegion: { readonly start: number; readonly end: number }
  readonly requestFingerprint: string
  readonly captureStage: 'PRE_NETWORK_FAKE_CAPTURE'
}

interface RuntimeSuccess {
  readonly status: 'PASS'
  readonly request: CapturedProviderBoundRequest
  readonly materialized: MaterializedWorkingSet
  readonly composition: ActiveRewriteReady
  readonly killSwitch: RunKillSwitch
}

interface RuntimeFailure {
  readonly status: 'TERMINAL_FAILURE'
  readonly failureCode: C1ReadinessFailureCode
  readonly fallbackSent: false
  readonly capturedProviderBoundRequests: 0
  readonly killSwitch: RunKillSwitch
}

type RuntimeArmResult = RuntimeSuccess | RuntimeFailure

class C1ReadinessFailure extends Error {
  constructor(
    readonly code: C1ReadinessFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'C1ReadinessFailure'
  }
}

class InMemoryReadinessCapture {
  private readonly captured: CapturedProviderBoundRequest[] = []

  capture(request: CapturedProviderBoundRequest): void {
    this.captured.push(request)
  }

  get requests(): readonly CapturedProviderBoundRequest[] {
    return [...this.captured]
  }
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  throw new Error(`unsupported value in readiness canonicalization: ${typeof value}`)
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

function check(checkId: string, verdict: boolean, observed: string): C1ReadinessCheck {
  return { checkId, verdict: verdict ? 'PASS' : 'FAIL', observed }
}

function gate(gateId: string, checks: readonly C1ReadinessCheck[]): C1ReadinessGate {
  return {
    gateId,
    verdict: checks.every((item) => item.verdict === 'PASS') ? 'PASS' : 'FAIL',
    checks
  }
}

function sourceFixtures(): readonly ReadinessSourceFixture[] {
  return [
    {
      sourceKey: TARGET_CALL_KEY,
      sourceKind: 'RUN_TOOL_CALL',
      content: 'read src/parser/evaluate.js'
    },
    {
      sourceKey: TARGET_RESULT_KEY,
      sourceKind: 'RUN_TOOL_RESULT',
      content: 'evaluate.js: parser path is the current target'
    },
    {
      sourceKey: DISTRACTOR_CALL_KEY,
      sourceKind: 'RUN_TOOL_CALL',
      content: 'read src/search/cache.js'
    },
    {
      sourceKey: DISTRACTOR_RESULT_KEY,
      sourceKind: 'RUN_TOOL_RESULT',
      content: 'cache.js: plausible but unrelated path'
    }
  ]
}

function t4SourceFixtures(): readonly ReadinessSourceFixture[] {
  return [
    {
      sourceKey: T4_EVALUATE_KEY,
      sourceKind: 'REPOSITORY_FILE',
      content: 'export function evaluate(node) { return node.left + node.right }\n'
    },
    {
      sourceKey: T4_CACHE_KEY,
      sourceKind: 'REPOSITORY_FILE',
      content: 'export function cacheLookup(key) { return cache.get(key) }\n'
    }
  ]
}

function createPlanningContext(sources: readonly ReadinessSourceFixture[]): PlanningContext {
  const seeds: SnapshotLikeSeed[] = sources.map((source) => ({
    sourceKey: source.sourceKey,
    sourceKind: source.sourceKind,
    contentHash: sha256Hex(`c1-c-fixture-content-v1|${source.content}`),
    authority: 'C1-C_SYNTHETIC_FIXTURE',
    priority: 'P2',
    provenance: 'c1-c-readiness-fixture-v1',
    observedAt: READINESS_NOW
  }))
  const universe = seedUniverse({
    runtimeSessionId: READINESS_RUNTIME_SESSION_ID,
    seeds
  })
  const representations = new Map<string, ContextRepresentation>()
  return {
    universe,
    representationsById: representations
  }
}

function planningRequest(input: {
  readonly sequence: number
  readonly currentTargetSourceKeys: readonly string[]
  readonly excludedSourceKeys?: readonly string[]
  readonly previousWorkingSetId: string | null
  readonly sourceLifecycleSignals?: readonly SourceLifecycleSignal[]
  readonly removalHistory?: readonly RemovalRecord[]
}): ContextPlanningRequest {
  return {
    runtimeSessionId: READINESS_RUNTIME_SESSION_ID,
    recompositionSequence: input.sequence,
    taskPhase: input.sequence === 0 ? 'INVESTIGATE' : 'DEBUG',
    budget: { maxSemanticTokens: READINESS_MAX_SEMANTIC_TOKENS },
    pinnedSourceKeys: [],
    excludedSourceKeys: input.excludedSourceKeys ?? [],
    currentTargetSourceKeys: input.currentTargetSourceKeys,
    latestVerificationSourceKeys: [],
    recentEvidenceSourceKeys: [],
    ...(input.sourceLifecycleSignals !== undefined
      ? { sourceLifecycleSignals: input.sourceLifecycleSignals }
      : {}),
    ...(input.removalHistory !== undefined ? { removalHistory: input.removalHistory } : {}),
    previousWorkingSetId: input.previousWorkingSetId
  }
}

function planFromContext(
  context: PlanningContext,
  request: ContextPlanningRequest,
  previousWorkingSet: ContextWorkingSet | null
): {
  readonly workingSet: ContextWorkingSet
  readonly transition: ContextTransition
} {
  const result = planWorkingSet({
    universe: context.universe,
    request,
    previousWorkingSet,
    options: {
      policyVersion: READINESS_POLICY_VERSION,
      createdAt: READINESS_NOW,
      represent: (entry) => {
        const source = entry.source.sourceKey
        const sourceFixture =
          sourceFixtures().find((candidate) => candidate.sourceKey === source) ??
          t4SourceFixtures().find((candidate) => candidate.sourceKey === source)
        if (sourceFixture === undefined) {
          throw new C1ReadinessFailure(
            'MATERIALIZATION_FAILED',
            `unknown readiness source ${source}`
          )
        }
        const version = entry.admittedVersion
        if (version === null) {
          throw new C1ReadinessFailure(
            'MATERIALIZATION_FAILED',
            `readiness source ${source} has no admitted version`
          )
        }
        const representation = createRepresentation({
          kind: 'FULL',
          sourceVersionIds: [version.versionId],
          contentHash: sha256Hex(
            `c1-c-representation-v1|${source}|${version.versionId}|${sourceFixture.content}`
          ),
          tokenEstimate: 3,
          lossiness: 'NONE',
          derivation: {
            fixture: 'c1-c-readiness-fixture-v1',
            sourceKey: source,
            sourceVersionId: version.versionId
          },
          content: sourceFixture.content
        })
        context.representationsById.set(representation.id, representation)
        return representation
      }
    }
  })
  return { workingSet: result.workingSet, transition: result.transition }
}

function buildMainPlanningFixture(): MainPlanningFixture {
  const context = createPlanningContext(sourceFixtures())
  const initial = planFromContext(
    context,
    planningRequest({
      sequence: 0,
      currentTargetSourceKeys: ALL_READINESS_KEYS,
      previousWorkingSetId: null
    }),
    null
  )
  const runtime = planFromContext(
    context,
    planningRequest({
      sequence: 1,
      currentTargetSourceKeys: TARGET_KEYS,
      excludedSourceKeys: DISTRACTOR_KEYS,
      previousWorkingSetId: initial.workingSet.workingSetId
    }),
    initial.workingSet
  )
  return { ...context, initial, runtime }
}

function materializeWorkingSet(input: {
  readonly workingSet: ContextWorkingSet
  readonly universe: ContextUniverseRevision
  readonly representationsById: ReadonlyMap<string, ContextRepresentation>
  readonly fail?: boolean
}): MaterializedWorkingSet {
  if (input.fail === true) {
    throw new C1ReadinessFailure(
      'MATERIALIZATION_FAILED',
      'synthetic materialization failure was injected before provider binding'
    )
  }
  const entries: MaterializedContextEntry[] = []
  for (const item of input.workingSet.items) {
    if (item.sourceKeys.length !== 1 || item.sourceVersionIds.length !== 1) {
      throw new C1ReadinessFailure(
        'MATERIALIZATION_FAILED',
        `readiness materializer requires one source/version per item: ${item.representationId}`
      )
    }
    const sourceKey = item.sourceKeys[0]
    const sourceVersionId = item.sourceVersionIds[0]
    if (sourceKey === undefined || sourceVersionId === undefined) {
      throw new C1ReadinessFailure(
        'MATERIALIZATION_FAILED',
        'working-set item is missing source identity'
      )
    }
    const universeEntry = input.universe.entries.find(
      (candidate) => candidate.source.sourceKey === sourceKey
    )
    const admittedVersion = universeEntry?.admittedVersion
    if (admittedVersion === undefined || admittedVersion === null) {
      throw new C1ReadinessFailure(
        'STALE_REVISION',
        `no admitted version for materialized source ${sourceKey}`
      )
    }
    if (admittedVersion.versionId !== sourceVersionId) {
      throw new C1ReadinessFailure(
        'STALE_REVISION',
        `working-set version ${sourceVersionId} is stale for ${sourceKey}`
      )
    }
    if (input.workingSet.plannedFromUniverseHash !== input.universe.logicalHash) {
      throw new C1ReadinessFailure(
        'STALE_REVISION',
        `working set was planned against ${input.workingSet.plannedFromUniverseHash}, received ${input.universe.logicalHash}`
      )
    }
    const representation = input.representationsById.get(item.representationId)
    if (representation === undefined) {
      throw new C1ReadinessFailure(
        'MATERIALIZATION_FAILED',
        `representation ${item.representationId} is not available`
      )
    }
    if (
      !representation.sourceVersionIds.includes(sourceVersionId) ||
      representation.content === undefined ||
      representation.contentRef !== undefined
    ) {
      throw new C1ReadinessFailure(
        'MATERIALIZATION_FAILED',
        `representation ${item.representationId} cannot materialize exact content`
      )
    }
    entries.push({
      sourceKey,
      sourceVersionId,
      representationId: representation.id,
      representationKind: representation.kind,
      content: representation.content
    })
  }
  const sourceKeys = entries.map((entry) => entry.sourceKey)
  const fingerprint = sha256Hex(
    [
      'c1-c-materialized-working-set-v1',
      ...entries.map((entry) =>
        [
          entry.sourceKey,
          entry.sourceVersionId,
          entry.representationId,
          entry.representationKind,
          entry.content
        ].join('|')
      )
    ].join('\u241F')
  )
  return {
    entries: Object.freeze(entries),
    sourceKeys: Object.freeze(sourceKeys),
    fingerprint
  }
}

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function readPair(
  callId: string,
  path: string,
  resultText: string,
  includeThinking = false
): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        ...(includeThinking
          ? [{ type: 'thinking', thinking: 'retain opaque reasoning block' }]
          : []),
        { type: 'toolCall', id: callId, name: 'read', arguments: { path } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: resultText }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function nativeMessages(): readonly PiMessageView[] {
  return [
    userMessage('Investigate the parser path and retain only the maintained target.'),
    ...readPair(
      TARGET_CALL_ID,
      'src/parser/evaluate.js',
      'evaluate.js: parser path is the current target',
      true
    ),
    ...readPair(DISTRACTOR_CALL_ID, 'src/search/cache.js', 'cache.js: plausible but unrelated path')
  ]
}

const READINESS_TOOLS: readonly ReadinessToolDefinition[] = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a repository source.',
      parameters: { path: 'string' }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit a repository source.',
      parameters: { path: 'string' }
    }
  }
])

const READINESS_SYSTEM = 'Follow the frozen task contract and preserve tool continuity.'
const READINESS_DEVELOPER = Object.freeze([
  'The task fixture and provider binding are fixed for this readiness probe.'
])
const READINESS_PROVIDER_METADATA = Object.freeze({
  reasoningFormat: 'text' as const,
  responseFormat: 'text' as const,
  streaming: false as const
})

function semanticMessageFingerprint(messages: readonly PiMessageView[]): string {
  return activeMessagesHash(messages)
}

function buildProviderBoundRequest(input: {
  readonly arm: C1ReadinessArm
  readonly runId: string
  readonly plan: {
    readonly workingSet: ContextWorkingSet
    readonly transition: ContextTransition
  }
  readonly materializedWorkingSetFingerprint: string
  readonly messages: readonly PiMessageView[]
  readonly taskId?: string
  readonly pairId?: string
  readonly turnId?: string
  readonly modelCallId?: string
}): CapturedProviderBoundRequest {
  const payload: ReadinessProviderPayload = {
    api: 'openai-completions',
    systemInstruction: READINESS_SYSTEM,
    developerMessages: READINESS_DEVELOPER,
    messages: Object.freeze([...input.messages]),
    tools: READINESS_TOOLS,
    providerNativeMetadata: READINESS_PROVIDER_METADATA
  }
  const semanticRegion = { start: 1, end: payload.messages.length }
  const modelVisibleContextFingerprint = semanticMessageFingerprint(
    payload.messages.slice(semanticRegion.start, semanticRegion.end)
  )
  const requestFingerprint = sha256Hex(`c1-c-provider-bound-request-v1|${stableStringify(payload)}`)
  return {
    taskId: input.taskId ?? READINESS_TASK_ID,
    pairId: input.pairId ?? READINESS_PAIR_ID,
    arm: input.arm,
    runId: input.runId,
    turnId: input.turnId ?? READINESS_TURN_ID,
    modelCallId: input.modelCallId ?? READINESS_MODEL_CALL_ID,
    workingSetId: input.plan.workingSet.workingSetId,
    transitionId: input.plan.transition.transitionId,
    workingSetLogicalHash: input.plan.workingSet.logicalHash,
    transitionLogicalHash: input.plan.transition.logicalHash,
    materializedWorkingSetFingerprint: input.materializedWorkingSetFingerprint,
    fixtureId: READINESS_FIXTURE_ID,
    fixtureHash: READINESS_FIXTURE_HASH,
    evaluatorId: READINESS_EVALUATOR_ID,
    executionBudget: {
      maxSemanticTokens: READINESS_MAX_SEMANTIC_TOKENS,
      maxProviderCalls: READINESS_MAX_PROVIDER_CALLS
    },
    modelVisibleContextFingerprint,
    payload,
    semanticRegion,
    requestFingerprint,
    captureStage: 'PRE_NETWORK_FAKE_CAPTURE'
  }
}

function nativeReferencePlan(fixture: MainPlanningFixture): {
  readonly workingSet: ContextWorkingSet
  readonly transition: ContextTransition
} {
  return fixture.initial
}

function executeNativeArm(
  fixture: MainPlanningFixture,
  capture: InMemoryReadinessCapture
): CapturedProviderBoundRequest {
  const materialized = materializeWorkingSet({
    workingSet: fixture.initial.workingSet,
    universe: fixture.universe,
    representationsById: fixture.representationsById
  })
  const request = buildProviderBoundRequest({
    arm: 'NATIVE',
    runId: READINESS_NATIVE_RUN_ID,
    plan: nativeReferencePlan(fixture),
    materializedWorkingSetFingerprint: materialized.fingerprint,
    messages: nativeMessages()
  })
  // The Native observer is deliberately metadata-only: it returns the exact
  // model-facing payload it observed and does not call the replacement seam.
  const observed = {
    ...request,
    payload: { ...request.payload, messages: [...request.payload.messages] }
  }
  capture.capture(observed)
  return observed
}

function sourceKeysInMessages(messages: readonly PiMessageView[]): readonly string[] {
  const analysis = analyzeNativeMessages(messages, {
    runtimeSessionId: READINESS_RUNTIME_SESSION_ID,
    modelCallSequence: 1
  })
  return Object.freeze(
    [...new Set(analysis.messages.flatMap((message) => message.sourceKeys))].sort()
  )
}

function executeRuntimeArm(input: {
  readonly fixture: MainPlanningFixture
  readonly capture: InMemoryReadinessCapture
  readonly failureInjection?: C1ReadinessFailureInjection
}): RuntimeArmResult {
  const killSwitch = createRunKillSwitch(READINESS_RUNTIME_RUN_ID, {
    now: () => READINESS_NOW
  })
  try {
    const injection = input.failureInjection
    const universe =
      injection === 'STALE_REVISION'
        ? { ...input.fixture.universe, logicalHash: 'stale-revision-injected' }
        : input.fixture.universe
    const materialized = materializeWorkingSet({
      workingSet: input.fixture.runtime.workingSet,
      universe,
      representationsById: input.fixture.representationsById,
      ...(injection === 'MATERIALIZATION_FAILED' ? { fail: true } : {})
    })
    if (injection === 'CONTEXT_REPLACEMENT_FAILED') {
      throw new C1ReadinessFailure(
        'CONTEXT_REPLACEMENT_FAILED',
        'synthetic context replacement failure was injected before provider binding'
      )
    }
    const transition =
      injection === 'INVALID_TRANSITION'
        ? {
            ...input.fixture.runtime.transition,
            toWorkingSetId: 'invalid-working-set-id'
          }
        : input.fixture.runtime.transition
    const composition = composeActiveRewrite({
      messages: nativeMessages(),
      workingSet: input.fixture.runtime.workingSet,
      transition,
      runId: READINESS_RUNTIME_RUN_ID,
      killSwitch,
      activeModeOptIn: true,
      systemInstruction: READINESS_SYSTEM,
      harness: 'PI'
    })
    if (composition.kind !== 'REWRITE_READY') {
      throw new C1ReadinessFailure(
        injection === 'INVALID_TRANSITION' ? 'INVALID_TRANSITION' : 'CONTEXT_REPLACEMENT_FAILED',
        composition.detail ?? composition.reason
      )
    }
    const candidate: ActiveRewriteReady =
      injection === 'BINDING_MISMATCH'
        ? {
            ...composition,
            binding: {
              ...composition.binding,
              runId: 'wrong-readiness-run-id'
            }
          }
        : composition
    const guard = assertRewriteSafe(candidate, killSwitch)
    if (!guard.ok) {
      throw new C1ReadinessFailure(
        injection === 'BINDING_MISMATCH' ? 'BINDING_MISMATCH' : 'CONTEXT_REPLACEMENT_FAILED',
        guard.detail ?? guard.reason
      )
    }
    const selectedSourceKeys = sourceKeysInMessages(candidate.messages)
    const expectedSourceKeys = materialized.sourceKeys
    if (!sameValue(selectedSourceKeys, expectedSourceKeys)) {
      throw new C1ReadinessFailure(
        'CONTEXT_REPLACEMENT_FAILED',
        `provider-bound sources ${selectedSourceKeys.join(',')} do not match materialized sources ${expectedSourceKeys.join(',')}`
      )
    }
    const request = buildProviderBoundRequest({
      arm: 'RUNTIME',
      runId: READINESS_RUNTIME_RUN_ID,
      plan: input.fixture.runtime,
      materializedWorkingSetFingerprint: materialized.fingerprint,
      messages: candidate.messages
    })
    input.capture.capture(request)
    return {
      status: 'PASS',
      request,
      materialized,
      composition: candidate,
      killSwitch
    }
  } catch (error) {
    const normalized =
      error instanceof C1ReadinessFailure
        ? error
        : new C1ReadinessFailure(
            'UNEXPECTED_READINESS_FAILURE',
            error instanceof Error ? error.message : String(error)
          )
    killSwitch.trip(normalized.code)
    return {
      status: 'TERMINAL_FAILURE',
      failureCode: normalized.code,
      fallbackSent: false,
      capturedProviderBoundRequests: 0,
      killSwitch
    }
  }
}

function fixedProviderProjection(
  payload: ReadinessProviderPayload,
  semanticStart: number
): unknown {
  return {
    api: payload.api,
    systemInstruction: payload.systemInstruction,
    developerMessages: payload.developerMessages,
    tools: payload.tools,
    providerNativeMetadata: payload.providerNativeMetadata,
    prefixMessages: payload.messages.slice(0, semanticStart)
  }
}

function toolPairIds(messages: readonly PiMessageView[]): readonly string[] {
  const analysis = analyzeNativeMessages(messages, {
    runtimeSessionId: READINESS_RUNTIME_SESSION_ID,
    modelCallSequence: 1
  })
  return Object.freeze(
    analysis.toolPairs
      .filter(
        (pair) => pair.callMessageIndex !== undefined && pair.resultMessageIndex !== undefined
      )
      .map((pair) => pair.toolCallId)
      .sort()
  )
}

function evidenceJoinPass(
  request: CapturedProviderBoundRequest,
  expectedPlan: {
    readonly workingSet: ContextWorkingSet
    readonly transition: ContextTransition
  }
): boolean {
  return (
    request.taskId === READINESS_TASK_ID &&
    request.pairId === READINESS_PAIR_ID &&
    request.turnId === READINESS_TURN_ID &&
    request.modelCallId === READINESS_MODEL_CALL_ID &&
    request.workingSetId === expectedPlan.workingSet.workingSetId &&
    request.transitionId === expectedPlan.transition.transitionId &&
    request.workingSetLogicalHash === expectedPlan.workingSet.logicalHash &&
    request.transitionLogicalHash === expectedPlan.transition.logicalHash &&
    request.materializedWorkingSetFingerprint.length > 0 &&
    request.fixtureId === READINESS_FIXTURE_ID &&
    request.fixtureHash === READINESS_FIXTURE_HASH &&
    request.evaluatorId === READINESS_EVALUATOR_ID &&
    request.executionBudget.maxSemanticTokens === READINESS_MAX_SEMANTIC_TOKENS &&
    request.executionBudget.maxProviderCalls === READINESS_MAX_PROVIDER_CALLS &&
    request.modelVisibleContextFingerprint ===
      semanticMessageFingerprint(
        request.payload.messages.slice(request.semanticRegion.start, request.semanticRegion.end)
      ) &&
    request.requestFingerprint ===
      sha256Hex(`c1-c-provider-bound-request-v1|${stableStringify(request.payload)}`)
  )
}

function runFailureProbes(): readonly C1TreatmentFailureProbeResult[] {
  const results: C1TreatmentFailureProbeResult[] = []
  for (const injection of C1_C_FAILURE_INJECTIONS) {
    const fixture = buildMainPlanningFixture()
    const capture = new InMemoryReadinessCapture()
    const result = executeRuntimeArm({
      fixture,
      capture,
      failureInjection: injection
    })
    if (result.status !== 'TERMINAL_FAILURE') {
      throw new C1ReadinessFailure(
        'UNEXPECTED_READINESS_FAILURE',
        `failure injection ${injection} unexpectedly produced a provider-bound request`
      )
    }
    if (!result.killSwitch.isTripped) {
      throw new C1ReadinessFailure(
        'UNEXPECTED_READINESS_FAILURE',
        `failure injection ${injection} did not trip the kill switch`
      )
    }
    results.push({
      injection,
      status: result.status,
      failureCode: result.failureCode,
      fallbackSent: result.fallbackSent,
      capturedProviderBoundRequests: result.capturedProviderBoundRequests,
      killSwitchTripped: true
    })
  }
  return Object.freeze(results)
}

class InMemoryReadinessIdentityLedger {
  private readonly studyIdentities = new Set<string>()
  private readonly runIdentities = new Set<string>()
  private readonly terminalRuns = new Set<string>()

  claimStudy(studyId: string): void {
    if (this.studyIdentities.has(studyId)) throw new Error('STUDY_ID_REUSE')
    this.studyIdentities.add(studyId)
  }

  claimRun(runId: string): void {
    if (this.runIdentities.has(runId)) throw new Error('RUN_ID_REUSE')
    this.runIdentities.add(runId)
  }

  markTerminal(runId: string): void {
    if (!this.runIdentities.has(runId)) throw new Error('UNKNOWN_RUN_ID')
    this.terminalRuns.add(runId)
  }

  resume(runId: string): void {
    if (this.terminalRuns.has(runId)) throw new Error('TERMINAL_CHECKPOINT_NEVER_RESUME')
    throw new Error('READINESS_RESUME_NOT_SUPPORTED')
  }

  overwrite(runId: string): void {
    if (this.terminalRuns.has(runId)) throw new Error('TERMINAL_EVIDENCE_NEVER_OVERWRITE')
    throw new Error('READINESS_OVERWRITE_NOT_SUPPORTED')
  }
}

function rejected(action: () => void): boolean {
  try {
    action()
    return false
  } catch {
    return true
  }
}

function runExceptionSafeFinalizationProbe(): {
  readonly attempts: readonly string[]
  readonly failures: readonly string[]
  readonly manifestStatus: 'FAILED'
} {
  const attempts: string[] = []
  const failures: string[] = []
  const writers = [
    {
      name: 'transitions',
      write: () => {
        throw new Error('synthetic transition write failure')
      }
    },
    { name: 'verdicts', write: () => undefined },
    { name: 'manifest', write: () => undefined }
  ] as const
  for (const writer of writers) {
    attempts.push(writer.name)
    try {
      writer.write()
    } catch (error) {
      failures.push(`${writer.name}:${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    attempts: Object.freeze(attempts),
    failures: Object.freeze(failures),
    manifestStatus: 'FAILED'
  }
}

class FakeReadinessTransport {
  private _outboundAttempts = 0
  private _blockedAttempts = 0

  constructor(readonly maxCalls: number) {}

  send(): void {
    if (this._outboundAttempts >= this.maxCalls) {
      this._blockedAttempts += 1
      throw new Error('READINESS_PROVIDER_CALL_BUDGET_EXCEEDED_BEFORE_OUTBOUND')
    }
    this._outboundAttempts += 1
  }

  get outboundAttempts(): number {
    return this._outboundAttempts
  }

  get blockedAttempts(): number {
    return this._blockedAttempts
  }
}

function runBudgetAndIdentityProbe(): {
  readonly budgetPass: boolean
  readonly budgetObserved: string
  readonly identityPass: boolean
  readonly identityObserved: string
} {
  const budgetObservations: string[] = []
  let budgetPass = true
  for (const arm of ['NATIVE', 'RUNTIME'] as const) {
    const transport = new FakeReadinessTransport(READINESS_MAX_PROVIDER_CALLS)
    for (let index = 0; index < READINESS_MAX_PROVIDER_CALLS; index += 1) transport.send()
    const blocked = rejected(() => transport.send())
    budgetPass =
      budgetPass &&
      transport.outboundAttempts === READINESS_MAX_PROVIDER_CALLS &&
      transport.blockedAttempts === 1 &&
      blocked
    budgetObservations.push(
      `${arm}:${READINESS_MAX_PROVIDER_CALLS}_allowed/${transport.outboundAttempts}_outbound/${READINESS_MAX_PROVIDER_CALLS + 1}th_blocked=${String(blocked)}`
    )
  }

  const ledger = new InMemoryReadinessIdentityLedger()
  const studyId = 'c1-c-readiness-study-v1'
  const runId = 'c1-c-readiness-run-v1'
  ledger.claimStudy(studyId)
  ledger.claimRun(runId)
  ledger.markTerminal(runId)
  const identityChecks = [
    rejected(() => ledger.claimStudy(studyId)),
    rejected(() => ledger.claimRun(runId)),
    rejected(() => ledger.resume(runId)),
    rejected(() => ledger.overwrite(runId))
  ]
  const killSwitch = createRunKillSwitch(runId, { now: () => READINESS_NOW })
  killSwitch.trip('C1-C_SYNTHETIC_KILL_SWITCH')
  const finalization = runExceptionSafeFinalizationProbe()
  const identityPass =
    identityChecks.every(Boolean) &&
    killSwitch.isTripped &&
    finalization.attempts.join(',') === 'transitions,verdicts,manifest' &&
    finalization.failures.length === 1 &&
    finalization.manifestStatus === 'FAILED'
  return {
    budgetPass,
    budgetObserved: budgetObservations.join('; '),
    identityPass,
    identityObserved: [
      `duplicate-study/run-rejected=${String(identityChecks.every(Boolean))}`,
      `terminal-resume-rejected=${String(identityChecks[2])}`,
      `terminal-overwrite-rejected=${String(identityChecks[3])}`,
      `kill-switch=${String(killSwitch.isTripped)}`,
      `finalization-attempts=${finalization.attempts.join(',')}`
    ].join('; ')
  }
}

function t4Messages(): readonly PiMessageView[] {
  return [
    userMessage('Diagnose the parser path, then recover the exact implementation detail.'),
    ...readPair(
      T4_EVALUATE_CALL_ID,
      'src/parser/evaluate.js',
      'evaluate.js: parser implementation requires focused recovery detail'
    ),
    ...readPair(
      T4_CACHE_CALL_ID,
      'src/search/cache.js',
      'cache.js: wrong-path triage remains available'
    )
  ]
}

function t4ProviderKeysForSource(sourceKey: string): readonly string[] {
  const providerKeys = T4_PROVIDER_KEYS_BY_SOURCE.get(sourceKey)
  if (providerKeys === undefined) {
    throw new C1ReadinessFailure(
      'CONTEXT_REPLACEMENT_FAILED',
      `T4 provider projection has no mapping for ${sourceKey}`
    )
  }
  return providerKeys
}

function t4ProviderWorkingSetId(workingSetId: string): string {
  return `c1-c-t4-provider-working-set:${workingSetId}`
}

function projectT4WorkingSet(input: ContextWorkingSet): ContextWorkingSet {
  const items: ContextWorkingSetItem[] = []
  for (const item of input.items) {
    if (item.sourceKeys.length !== 1) {
      throw new C1ReadinessFailure(
        'CONTEXT_REPLACEMENT_FAILED',
        `T4 provider projection requires one canonical source per item: ${item.representationId}`
      )
    }
    const sourceKey = item.sourceKeys[0]
    if (sourceKey === undefined) {
      throw new C1ReadinessFailure(
        'CONTEXT_REPLACEMENT_FAILED',
        'T4 item has no canonical source key'
      )
    }
    for (const providerSourceKey of t4ProviderKeysForSource(sourceKey)) {
      items.push({
        ...item,
        position: items.length,
        sourceKeys: [providerSourceKey]
      })
    }
  }
  const workingSetId = t4ProviderWorkingSetId(input.workingSetId)
  const previousWorkingSetId =
    input.previousWorkingSetId === null ? null : t4ProviderWorkingSetId(input.previousWorkingSetId)
  const totalTokenEstimate = items.reduce((sum, item) => sum + item.tokenEstimate, 0)
  return {
    ...input,
    workingSetId,
    previousWorkingSetId,
    items: Object.freeze(items),
    totalTokenEstimate,
    logicalHash: computeWorkingSetLogicalHash({
      runtimeSessionId: input.runtimeSessionId,
      sequence: input.sequence,
      plannedFromUniverseSequence: input.plannedFromUniverseSequence,
      plannedFromUniverseHash: input.plannedFromUniverseHash,
      previousWorkingSetId,
      policyVersion: input.policyVersion,
      planningRequestHash: input.planningRequestHash,
      items
    })
  }
}

function projectT4Transition(input: {
  readonly transition: ContextTransition
  readonly workingSet: ContextWorkingSet
  readonly previousWorkingSet: ContextWorkingSet | null
}): ContextTransition {
  const toWorkingSetId = input.workingSet.workingSetId
  const fromWorkingSetId = input.previousWorkingSet?.workingSetId ?? null
  const orderedDecisions: ContextDecision[] = []
  for (const decision of input.transition.orderedDecisions) {
    for (const providerSourceKey of t4ProviderKeysForSource(decision.sourceKey)) {
      orderedDecisions.push({
        ...decision,
        decisionId: createDecisionId(input.transition.sequence, decision.kind, providerSourceKey, {
          sourceVersionId: decision.sourceVersionId,
          representationId: decision.representationId,
          toWorkingSetId,
          reasonCodes: decision.reasonCodes
        }),
        sourceKey: providerSourceKey,
        fromWorkingSetId,
        toWorkingSetId
      })
    }
  }
  const fromTokenEstimate = input.previousWorkingSet?.totalTokenEstimate ?? 0
  const toTokenEstimate = input.workingSet.totalTokenEstimate
  return {
    ...input.transition,
    transitionId: `transition:${toWorkingSetId}`,
    fromWorkingSetId,
    toWorkingSetId,
    orderedDecisions: Object.freeze(orderedDecisions),
    fromTokenEstimate,
    toTokenEstimate,
    logicalHash: computeTransitionLogicalHash({
      runtimeSessionId: input.workingSet.runtimeSessionId,
      sequence: input.workingSet.sequence,
      fromWorkingSetId,
      toWorkingSetId,
      orderedDecisions,
      fromTokenEstimate,
      toTokenEstimate,
      policyVersion: input.workingSet.policyVersion
    })
  }
}

function projectT4Plan(input: {
  readonly workingSet: ContextWorkingSet
  readonly transition: ContextTransition
  readonly previousWorkingSet: ContextWorkingSet | null
}): {
  readonly workingSet: ContextWorkingSet
  readonly transition: ContextTransition
} {
  const previousWorkingSet =
    input.previousWorkingSet === null ? null : projectT4WorkingSet(input.previousWorkingSet)
  const workingSet = projectT4WorkingSet(input.workingSet)
  if (workingSet.previousWorkingSetId !== (previousWorkingSet?.workingSetId ?? null)) {
    throw new C1ReadinessFailure(
      'CONTEXT_REPLACEMENT_FAILED',
      'T4 provider projection previous Working Set identity is inconsistent'
    )
  }
  return {
    workingSet,
    transition: projectT4Transition({
      transition: input.transition,
      workingSet,
      previousWorkingSet
    })
  }
}

function executeT4ProviderBoundArm(input: {
  readonly phase: 'COLD' | 'RESTORED'
  readonly plan: {
    readonly workingSet: ContextWorkingSet
    readonly transition: ContextTransition
  }
  readonly previousWorkingSet: ContextWorkingSet | null
  readonly materialized: MaterializedWorkingSet
  readonly capture: InMemoryReadinessCapture
}): T4ProviderBoundSnapshot {
  const projectedPlan = projectT4Plan({
    ...input.plan,
    previousWorkingSet: input.previousWorkingSet
  })
  const runId = input.phase === 'COLD' ? T4_COLD_RUN_ID : T4_RESTORED_RUN_ID
  const killSwitch = createRunKillSwitch(runId, { now: () => READINESS_NOW })
  const composition = composeActiveRewrite({
    messages: t4Messages(),
    workingSet: projectedPlan.workingSet,
    transition: projectedPlan.transition,
    runId,
    killSwitch,
    activeModeOptIn: true,
    systemInstruction: READINESS_SYSTEM,
    harness: 'PI'
  })
  if (composition.kind !== 'REWRITE_READY') {
    throw new C1ReadinessFailure(
      'CONTEXT_REPLACEMENT_FAILED',
      `T4 ${input.phase.toLowerCase()} composition failed: ${composition.reason}`
    )
  }
  const guard = assertRewriteSafe(composition, killSwitch)
  if (!guard.ok) {
    throw new C1ReadinessFailure(
      'CONTEXT_REPLACEMENT_FAILED',
      `T4 ${input.phase.toLowerCase()} pre-send guard failed: ${guard.reason}`
    )
  }
  const providerSourceKeys = sourceKeysInMessages(composition.messages)
  const expectedProviderSourceKeys = input.materialized.sourceKeys
    .flatMap((sourceKey) => t4ProviderKeysForSource(sourceKey))
    .sort()
  if (!sameValue(providerSourceKeys, expectedProviderSourceKeys)) {
    throw new C1ReadinessFailure(
      'CONTEXT_REPLACEMENT_FAILED',
      `T4 ${input.phase.toLowerCase()} provider sources ${providerSourceKeys.join(',')} do not match materialized sources ${expectedProviderSourceKeys.join(',')}`
    )
  }
  const request = buildProviderBoundRequest({
    arm: 'RUNTIME',
    runId,
    plan: projectedPlan,
    materializedWorkingSetFingerprint: input.materialized.fingerprint,
    messages: composition.messages,
    taskId: T4_TASK_ID,
    pairId: T4_PAIR_ID,
    turnId: `t4-${input.phase.toLowerCase()}`,
    modelCallId: `t4-${input.phase.toLowerCase()}-model-call`
  })
  input.capture.capture(request)
  return {
    phase: input.phase,
    request,
    materialized: input.materialized,
    providerSourceKeys
  }
}

function runT4LifecycleProbe(): T4LifecycleProbeResult {
  const context = createPlanningContext(t4SourceFixtures())
  const initial = planFromContext(
    context,
    planningRequest({
      sequence: 0,
      currentTargetSourceKeys: [T4_EVALUATE_KEY, T4_CACHE_KEY],
      previousWorkingSetId: null
    }),
    null
  )
  const wrongPath = planFromContext(
    context,
    planningRequest({
      sequence: 1,
      currentTargetSourceKeys: [T4_CACHE_KEY],
      excludedSourceKeys: [T4_EVALUATE_KEY],
      previousWorkingSetId: initial.workingSet.workingSetId,
      sourceLifecycleSignals: [
        {
          sourceKey: T4_EVALUATE_KEY,
          kind: 'RULED_OUT',
          evidenceRef: 'c1-c:t4:wrong-path-triage'
        }
      ]
    }),
    initial.workingSet
  )
  const remove = wrongPath.transition.orderedDecisions.find(
    (decision) => decision.sourceKey === T4_EVALUATE_KEY && decision.kind === 'REMOVE'
  )
  if (remove === undefined) {
    const observed = 'originating REMOVE missing'
    return {
      lifecyclePass: false,
      pass: false,
      checks: [
        {
          checkId: 't4_cold_provider_bound_excludes_evaluate',
          pass: false,
          observed
        },
        {
          checkId: 't4_rehydrated_provider_bound_restores_evaluate',
          pass: false,
          observed
        }
      ],
      observed
    }
  }
  const removalHistory: RemovalRecord[] = [
    {
      sourceKey: T4_EVALUATE_KEY,
      originalRemovalReasonCodes: remove.reasonCodes,
      removedAtSequence: wrongPath.transition.sequence,
      removedFromWorkingSetId: initial.workingSet.workingSetId
    }
  ]
  const recovery = planFromContext(
    context,
    planningRequest({
      sequence: 2,
      currentTargetSourceKeys: [T4_EVALUATE_KEY, T4_CACHE_KEY],
      previousWorkingSetId: wrongPath.workingSet.workingSetId,
      removalHistory,
      sourceLifecycleSignals: [
        {
          sourceKey: T4_EVALUATE_KEY,
          kind: 'DETAIL_REQUIRED',
          evidenceRef: 'c1-c:t4:recovery-detail-needed'
        }
      ]
    }),
    wrongPath.workingSet
  )
  const cold = materializeWorkingSet({
    workingSet: wrongPath.workingSet,
    universe: context.universe,
    representationsById: context.representationsById
  })
  const restored = materializeWorkingSet({
    workingSet: recovery.workingSet,
    universe: context.universe,
    representationsById: context.representationsById
  })
  const providerCapture = new InMemoryReadinessCapture()
  const coldProvider = executeT4ProviderBoundArm({
    phase: 'COLD',
    plan: wrongPath,
    previousWorkingSet: initial.workingSet,
    materialized: cold,
    capture: providerCapture
  })
  const restoredProvider = executeT4ProviderBoundArm({
    phase: 'RESTORED',
    plan: recovery,
    previousWorkingSet: wrongPath.workingSet,
    materialized: restored,
    capture: providerCapture
  })
  const evaluateInitialEntry = initial.workingSet.items.find((item) =>
    item.sourceKeys.includes(T4_EVALUATE_KEY)
  )
  const rehydrate = recovery.transition.orderedDecisions.find(
    (decision) => decision.sourceKey === T4_EVALUATE_KEY
  )
  const evaluateVersion = context.universe.entries.find(
    (entry) => entry.source.sourceKey === T4_EVALUATE_KEY
  )?.admittedVersion?.versionId
  const restoredEntry = restored.entries.find((entry) => entry.sourceKey === T4_EVALUATE_KEY)
  const coldExpectedProviderKeys = cold.sourceKeys
    .flatMap((sourceKey) => t4ProviderKeysForSource(sourceKey))
    .sort()
  const restoredExpectedProviderKeys = restored.sourceKeys
    .flatMap((sourceKey) => t4ProviderKeysForSource(sourceKey))
    .sort()
  const evaluateProviderKeys = new Set(T4_EVALUATE_PROVIDER_KEYS)
  const coldProviderBoundPass =
    providerCapture.requests.length === 2 &&
    coldProvider.request.captureStage === 'PRE_NETWORK_FAKE_CAPTURE' &&
    coldProvider.request.materializedWorkingSetFingerprint === cold.fingerprint &&
    sameValue(coldProvider.providerSourceKeys, coldExpectedProviderKeys) &&
    !coldProvider.providerSourceKeys.some((sourceKey) => evaluateProviderKeys.has(sourceKey))
  const restoredProviderBoundPass =
    providerCapture.requests.length === 2 &&
    restoredProvider.request.captureStage === 'PRE_NETWORK_FAKE_CAPTURE' &&
    restoredProvider.request.materializedWorkingSetFingerprint === restored.fingerprint &&
    sameValue(restoredProvider.providerSourceKeys, restoredExpectedProviderKeys) &&
    T4_EVALUATE_PROVIDER_KEYS.every((sourceKey) =>
      restoredProvider.providerSourceKeys.includes(sourceKey)
    ) &&
    restoredProvider.request.modelVisibleContextFingerprint !==
      coldProvider.request.modelVisibleContextFingerprint
  const lifecyclePass =
    initial.transition.orderedDecisions.some(
      (decision) => decision.sourceKey === T4_EVALUATE_KEY && decision.kind === 'ADD'
    ) &&
    remove.kind === 'REMOVE' &&
    remove.reasonCodes.includes('RULED_OUT') &&
    !cold.sourceKeys.includes(T4_EVALUATE_KEY) &&
    rehydrate?.kind === 'REHYDRATE' &&
    rehydrate.reasonCodes.includes('REHYDRATION_TRIGGERED') &&
    rehydrate.reasonCodes.includes('DETAIL_REQUIRED') &&
    rehydrate.fromWorkingSetId === initial.workingSet.workingSetId &&
    rehydrate.sourceVersionId === evaluateVersion &&
    restoredEntry?.sourceVersionId === evaluateVersion &&
    restoredEntry.representationId === evaluateInitialEntry?.representationId &&
    restored.sourceKeys.includes(T4_EVALUATE_KEY) &&
    cold.fingerprint !== restored.fingerprint
  const pass = lifecyclePass && coldProviderBoundPass && restoredProviderBoundPass
  const checks: T4LifecycleProbeCheck[] = [
    {
      checkId: 't4_cold_provider_bound_excludes_evaluate',
      pass: coldProviderBoundPass,
      observed: [
        `captured=${providerCapture.requests.length}`,
        `sources=${coldProvider.providerSourceKeys.join(',')}`,
        `evaluate_present=${String(coldProvider.providerSourceKeys.some((sourceKey) => evaluateProviderKeys.has(sourceKey)))}`,
        `materialized_match=${String(coldProvider.request.materializedWorkingSetFingerprint === cold.fingerprint)}`
      ].join('; ')
    },
    {
      checkId: 't4_rehydrated_provider_bound_restores_evaluate',
      pass: restoredProviderBoundPass,
      observed: [
        `captured=${providerCapture.requests.length}`,
        `sources=${restoredProvider.providerSourceKeys.join(',')}`,
        `evaluate_present=${String(T4_EVALUATE_PROVIDER_KEYS.every((sourceKey) => restoredProvider.providerSourceKeys.includes(sourceKey)))}`,
        `materialized_match=${String(restoredProvider.request.materializedWorkingSetFingerprint === restored.fingerprint)}`,
        `semantic_changed=${String(restoredProvider.request.modelVisibleContextFingerprint !== coldProvider.request.modelVisibleContextFingerprint)}`
      ].join('; ')
    }
  ]
  return {
    lifecyclePass,
    pass,
    checks: Object.freeze(checks),
    observed: [
      `ADD=${String(initial.transition.orderedDecisions.some((decision) => decision.sourceKey === T4_EVALUATE_KEY && decision.kind === 'ADD'))}`,
      `REMOVE=${remove.sourceKey}:${remove.reasonCodes.join(',')}`,
      `cold_selected=${cold.sourceKeys.join(',')}`,
      `REHYDRATE=${rehydrate?.kind ?? 'missing'}`,
      `restored_version=${restoredEntry?.sourceVersionId ?? 'missing'}`,
      `exact_version=${String(restoredEntry?.sourceVersionId === evaluateVersion)}`,
      `cold_provider_bound=${coldProvider.providerSourceKeys.join(',')}`,
      `restored_provider_bound=${restoredProvider.providerSourceKeys.join(',')}`,
      `provider_capture_count=${providerCapture.requests.length}`
    ].join('; ')
  }
}

function buildReadinessGates(): readonly C1ReadinessGate[] {
  const fixture = buildMainPlanningFixture()
  const capture = new InMemoryReadinessCapture()
  const nativeMaterialized = materializeWorkingSet({
    workingSet: fixture.initial.workingSet,
    universe: fixture.universe,
    representationsById: fixture.representationsById
  })
  const nativeBaseline = buildProviderBoundRequest({
    arm: 'NATIVE',
    runId: READINESS_NATIVE_RUN_ID,
    plan: nativeReferencePlan(fixture),
    materializedWorkingSetFingerprint: nativeMaterialized.fingerprint,
    messages: nativeMessages()
  })
  const native = executeNativeArm(fixture, capture)
  const runtime = executeRuntimeArm({ fixture, capture })
  const nativeSemanticFingerprint = native.modelVisibleContextFingerprint
  const runtimeSuccess = runtime.status === 'PASS'
  const runtimeRequest = runtimeSuccess ? runtime.request : undefined
  const runtimeComposition = runtimeSuccess ? runtime.composition : undefined
  const runtimeMaterialized = runtimeSuccess ? runtime.materialized : undefined

  const nativeFidelityChecks = [
    check(
      'native_observer_request_fingerprint_unchanged',
      nativeBaseline.requestFingerprint === native.requestFingerprint,
      `${nativeBaseline.requestFingerprint} -> ${native.requestFingerprint}`
    ),
    check(
      'native_message_count_role_order_semantics_unchanged',
      native.payload.messages.length === 5 &&
        native.payload.messages.map((message) => message.role).join('>') ===
          'user>assistant>toolResult>assistant>toolResult',
      `${native.payload.messages.length}:${native.payload.messages.map((message) => message.role).join('>')}`
    ),
    check(
      'native_fixed_provider_structure_unchanged',
      sameValue(
        fixedProviderProjection(nativeBaseline.payload, nativeBaseline.semanticRegion.start),
        fixedProviderProjection(native.payload, native.semanticRegion.start)
      ),
      'system/developer/tools/provider-native metadata preserved'
    )
  ]

  const selectedMaterializedKeys = runtimeMaterialized?.sourceKeys ?? []
  const selectedProviderKeys = runtimeSuccess
    ? sourceKeysInMessages(runtimeRequest?.payload.messages ?? [])
    : []
  const runtimeTreatmentChecks = [
    check('runtime_composition_ready', runtimeSuccess, runtime?.status ?? 'missing'),
    check(
      'working_set_materialized_before_provider_capture',
      runtimeSuccess && selectedMaterializedKeys.join('|') === TARGET_KEYS.join('|'),
      selectedMaterializedKeys.join('|')
    ),
    check(
      'provider_bound_sources_match_materialized_working_set',
      runtimeSuccess && sameValue(selectedProviderKeys, selectedMaterializedKeys),
      selectedProviderKeys.join('|')
    ),
    check(
      'provider_capture_binds_materialized_working_set',
      runtimeSuccess &&
        runtimeRequest!.materializedWorkingSetFingerprint === runtimeMaterialized!.fingerprint,
      runtimeSuccess ? runtimeRequest!.materializedWorkingSetFingerprint : 'missing'
    ),
    check(
      'both_arms_share_fixture_evaluator_and_budget',
      runtimeSuccess &&
        runtimeRequest!.fixtureId === native.fixtureId &&
        runtimeRequest!.fixtureHash === native.fixtureHash &&
        runtimeRequest!.evaluatorId === native.evaluatorId &&
        sameValue(runtimeRequest!.executionBudget, native.executionBudget),
      runtimeSuccess
        ? `${runtimeRequest!.fixtureId}:${runtimeRequest!.evaluatorId}:${runtimeRequest!.executionBudget.maxProviderCalls}`
        : 'runtime terminal failure'
    ),
    check(
      'runtime_semantic_fingerprint_differs_from_native',
      runtimeSuccess &&
        runtimeRequest?.modelVisibleContextFingerprint !== nativeSemanticFingerprint,
      `${nativeSemanticFingerprint} -> ${runtimeRequest?.modelVisibleContextFingerprint ?? 'missing'}`
    ),
    check(
      'runtime_transition_contains_distractor_remove',
      runtimeSuccess &&
        fixture.runtime.transition.orderedDecisions.filter((decision) => decision.kind === 'REMOVE')
          .length === 2 &&
        fixture.runtime.transition.orderedDecisions
          .filter((decision) => decision.kind === 'REMOVE')
          .every((decision) => DISTRACTOR_KEYS.includes(decision.sourceKey)),
      fixture.runtime.transition.orderedDecisions
        .map((decision) => `${decision.kind}:${decision.sourceKey}`)
        .join('|')
    )
  ]

  const structuralChecks = [
    check(
      'fixed_structure_diff_only_in_semantic_region',
      runtimeSuccess &&
        sameValue(
          fixedProviderProjection(native.payload, native.semanticRegion.start),
          fixedProviderProjection(runtimeRequest!.payload, runtimeRequest!.semanticRegion.start)
        ),
      'prefix/system/developer/tools/provider-native projection equal'
    ),
    check(
      'system_instruction_byte_identical',
      runtimeComposition?.continuity.systemInstructionByteIdentical === true &&
        runtimeRequest?.payload.systemInstruction === native.payload.systemInstruction,
      String(runtimeComposition?.continuity.systemInstructionByteIdentical ?? false)
    ),
    check(
      'tool_protocol_and_retained_pair_intact',
      runtimeComposition?.continuity.toolPairsIntact === true &&
        toolPairIds(runtimeRequest?.payload.messages ?? []).join('|') === TARGET_CALL_ID,
      toolPairIds(runtimeRequest?.payload.messages ?? []).join('|')
    ),
    check(
      'opaque_content_preserved',
      runtimeComposition?.continuity.opaqueItemsPreservedVerbatim === true,
      String(runtimeComposition?.continuity.opaqueItemsPreservedVerbatim ?? false)
    )
  ]

  const failureProbes = runFailureProbes()
  const silentFallbackChecks = failureProbes.map((probe) =>
    check(
      `failure_${probe.injection.toLowerCase()}_terminal_no_native_fallback`,
      probe.status === 'TERMINAL_FAILURE' &&
        probe.fallbackSent === false &&
        probe.capturedProviderBoundRequests === 0 &&
        probe.killSwitchTripped,
      `${probe.failureCode}:fallbackSent=${String(probe.fallbackSent)}:captured=${String(probe.capturedProviderBoundRequests)}`
    )
  )

  const budgetIdentity = runBudgetAndIdentityProbe()
  const budgetChecks = [
    check(
      'fake_transport_24_allowed_25th_blocked_both_arms',
      budgetIdentity.budgetPass,
      budgetIdentity.budgetObserved
    ),
    check(
      'single_use_checkpoint_kill_switch_finalization',
      budgetIdentity.identityPass,
      budgetIdentity.identityObserved
    )
  ]
  const t4 = runT4LifecycleProbe()
  const evidenceChecks = [
    check(
      'native_evidence_join_complete',
      evidenceJoinPass(native, fixture.initial),
      `${native.runId}:${native.workingSetId}:${native.modelVisibleContextFingerprint}`
    ),
    check(
      'runtime_evidence_join_complete',
      runtimeSuccess && evidenceJoinPass(runtimeRequest!, fixture.runtime),
      runtimeSuccess
        ? `${runtimeRequest!.runId}:${runtimeRequest!.workingSetId}:${runtimeRequest!.modelVisibleContextFingerprint}`
        : 'runtime terminal failure'
    ),
    check(
      'usage_not_observed_in_readiness',
      capture.requests.length === 2,
      `captured=${capture.requests.length};providerCalls=0`
    )
  ]

  return [
    gate('nativeFidelity', nativeFidelityChecks),
    gate('runtimeTreatmentActive', runtimeTreatmentChecks),
    gate('structuralPreservation', structuralChecks),
    gate('silentFallback', silentFallbackChecks),
    gate('evidenceJoin', evidenceChecks),
    gate('budgetEnforcement', budgetChecks),
    gate('t4LifecycleChain', [
      check('t4_remove_rehydrate_exact_source_version', t4.lifecyclePass, t4.observed),
      ...t4.checks.map((item) => check(item.checkId, item.pass, item.observed))
    ])
  ]
}

export function runC1TreatmentFailureProbes(): readonly C1TreatmentFailureProbeResult[] {
  return runFailureProbes()
}

export function runC1TreatmentReadiness(): C1TreatmentReadinessReport {
  const gates = buildReadinessGates()
  const gateById = new Map(gates.map((item) => [item.gateId, item] as const))
  const requiredGate = (gateId: string): C1ReadinessGate => {
    const result = gateById.get(gateId)
    if (result === undefined) throw new Error(`readiness gate ${gateId} was not produced`)
    return result
  }
  const overallVerdict: C1ReadinessVerdict = gates.every((item) => item.verdict === 'PASS')
    ? 'PASS'
    : 'FAIL'
  return {
    readinessId: C1_C_READINESS_ID,
    schemaVersion: 1,
    status: overallVerdict,
    overallVerdict,
    executionMode: 'CREDENTIAL_FREE_NO_NETWORK',
    provider: READINESS_PROVIDER,
    model: READINESS_MODEL,
    endpoint: READINESS_ENDPOINT,
    providerCalls: 0,
    usage: {
      status: 'NOT_OBSERVED_IN_READINESS',
      providerCalls: 0,
      providerReportedTokens: 'NOT_APPLICABLE',
      cost: 'NOT_APPLICABLE'
    },
    contractBinding: {
      contractId: 'C1_RUN_CONTRACT_V1',
      contractSha256: C1_C_CONTRACT_SHA256,
      assignmentMatrixSha256: C1_C_ASSIGNMENT_MATRIX_SHA256,
      taskManifestSha256: C1_C_TASK_MANIFEST_SHA256,
      parentRevision: C1_C_PARENT_REVISION,
      treatmentRevision: C1_C_TREATMENT_REVISION
    },
    requiredGates: C1_C_REQUIRED_GATES,
    nativeFidelity: requiredGate('nativeFidelity'),
    runtimeTreatmentActive: requiredGate('runtimeTreatmentActive'),
    structuralPreservation: requiredGate('structuralPreservation'),
    silentFallback: requiredGate('silentFallback'),
    evidenceJoin: requiredGate('evidenceJoin'),
    budgetEnforcement: requiredGate('budgetEnforcement'),
    t4LifecycleChain: requiredGate('t4LifecycleChain')
  }
}
