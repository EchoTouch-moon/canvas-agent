import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, stat } from 'node:fs/promises'
import { dirname, join, isAbsolute, resolve, sep } from 'node:path'
import {
  createRunKillSwitch,
  type RunKillSwitch
} from '@canvas-agent/pi-context-integration/experimental'
import {
  C1_C_ASSIGNMENT_MATRIX_SHA256,
  C1_C_CONTRACT_SHA256,
  C1_C_TASK_MANIFEST_SHA256,
  C1_C_TREATMENT_REVISION,
  runC1TreatmentReadiness
} from './c1-treatment-readiness'
import {
  C1_CONTRACT_RELATIVE_PATH,
  C1_MANIFEST_RELATIVE_PATH,
  C1_MODEL_ID,
  C1_NODE_RANGE,
  C1_PREFLIGHT_ARTIFACT_NAMES,
  C1_PROTOCOL_ID,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  C1_READINESS_RELATIVE_PATH,
  C1_RUN_CONTRACT_ID,
  C1PreflightFailure,
  C1HardBudgetGuard,
  assertC1AssignmentMatrixBinding,
  assertC1StrictProviderBinding,
  buildC1PreflightLegPlan,
  claimSingleUseC1LegDir,
  claimSingleUseC1StudyDir,
  computeC1FixtureContentSummary,
  createC1ObservedReadTrace,
  createC1PreflightIdentity,
  installC1OperatorKillSwitch,
  loadC1FrozenStudy,
  materializeFreshC1Fixture,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  type C1AgentObservation,
  type C1FrozenStudy,
  type C1LegExecutionResult,
  type C1OperatorKillSwitch,
  type C1PreflightLegPlan,
  type C1PreflightTask,
  type C1SignalSource,
  type C1StrictProviderBinding,
  changedC1FixturePaths,
  snapshotC1Fixture,
  verifyC1FixtureBinding,
  writableScopePass,
  writeIndependentC1Artifacts
} from './c1-live-preflight'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  type C1LiveBindingEvidence,
  type C1LiveBindingLegResult,
  type C1LiveModelResponse,
  type C1LiveObservationSource,
  type C1LiveResponseSource,
  type C1LiveResponseSourceKind,
  type C1LiveToolExecutor
} from './c1-live-binding'

/**
 * Study-level orchestration for the frozen C1 64-leg contract. The
 * C1StudyOrchestrator owns the shared study/leg lifecycle and receives the
 * response, observation, and tool paths as factories; the exported dry-run
 * wrapper supplies scripted, credential-free implementations for readiness.
 */
export const C1_LIVE_STUDY_DRY_RUN_ID = 'C1_LIVE_STUDY_DRY_RUN_V1'
export const C1_LIVE_STUDY_DRY_RUN_MODE = 'CREDENTIAL_FREE_STUDY_DRY_RUN'

export type C1StudyDryRunStatus = 'PASS' | 'FAIL'

export interface C1StudyDryRunOptions {
  readonly repoRoot?: string
  readonly outputRoot?: string
  readonly studyId?: string
  readonly now?: Date
  readonly signalSource?: C1SignalSource
  /** Test-only adversarial hook; it never enables a provider. */
  readonly beforeLeg?: (plan: C1PreflightLegPlan) => void | Promise<void>
}

export interface C1StudyLegFactoryInput {
  readonly study: C1FrozenStudy
  readonly studyId: string
  readonly plan: C1PreflightLegPlan
  readonly task: C1PreflightTask
  readonly fixtureRoot: string
  readonly legDir: string
  readonly killSwitch: RunKillSwitch
  /** Aborts a provider request when the study operator trips the stop switch. */
  readonly responseAbortSignal: AbortSignal
  readonly providerBinding: C1StrictProviderBinding
}

export type C1StudyResponseSourceFactory = (
  input: C1StudyLegFactoryInput
) => C1LiveResponseSource | Promise<C1LiveResponseSource>

export type C1StudyObservationSourceFactory = (
  input: C1StudyLegFactoryInput
) => C1LiveObservationSource | Promise<C1LiveObservationSource>

export type C1StudyToolExecutorFactory = (
  input: C1StudyLegFactoryInput
) => C1LiveToolExecutor | Promise<C1LiveToolExecutor>

export interface C1StudyOrchestratorOptions extends C1StudyDryRunOptions {
  readonly runId: string
  readonly executionMode: string
  readonly responseSourceKind: C1LiveResponseSourceKind
  readonly dryRun: boolean
  /** Maximum provider turns per leg; live defaults to the frozen 24-turn ceiling. */
  readonly maxCalls?: number
  readonly responseSourceFactory: C1StudyResponseSourceFactory
  readonly observationSourceFactory: C1StudyObservationSourceFactory
  readonly toolExecutorFactory: C1StudyToolExecutorFactory
  readonly providerCalls?: () => number
  readonly networkRequests?: () => number
  readonly expectedProviderCallPermits?: number
  readonly expectedResponseCalls?: number
  readonly expectedToolExecutions?: number
  readonly requireRuntimeDifferenceForCall?: (
    plan: C1PreflightLegPlan,
    callOrdinal: number
  ) => boolean
}

export interface C1StudyDryRunGate {
  readonly gateId: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly observed: string
}

export interface C1StudyDryRunLegSummary {
  readonly legIndex: number
  readonly taskId: string
  readonly stratum: string
  readonly pairId: string
  readonly pairOrdinal: number
  readonly order: string
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly runId: string
  readonly status: 'COMPLETED'
  readonly calls: number
  readonly toolCalls: number
  readonly finalModelOutcome: string
  readonly transitionDecisionKinds: readonly (readonly string[])[]
  readonly fixtureHashVerified: true
  readonly changedPaths: readonly string[]
  readonly writableScopePass: true
  readonly fixtureCleaned: true
  readonly fixtureChangedByDryRunTool: true
  readonly sandboxReused: false
}

export interface C1StudyLegSummary extends Omit<
  C1StudyDryRunLegSummary,
  'fixtureChangedByDryRunTool'
> {
  readonly fixtureChangedByTool: boolean
}

export interface C1StudyDryRunArtifactSummary {
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

export interface C1StudyDryRunReport {
  readonly runId: typeof C1_LIVE_STUDY_DRY_RUN_ID
  readonly executionMode: typeof C1_LIVE_STUDY_DRY_RUN_MODE
  readonly status: C1StudyDryRunStatus
  readonly nodeVersion: string
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly providerConfigHash: string | null
  readonly studyId: string | null
  readonly reportDir: string | null
  readonly contractSha256: typeof C1_C_CONTRACT_SHA256
  readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
  readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
  readonly treatmentRevision: typeof C1_C_TREATMENT_REVISION
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly fakeProviderCallPermits: number
  readonly fakeResponseCalls: number
  readonly toolExecutions: number
  readonly driverInstances: 1 | 0
  readonly fixtureSandboxesCreated: number
  readonly fixtureSandboxesCleaned: number
  readonly legsAttempted: number
  readonly legsCompleted: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly operatorSignal: 'SIGINT' | 'SIGTERM' | null
  readonly gates: readonly C1StudyDryRunGate[]
  readonly legs: readonly C1StudyDryRunLegSummary[]
  readonly artifacts: readonly C1StudyDryRunArtifactSummary[]
  readonly failures: readonly {
    readonly code: string
    readonly message: string
  }[]
}

export interface C1StudyOrchestrationReport {
  readonly runId: string
  readonly status: C1StudyDryRunStatus
  readonly executionMode: string
  readonly responseSourceKind: C1LiveResponseSourceKind
  readonly nodeVersion: string
  readonly provider: typeof C1_PROVIDER_ID
  readonly model: typeof C1_MODEL_ID
  readonly endpoint: typeof C1_PROVIDER_ENDPOINT
  readonly providerConfigHash: string | null
  readonly studyId: string | null
  readonly reportDir: string | null
  readonly contractSha256: typeof C1_C_CONTRACT_SHA256
  readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
  readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
  readonly treatmentRevision: typeof C1_C_TREATMENT_REVISION
  readonly providerCalls: number
  readonly networkRequests: number
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly driverInstances: 1 | 0
  readonly fixtureSandboxesCreated: number
  readonly fixtureSandboxesCleaned: number
  readonly legsAttempted: number
  readonly legsCompleted: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
  readonly operatorSignal: 'SIGINT' | 'SIGTERM' | null
  readonly gates: readonly C1StudyDryRunGate[]
  readonly legs: readonly C1StudyLegSummary[]
  readonly artifacts: readonly C1StudyDryRunArtifactSummary[]
  readonly failures: readonly { readonly code: string; readonly message: string }[]
}

interface CompletedLeg {
  readonly plan: C1PreflightLegPlan
  readonly task: C1PreflightTask
  readonly result: C1LiveBindingLegResult
  readonly fixtureHashVerified: true
  readonly changedPaths: readonly string[]
  readonly writableScopePass: true
  readonly fixtureCleaned: true
  readonly fixtureChangedByTool: boolean
  readonly legDir: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function gate(gateId: string, pass: boolean, observed: string): C1StudyDryRunGate {
  return { gateId, verdict: pass ? 'PASS' : 'FAIL', observed }
}

function failureOf(error: unknown): {
  readonly code: string
  readonly message: string
} {
  if (error instanceof C1PreflightFailure) return { code: error.code, message: error.message }
  return {
    code: 'PREFLIGHT_FAILURE',
    message: error instanceof Error ? error.message : String(error)
  }
}

function safeFixturePath(root: string, value: string): string {
  if (isAbsolute(value)) {
    throw new C1PreflightFailure('FIXTURE_BINDING_MISMATCH', 'dry-run tool path must be relative')
  }
  const absolute = resolve(root, value)
  if (absolute !== resolve(root) && !absolute.startsWith(`${resolve(root)}${sep}`)) {
    throw new C1PreflightFailure('FIXTURE_BINDING_MISMATCH', 'dry-run tool path escapes fixture')
  }
  return absolute
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

/**
 * The dry-run trajectory source only forwards observations produced by the
 * real sandbox tool executor. Lifecycle mutation is intentionally not part of
 * the 64-leg study orchestration; the independent C1 lifecycle canary owns
 * REMOVE/REHYDRATE injection and adjudication.
 */
class C1DryRunObservationSource implements C1LiveObservationSource {
  readonly initialObservation: C1AgentObservation

  constructor(task: C1PreflightTask, runId: string, fixtureFiles: readonly string[]) {
    this.initialObservation = createC1ObservedReadTrace({
      observationId: `${runId}-initial`,
      prompt: task.prompt,
      fixtureFiles,
      taskPhase: 'INVESTIGATE'
    })
  }

  next(input: {
    readonly callOrdinal: number
    readonly previousObservation: C1AgentObservation
    readonly previousExecution: C1LegExecutionResult
    readonly response: C1LiveModelResponse
    readonly toolObservation?: C1AgentObservation
  }): C1AgentObservation {
    const toolObservation = input.toolObservation
    if (toolObservation === undefined) {
      throw new C1PreflightFailure(
        'PREFLIGHT_FAILURE',
        `dry-run observation ${input.callOrdinal} did not receive a tool observation`
      )
    }
    return toolObservation
  }
}

function dryRunResponses(input: {
  readonly runId: string
  readonly editPath: string
  readonly originalContent: string
}): readonly C1LiveModelResponse[] {
  const changedContent = `${input.originalContent}\n// c1 study dry-run edit ${input.runId}\n`
  return [
    {
      responseId: `${input.runId}-response-01`,
      assistantMessageCount: 1,
      assistantContent: 'I will inspect the selected source before making the synthetic edit.',
      usage: {
        inputTokens: 100,
        outputTokens: 12,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 112,
        usageSource: 'SCRIPTED_FAKE'
      },
      toolRequests: [
        {
          toolCallId: `${input.runId}-read-01`,
          toolName: 'read',
          argumentsJson: JSON.stringify({ path: input.editPath })
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: `${input.runId}-response-02`,
      assistantMessageCount: 1,
      assistantContent: 'The source is available; I will apply the bounded synthetic edit.',
      usage: {
        inputTokens: 120,
        outputTokens: 14,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 134,
        usageSource: 'SCRIPTED_FAKE'
      },
      toolRequests: [
        {
          toolCallId: `${input.runId}-edit-02`,
          toolName: 'edit',
          argumentsJson: JSON.stringify({
            path: input.editPath,
            oldText: input.originalContent,
            newText: changedContent
          })
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: `${input.runId}-response-03`,
      assistantMessageCount: 1,
      assistantContent: 'The synthetic edit is complete; I will verify the sandbox runtime.',
      usage: {
        inputTokens: 140,
        outputTokens: 16,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 156,
        usageSource: 'SCRIPTED_FAKE'
      },
      toolRequests: [
        {
          toolCallId: `${input.runId}-bash-03`,
          toolName: 'bash',
          argumentsJson: JSON.stringify({ command: 'node --version' })
        }
      ],
      toolExecutions: [],
      outcome: 'COMPLETE'
    }
  ]
}

async function writeDurableFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'w')
  try {
    await handle.write(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function metadataEvidence(row: C1LiveBindingEvidence): Record<string, unknown> {
  return {
    studyId: row.studyId,
    taskId: row.taskId,
    stratum: row.stratum,
    pairId: row.pairId,
    arm: row.arm,
    runId: row.runId,
    callOrdinal: row.callOrdinal,
    turnId: row.turnId,
    modelCallId: row.modelCallId,
    responseId: row.responseId,
    responseSource: row.responseSource,
    assistantMessages: row.assistantMessages,
    usage: row.usage,
    toolCalls: row.toolCalls,
    toolRequestEvidence: row.toolRequestEvidence,
    toolEvents: row.toolEvents,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    providerConfigHash: row.providerConfigHash,
    contextStrategy: row.contextStrategy,
    providerBoundSourceKeys: row.providerBoundSourceKeys,
    modelVisibleSemanticContextFingerprint: row.modelVisibleSemanticContextFingerprint,
    systemDeveloperToolStructuresFingerprint: row.systemDeveloperToolStructuresFingerprint,
    workingSetId: row.workingSetId,
    transitionId: row.transitionId,
    transitionDecisionKinds: row.transitionDecisionKinds,
    lifecycleEligible: row.lifecycleEligible,
    runtimeContextChanged: row.runtimeContextChanged,
    fallbackSent: row.fallbackSent,
    networkSent: row.networkSent,
    replayMismatch: row.replayMismatch
  }
}

function serializedStudyArtifacts(input: {
  readonly study: C1FrozenStudy
  readonly runId: string
  readonly executionMode: string
  readonly responseSourceKind: C1LiveResponseSourceKind
  readonly dryRun: boolean
  readonly studyId: string
  readonly completed: readonly CompletedLeg[]
  readonly gates: readonly C1StudyDryRunGate[]
  readonly failures: readonly {
    readonly code: string
    readonly message: string
  }[]
  readonly status: C1StudyDryRunStatus
  readonly providerCallPermits: number
  readonly responseCalls: number
  readonly toolExecutions: number
  readonly providerCalls: number
  readonly networkRequests: number
  readonly legsAttempted: number
  readonly studyTerminal: boolean
  readonly terminalReason: string | null
}): readonly { readonly name: string; readonly content: string }[] {
  const evidence = input.completed.flatMap((leg) => leg.result.evidence)
  const manifest = {
    runId: input.runId,
    executionMode: input.executionMode,
    status: input.status,
    dryRun: input.dryRun,
    nodeVersion: process.versions.node,
    protocol: C1_PROTOCOL_ID,
    contractId: C1_RUN_CONTRACT_ID,
    contractPath: C1_CONTRACT_RELATIVE_PATH,
    manifestPath: C1_MANIFEST_RELATIVE_PATH,
    readinessPath: C1_READINESS_RELATIVE_PATH,
    provider: input.study.provider,
    model: input.study.model,
    endpoint: input.study.endpoint,
    responseSource: input.responseSourceKind,
    providerCalls: input.providerCalls,
    networkRequests: input.networkRequests,
    providerCallPermits: input.providerCallPermits,
    responseCalls: input.responseCalls,
    toolExecutions: input.toolExecutions,
    studyId: input.studyId,
    contractSha256: input.study.contractSha256,
    assignmentMatrixSha256: input.study.assignmentMatrixSha256,
    taskManifestSha256: input.study.taskManifestSha256,
    treatmentRevision: C1_C_TREATMENT_REVISION,
    plannedLegs: input.study.studyBudgets.maxLegs,
    attemptedLegs: input.legsAttempted,
    completedLegs: input.completed.length,
    studyTerminal: input.studyTerminal,
    terminalReason: input.terminalReason,
    requiredArtifacts: [...C1_PREFLIGHT_ARTIFACT_NAMES],
    stableJoinKeys: [
      'studyId',
      'taskId',
      'stratum',
      'pairId',
      'arm',
      'runId',
      'callOrdinal',
      'turnId',
      'modelCallId'
    ],
    gates: input.gates,
    failures: input.failures.map((failure) => ({ code: failure.code }))
  }
  const usageRows = evidence.map((row) => ({
    ...metadataEvidence(row),
    providerCalls: input.providerCalls,
    usageStatus:
      row.usage.usageSource === 'PROVIDER_REPORTED'
        ? 'COMPLETE'
        : input.dryRun
          ? 'NOT_OBSERVED_IN_DRY_RUN'
          : 'INCOMPLETE',
    usageSource: row.usage.usageSource
  }))
  const transitionRows = evidence.map((row) => ({
    ...metadataEvidence(row),
    lifecycleEvidence: input.dryRun ? 'SCRIPTED_DRY_RUN' : 'PROVIDER_BACKED_AGENT_RUN',
    decisionKinds: row.transitionDecisionKinds
  }))
  const decisionRows = evidence.map((row) => ({
    ...metadataEvidence(row),
    decisionKinds: row.transitionDecisionKinds,
    contextFingerprint: row.modelVisibleSemanticContextFingerprint
  }))
  const toolRows = evidence.map((row) => ({
    ...metadataEvidence(row),
    toolRequestCount: row.toolRequestEvidence.length,
    toolExecutionCount: row.toolEvents.length,
    latencyStatus: input.dryRun ? 'NOT_OBSERVED_IN_DRY_RUN' : 'OBSERVED_IN_RUN'
  }))
  const outcomeRows = input.completed.flatMap((leg) =>
    leg.result.evidence.map((row) => ({
      ...metadataEvidence(row),
      taskOutcome: input.dryRun ? 'NOT_OBSERVED_IN_DRY_RUN' : row.taskOutcome,
      ...(input.dryRun ? { syntheticModelOutcome: row.taskOutcome } : {}),
      freshSandbox: true,
      sandboxReused: false,
      fixtureContentSha256: leg.task.fixtureRevision.fixtureContentSha256,
      fixtureTreeObjectId: leg.task.fixtureRevision.fixtureTreeObjectId,
      fixtureTreeObjectIdVerified: true,
      fixtureHashVerified: true,
      fixtureCleaned: true,
      changedPaths: leg.changedPaths,
      writableScopePass: leg.writableScopePass,
      fixtureChangedByTool: leg.fixtureChangedByTool,
      ...(input.dryRun ? { dryRunEditExecuted: true } : {})
    }))
  )
  const replayRows = evidence.map((row) => ({
    ...metadataEvidence(row),
    replayMismatch: row.replayMismatch,
    replayStatus: row.replayMismatch === 0 ? 'PASS' : 'FAIL'
  }))
  return [
    {
      name: 'provider-usage-ledger.jsonl',
      content: usageRows.map(jsonLine).join('')
    },
    {
      name: 'transition-evidence.jsonl',
      content: transitionRows.map(jsonLine).join('')
    },
    {
      name: 'decision-evidence.jsonl',
      content: decisionRows.map(jsonLine).join('')
    },
    {
      name: 'tool-latency-evidence.jsonl',
      content: toolRows.map(jsonLine).join('')
    },
    {
      name: 'outcome-evidence.jsonl',
      content: outcomeRows.map(jsonLine).join('')
    },
    {
      name: 'replay-evidence.jsonl',
      content: replayRows.map(jsonLine).join('')
    },
    {
      name: 'run-manifest.json',
      content: `${JSON.stringify(manifest, null, 2)}\n`
    }
  ]
}

function assertMetadataOnly(
  documents: readonly { readonly name: string; readonly content: string }[]
): void {
  for (const document of documents) {
    if (
      /providerBoundMessages|argumentsJson|assistantContent|rawProviderPayload|authorizationHeader|toolResultContent/.test(
        document.content
      )
    ) {
      throw new C1PreflightFailure(
        'EVIDENCE_WRITE_FAILURE',
        `study artifact ${document.name} contains raw provider/tool content`
      )
    }
  }
}

async function summarizeArtifacts(
  reportDir: string,
  names: readonly string[]
): Promise<readonly C1StudyDryRunArtifactSummary[]> {
  const summaries: C1StudyDryRunArtifactSummary[] = []
  for (const name of names) {
    const path = join(reportDir, name)
    const [content, info] = await Promise.all([readFile(path), stat(path)])
    summaries.push({
      name,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: info.size
    })
  }
  return summaries
}

async function writeStudyArtifacts(input: {
  readonly reportDir: string
  readonly documents: readonly {
    readonly name: string
    readonly content: string
  }[]
}): Promise<{
  readonly failed: readonly string[]
  readonly artifacts: readonly C1StudyDryRunArtifactSummary[]
}> {
  assertMetadataOnly(input.documents)
  const jsonlDocuments = input.documents.filter((document) => document.name !== 'run-manifest.json')
  const manifest = input.documents.find((document) => document.name === 'run-manifest.json')
  if (manifest === undefined) {
    throw new C1PreflightFailure('EVIDENCE_WRITE_FAILURE', 'study manifest document is missing')
  }
  const write = (path: string, content: string): Promise<void> => writeDurableFile(path, content)
  const jsonlResult = await writeIndependentC1Artifacts({
    reportDir: input.reportDir,
    documents: jsonlDocuments,
    write
  })
  const manifestResult = await writeIndependentC1Artifacts({
    reportDir: input.reportDir,
    documents: [manifest],
    write
  })
  const failed = [...jsonlResult.failed, ...manifestResult.failed]
  const written = input.documents
    .map((document) => document.name)
    .filter((name) => !failed.includes(name))
  const artifacts = written.length === 0 ? [] : await summarizeArtifacts(input.reportDir, written)
  return { failed, artifacts }
}

function extractDateToken(studyId: string): string {
  const match = /^c1-(\d{8})-/.exec(studyId)
  if (match === null) throw new C1PreflightFailure('IDENTITY_INVALID', 'study id has no date token')
  return match[1]!
}

function makeIdentity(options: C1StudyDryRunOptions) {
  if (options.studyId !== undefined) {
    return {
      studyId: options.studyId,
      dateToken: extractDateToken(options.studyId)
    }
  }
  return createC1PreflightIdentity(options.now ?? new Date())
}

function assignmentGate(
  plans: readonly C1PreflightLegPlan[],
  study: C1FrozenStudy
): C1StudyDryRunGate {
  const taskIds = new Set(study.tasks.map((task) => task.taskId))
  const uniqueRuns = new Set(plans.map((plan) => plan.runId)).size === plans.length
  const byTask = new Map<string, { native: number; runtime: number; pairs: Set<string> }>()
  for (const plan of plans) {
    if (!taskIds.has(plan.taskId))
      return gate('assignment_matrix', false, `unknown task ${plan.taskId}`)
    const state = byTask.get(plan.taskId) ?? {
      native: 0,
      runtime: 0,
      pairs: new Set<string>()
    }
    state[plan.arm === 'NATIVE' ? 'native' : 'runtime'] += 1
    state.pairs.add(plan.pairId)
    byTask.set(plan.taskId, state)
  }
  const quotas = study.tasks.every((task) => {
    const state = byTask.get(task.taskId)
    return (
      state !== undefined && state.native === 8 && state.runtime === 8 && state.pairs.size === 8
    )
  })
  return gate(
    'assignment_matrix',
    plans.length === 64 && uniqueRuns && quotas,
    `legs=${plans.length}, uniqueRuns=${String(uniqueRuns)}, taskQuotas=${String(quotas)}`
  )
}

/** Execute one frozen C1 study through a single injected execution path. */
async function runC1StudyWithFactories(
  options: C1StudyOrchestratorOptions
): Promise<C1StudyOrchestrationReport> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..')
  const nodeVersion = process.versions.node
  const baseReport = {
    runId: options.runId,
    executionMode: options.executionMode,
    responseSourceKind: options.responseSourceKind,
    nodeVersion,
    provider: C1_PROVIDER_ID,
    model: C1_MODEL_ID,
    endpoint: C1_PROVIDER_ENDPOINT,
    contractSha256: C1_C_CONTRACT_SHA256,
    assignmentMatrixSha256: C1_C_ASSIGNMENT_MATRIX_SHA256,
    taskManifestSha256: C1_C_TASK_MANIFEST_SHA256,
    treatmentRevision: C1_C_TREATMENT_REVISION,
    providerCalls: options.providerCalls?.() ?? 0,
    networkRequests: options.networkRequests?.() ?? 0
  } as const
  if (!nodeVersionSatisfiesC1Range(nodeVersion)) {
    return {
      ...baseReport,
      status: 'FAIL',
      providerConfigHash: null,
      studyId: null,
      reportDir: null,
      providerCallPermits: 0,
      responseCalls: 0,
      toolExecutions: 0,
      driverInstances: 0,
      fixtureSandboxesCreated: 0,
      fixtureSandboxesCleaned: 0,
      legsAttempted: 0,
      legsCompleted: 0,
      studyTerminal: true,
      terminalReason: `Node ${nodeVersion} is outside ${C1_NODE_RANGE}`,
      operatorSignal: null,
      gates: [gate('node_range', false, `Node ${nodeVersion} is outside ${C1_NODE_RANGE}`)],
      legs: [],
      artifacts: [],
      failures: [
        {
          code: 'NODE_RANGE_MISMATCH',
          message: `Node ${nodeVersion} is outside ${C1_NODE_RANGE}`
        }
      ]
    }
  }

  const gates: C1StudyDryRunGate[] = [
    gate('node_range', true, `${nodeVersion} satisfies ${C1_NODE_RANGE}`)
  ]
  const failures: { code: string; message: string }[] = []
  const completed: CompletedLeg[] = []
  let study: C1FrozenStudy | null = null
  let studyId: string | null = null
  let reportDir: string | null = null
  let providerConfigHash: string | null = null
  let providerBinding: Awaited<ReturnType<typeof prepareC1StrictProvider>> | null = null
  let budgetGuard: C1HardBudgetGuard | null = null
  let driver: C1LiveBindingDriver | null = null
  let evidenceSink: C1JsonlLiveBindingEvidenceSink | null = null
  let operatorKillSwitch: C1OperatorKillSwitch | null = null
  let operatorDisposed = false
  let studyTerminal = false
  let terminalReason: string | null = null
  let activeKillSwitch: RunKillSwitch | null = null
  let activeResponseAbortController: AbortController | null = null
  let fixtureSandboxesCreated = 0
  let fixtureSandboxesCleaned = 0
  let providerCallPermits = 0
  let responseCalls = 0
  let toolExecutions = 0
  let legsAttempted = 0
  const signalSource = options.signalSource ?? new EventEmitter()

  try {
    study = await loadC1FrozenStudy(repoRoot)
    gates.push(
      gate('frozen_binding', true, 'C1 protocol, manifest, contract, readiness, and hashes match')
    )
    const readiness = runC1TreatmentReadiness()
    const readinessPass = readiness.overallVerdict === 'PASS' && readiness.providerCalls === 0
    if (!readinessPass) {
      throw new C1PreflightFailure(
        'READINESS_BINDING_MISMATCH',
        'C1-C readiness did not pass zero-provider'
      )
    }
    gates.push(gate('c1c_readiness', true, 'C1-C treatment readiness PASS with providerCalls=0'))

    const verifiedFixtureBindings = new Map(
      await Promise.all(
        study.tasks.map(
          async (task) => [task.taskId, await verifyC1FixtureBinding(study!, task)] as const
        )
      )
    )
    gates.push(
      gate(
        'frozen_fixture_binding',
        verifiedFixtureBindings.size === study.tasks.length,
        `verified=${verifiedFixtureBindings.size}/${study.tasks.length} Git tree/content bindings`
      )
    )

    const identity = makeIdentity(options)
    studyId = identity.studyId
    const reportRoot =
      options.outputRoot ??
      join(repoRoot, '.live-output', options.dryRun ? 'c1-study-dry-run' : 'c1-study')
    reportDir = await claimSingleUseC1StudyDir(reportRoot, studyId)
    const plans = buildC1PreflightLegPlan(study, identity)
    assertC1AssignmentMatrixBinding(study.assignments, study.assignmentMatrixSha256)
    gates.push(assignmentGate(plans, study))
    if (gates.at(-1)?.verdict !== 'PASS') {
      throw new C1PreflightFailure(
        'ASSIGNMENT_BINDING_MISMATCH',
        'generated plan failed assignment gate'
      )
    }
    const expectedLegs = plans.length

    providerBinding = await prepareC1StrictProvider({ runIdentity: studyId })
    assertC1StrictProviderBinding(providerBinding.experimentBinding)
    providerConfigHash = providerBinding.providerConfigHash
    gates.push(
      gate(
        'strict_provider_preparation',
        true,
        'Step Plan binding prepared in memory; fallback disabled'
      )
    )

    budgetGuard = new C1HardBudgetGuard({
      perLeg: study.perLegBudgets,
      study: study.studyBudgets
    })
    evidenceSink = new C1JsonlLiveBindingEvidenceSink(join(reportDir, 'checkpoints.jsonl'))
    driver = new C1LiveBindingDriver({
      providerBinding,
      budgetGuard,
      evidenceSink
    })
    gates.push(
      gate(
        'shared_driver',
        true,
        'one C1LiveBindingDriver and one durable checkpoint sink shared by all legs'
      )
    )

    let operatorTripped = false
    operatorKillSwitch = installC1OperatorKillSwitch(signalSource, (signal) => {
      operatorTripped = true
      studyTerminal = true
      terminalReason = `operator ${signal}`
      activeKillSwitch?.trip(terminalReason)
      activeResponseAbortController?.abort()
    })

    for (const plan of plans) {
      if (operatorTripped || studyTerminal) {
        throw new C1PreflightFailure('KILL_SWITCH_BLOCKED', 'study terminal before the next leg')
      }
      await options.beforeLeg?.(plan)
      if (operatorTripped || studyTerminal) {
        throw new C1PreflightFailure(
          'KILL_SWITCH_BLOCKED',
          'operator kill switch blocked the next leg'
        )
      }
      const legDir = await claimSingleUseC1LegDir(reportDir, plan.runId)
      legsAttempted += 1
      const task = study.tasks.find((candidate) => candidate.taskId === plan.taskId)
      if (task === undefined) {
        throw new C1PreflightFailure('MANIFEST_BINDING_MISMATCH', `missing task ${plan.taskId}`)
      }
      const fixtureBinding = await verifyC1FixtureBinding(study, task)
      const fixture = await materializeFreshC1Fixture(fixtureBinding.sourcePath)
      fixtureSandboxesCreated += 1
      const responseAbortController = new AbortController()
      const legKillSwitch = createRunKillSwitch(plan.runId, {
        now: () => (options.now ?? new Date()).toISOString()
      })
      activeKillSwitch = legKillSwitch
      activeResponseAbortController = responseAbortController
      let fixtureCleaned = false
      let cleanupAttempted = false
      try {
        const before = await computeC1FixtureContentSummary(fixture.path)
        const beforeSnapshot = await snapshotC1Fixture(fixture.path)
        if (
          before.sha256 !== fixtureBinding.contentSummary.sha256 ||
          before.sha256 !== task.fixtureRevision.fixtureContentSha256
        ) {
          throw new C1PreflightFailure(
            'FIXTURE_BINDING_MISMATCH',
            `fresh fixture hash mismatch for ${plan.runId}`
          )
        }
        const factoryInput: C1StudyLegFactoryInput = {
          study,
          studyId,
          plan,
          task,
          fixtureRoot: fixture.path,
          legDir,
          killSwitch: legKillSwitch,
          responseAbortSignal: responseAbortController.signal,
          providerBinding
        }
        const responseSource = await options.responseSourceFactory(factoryInput)
        if (responseSource.kind !== options.responseSourceKind) {
          throw new C1PreflightFailure(
            'PROVIDER_BINDING_MISMATCH',
            `response source kind ${responseSource.kind} does not match ${options.responseSourceKind}`
          )
        }
        const observationSource = await options.observationSourceFactory(factoryInput)
        const toolExecutor = await options.toolExecutorFactory(factoryInput)
        const result = await driver.runLeg({
          studyId,
          task,
          stratum: plan.stratum,
          pairId: plan.pairId,
          arm: plan.arm,
          runId: plan.runId,
          fixtureContentSha256: before.sha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          runtimeSessionId: `${studyId}:${plan.pairId}:${plan.arm}`,
          observationSource,
          responseSource,
          toolExecutor,
          requireRuntimeDifferenceForCall: (callOrdinal) =>
            options.requireRuntimeDifferenceForCall?.(plan, callOrdinal) ?? false,
          maxCalls: options.maxCalls ?? 24,
          startedAtMs: 0,
          nowMs: 0,
          wallClockMs: 0,
          killSwitch: legKillSwitch
        })
        const after = await computeC1FixtureContentSummary(fixture.path)
        const afterSnapshot = await snapshotC1Fixture(fixture.path)
        const changedPaths = changedC1FixturePaths(beforeSnapshot, afterSnapshot)
        const writableScope = writableScopePass(changedPaths, task.expectedWritablePaths)
        if (!writableScope) {
          throw new C1PreflightFailure(
            'WRITABLE_SCOPE_FAILURE',
            `changed paths for ${plan.runId} are outside the frozen writable scope: ${changedPaths.join(', ')}`
          )
        }
        cleanupAttempted = true
        await fixture.cleanup()
        fixtureCleaned = true
        fixtureSandboxesCleaned += 1
        activeKillSwitch = null
        activeResponseAbortController = null
        const legManifest = {
          studyId,
          legIndex: plan.legIndex,
          taskId: plan.taskId,
          stratum: plan.stratum,
          pairId: plan.pairId,
          pairOrdinal: plan.pairOrdinal,
          order: plan.order,
          arm: plan.arm,
          runId: plan.runId,
          status: 'COMPLETED',
          fixtureContentSha256: before.sha256,
          postToolFixtureContentSha256: after.sha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          fixtureTreeObjectIdVerified: true,
          freshSandbox: true,
          sandboxReused: false,
          fixtureHashVerified: true,
          changedPaths,
          writableScopePass: true,
          fixtureCleaned: true,
          fixtureChangedByTool: changedPaths.length > 0,
          providerCalls: options.providerCalls?.() ?? 0,
          networkRequests: options.networkRequests?.() ?? 0,
          providerCallPermits: result.providerCallPermits,
          toolExecutions: result.evidence.reduce((sum, row) => sum + row.toolEvents.length, 0),
          responseSource: options.responseSourceKind
        }
        await writeDurableFile(
          join(legDir, 'leg-manifest.json'),
          `${JSON.stringify(legManifest, null, 2)}\n`
        )
        completed.push({
          plan,
          task,
          result,
          fixtureHashVerified: true,
          changedPaths,
          writableScopePass: true,
          fixtureCleaned: true,
          fixtureChangedByTool: changedPaths.length > 0,
          legDir
        })
        providerCallPermits += result.providerCallPermits
        responseCalls += result.evidence.length
        toolExecutions += result.evidence.reduce((sum, row) => sum + row.toolEvents.length, 0)
      } finally {
        if (!cleanupAttempted) {
          cleanupAttempted = true
          await fixture.cleanup()
          fixtureCleaned = true
          fixtureSandboxesCleaned += 1
        }
        activeKillSwitch = null
        activeResponseAbortController = null
      }
    }
    gates.push(
      gate(
        'fresh_fixture_isolation',
        fixtureSandboxesCreated === expectedLegs && fixtureSandboxesCleaned === expectedLegs,
        `created=${fixtureSandboxesCreated}, cleaned=${fixtureSandboxesCleaned}, expected=${expectedLegs}`
      )
    )
    const toolLoopExpected =
      options.expectedResponseCalls === undefined && options.expectedToolExecutions === undefined
        ? true
        : (options.expectedResponseCalls === undefined ||
            responseCalls === options.expectedResponseCalls) &&
          (options.expectedToolExecutions === undefined ||
            toolExecutions === options.expectedToolExecutions)
    gates.push(
      gate(
        'tool_loop',
        toolLoopExpected,
        `responses=${responseCalls}, toolExecutions=${toolExecutions}`
      )
    )
    const providerBoundaryExpected =
      options.expectedProviderCallPermits === undefined ||
      providerCallPermits === options.expectedProviderCallPermits
    gates.push(
      gate(
        'provider_boundary',
        providerBoundaryExpected,
        `providerCalls=${options.providerCalls?.() ?? 0}, networkRequests=${options.networkRequests?.() ?? 0}, permits=${providerCallPermits}`
      )
    )
    const budgetExpected =
      budgetGuard.ledger.completedLegs === expectedLegs &&
      (options.expectedProviderCallPermits === undefined ||
        budgetGuard.ledger.providerCalls === options.expectedProviderCallPermits) &&
      !driver.isStudyTerminal
    gates.push(
      gate(
        'budget_and_terminal',
        budgetExpected,
        `completedLegs=${budgetGuard.ledger.completedLegs}, providerPermits=${budgetGuard.ledger.providerCalls}, driverTerminal=${String(driver.isStudyTerminal)}`
      )
    )
    gates.push(
      gate(
        'operator_cleanup',
        !operatorTripped,
        'no operator signal was received during the completed dry run'
      )
    )
  } catch (error) {
    const failure = failureOf(error)
    failures.push(failure)
    studyTerminal = true
    terminalReason = failure.message
  } finally {
    if (operatorKillSwitch !== null) {
      operatorKillSwitch.dispose()
      operatorDisposed = true
    }
    activeKillSwitch = null
    providerBinding?.dispose()
  }

  if (study !== null && studyId !== null && reportDir !== null) {
    const statusBeforeArtifacts: C1StudyDryRunStatus =
      failures.length === 0 &&
      completed.length === study.studyBudgets.maxLegs &&
      gates.every((item) => item.verdict === 'PASS')
        ? 'PASS'
        : 'FAIL'
    const documents = serializedStudyArtifacts({
      study,
      runId: options.runId,
      executionMode: options.executionMode,
      responseSourceKind: options.responseSourceKind,
      dryRun: options.dryRun,
      studyId,
      completed,
      gates,
      failures,
      status: statusBeforeArtifacts,
      providerCallPermits,
      responseCalls,
      toolExecutions,
      providerCalls: options.providerCalls?.() ?? 0,
      networkRequests: options.networkRequests?.() ?? 0,
      legsAttempted,
      studyTerminal,
      terminalReason
    })
    try {
      const artifactResult = await writeStudyArtifacts({
        reportDir,
        documents
      })
      if (artifactResult.failed.length > 0) {
        failures.push({
          code: 'EVIDENCE_WRITE_FAILURE',
          message: `failed artifacts: ${artifactResult.failed.join(', ')}`
        })
        studyTerminal = true
        terminalReason ??= 'study artifact write failed'
      }
      const artifactGate = gate(
        'artifact_set',
        artifactResult.failed.length === 0 &&
          artifactResult.artifacts.length === C1_PREFLIGHT_ARTIFACT_NAMES.length,
        `attempted=${documents.length}, written=${artifactResult.artifacts.length}, failed=${artifactResult.failed.length}`
      )
      gates.push(artifactGate)
      const reportStatus: C1StudyDryRunStatus =
        failures.length === 0 &&
        completed.length === study.studyBudgets.maxLegs &&
        gates.every((item) => item.verdict === 'PASS') &&
        operatorDisposed
          ? 'PASS'
          : 'FAIL'
      return {
        ...baseReport,
        status: reportStatus,
        providerConfigHash,
        studyId,
        reportDir,
        providerCalls: options.providerCalls?.() ?? 0,
        networkRequests: options.networkRequests?.() ?? 0,
        providerCallPermits,
        responseCalls,
        toolExecutions,
        driverInstances: driver === null ? 0 : 1,
        fixtureSandboxesCreated,
        fixtureSandboxesCleaned,
        legsAttempted,
        legsCompleted: completed.length,
        studyTerminal,
        terminalReason,
        operatorSignal: operatorKillSwitch?.firstSignal ?? null,
        gates,
        legs: completed.map(summarizeLeg),
        artifacts: artifactResult.artifacts,
        failures
      }
    } catch (error) {
      failures.push(failureOf(error))
      studyTerminal = true
      terminalReason ??= 'study artifact finalization failed'
    }
  }

  return {
    ...baseReport,
    status: 'FAIL',
    providerConfigHash,
    studyId,
    reportDir,
    providerCalls: options.providerCalls?.() ?? 0,
    networkRequests: options.networkRequests?.() ?? 0,
    providerCallPermits,
    responseCalls,
    toolExecutions,
    driverInstances: driver === null ? 0 : 1,
    fixtureSandboxesCreated,
    fixtureSandboxesCleaned,
    legsAttempted,
    legsCompleted: completed.length,
    studyTerminal,
    terminalReason,
    operatorSignal: operatorKillSwitch?.firstSignal ?? null,
    gates,
    legs: completed.map(summarizeLeg),
    artifacts: [],
    failures
  }
}

function summarizeLeg(leg: CompletedLeg): C1StudyLegSummary {
  return {
    legIndex: leg.plan.legIndex,
    taskId: leg.plan.taskId,
    stratum: leg.plan.stratum,
    pairId: leg.plan.pairId,
    pairOrdinal: leg.plan.pairOrdinal,
    order: leg.plan.order,
    arm: leg.plan.arm,
    runId: leg.plan.runId,
    status: 'COMPLETED',
    calls: leg.result.evidence.length,
    toolCalls: leg.result.toolCalls,
    finalModelOutcome: leg.result.finalOutcome,
    transitionDecisionKinds: leg.result.evidence.map((row) => row.transitionDecisionKinds),
    fixtureHashVerified: leg.fixtureHashVerified,
    changedPaths: leg.changedPaths,
    writableScopePass: leg.writableScopePass,
    fixtureCleaned: leg.fixtureCleaned,
    fixtureChangedByTool: leg.fixtureChangedByTool,
    sandboxReused: false
  }
}

function summarizeDryRunLeg(leg: C1StudyLegSummary): C1StudyDryRunLegSummary {
  return {
    ...leg,
    fixtureChangedByDryRunTool: true
  }
}

export class C1StudyOrchestrator {
  constructor(private readonly options: C1StudyOrchestratorOptions) {}

  run(): Promise<C1StudyOrchestrationReport> {
    return runC1StudyWithFactories(this.options)
  }
}

function dryRunEditPath(input: C1StudyLegFactoryInput): string {
  const editPath = input.task.expectedWritablePaths[0]
  if (editPath === undefined) {
    throw new C1PreflightFailure(
      'FIXTURE_BINDING_MISMATCH',
      `task ${input.task.taskId} has no writable path`
    )
  }
  return editPath
}

export async function runC1StudyDryRun(
  options: C1StudyDryRunOptions = {}
): Promise<C1StudyDryRunReport> {
  const result = await new C1StudyOrchestrator({
    ...options,
    runId: C1_LIVE_STUDY_DRY_RUN_ID,
    executionMode: C1_LIVE_STUDY_DRY_RUN_MODE,
    responseSourceKind: 'SCRIPTED_FAKE',
    dryRun: true,
    maxCalls: 3,
    expectedProviderCallPermits: 192,
    expectedResponseCalls: 192,
    expectedToolExecutions: 192,
    responseSourceFactory: async (input) => {
      const editPath = dryRunEditPath(input)
      const originalContent = await readFile(safeFixturePath(input.fixtureRoot, editPath), 'utf8')
      return new C1ScriptedResponseSource(
        dryRunResponses({
          runId: input.plan.runId,
          editPath,
          originalContent
        })
      )
    },
    observationSourceFactory: (input) => {
      const editPath = dryRunEditPath(input)
      const fixtureFiles = uniqueSorted([editPath, ...input.task.relevantSources.slice(0, 2)])
      return new C1DryRunObservationSource(input.task, input.plan.runId, fixtureFiles)
    },
    toolExecutorFactory: (input) => new C1SandboxToolExecutor(input.fixtureRoot)
  }).run()

  return {
    ...result,
    runId: C1_LIVE_STUDY_DRY_RUN_ID,
    executionMode: C1_LIVE_STUDY_DRY_RUN_MODE,
    providerCalls: 0,
    networkRequests: 0,
    fakeProviderCallPermits: result.providerCallPermits,
    fakeResponseCalls: result.responseCalls,
    legs: result.legs.map(summarizeDryRunLeg)
  }
}
