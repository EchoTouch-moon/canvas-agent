import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  C1_C_ASSIGNMENT_MATRIX_SHA256,
  C1_C_CONTRACT_SHA256,
  C1_C_PARENT_REVISION,
  C1_C_READINESS_ID,
  C1_C_TASK_MANIFEST_SHA256,
  C1_C_TREATMENT_REVISION,
  runC1TreatmentReadiness,
  type C1TreatmentReadinessReport
} from './c1-treatment-readiness'
import {
  C1StudyOrchestrator,
  type C1StudyLegFactoryInput,
  type C1StudyOrchestrationReport
} from './c1-live-study'
import {
  C1SandboxToolExecutor,
  C1ScriptedObservationSource,
  C1ScriptedResponseSource
} from './c1-live-binding'
import { createC1ObservedReadTrace, nodeVersionSatisfiesC1Range } from './c1-live-preflight'

export const C1_TREATMENT_ENTRY_AUDIT_ID = 'C1_TREATMENT_ENTRY_AUDIT_V1'
export const C1_TREATMENT_ENTRY_SOURCE_RELATIVE_PATH = 'src/c1-live-study.ts'

export type C1TreatmentEntryAuditStatus = 'PASS' | 'FAIL' | 'INCOMPLETE'

export interface C1TreatmentEntryAuditGate {
  readonly gateId: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly observed: string
}

export type C1TreatmentEntryBehaviorProbeStatus = 'PASS' | 'NOT_RUN_NODE_RANGE' | 'FAIL'

export interface C1TreatmentEntryBehaviorProbeReport {
  readonly status: C1TreatmentEntryBehaviorProbeStatus
  readonly executionMode: 'CREDENTIAL_FREE_FORMAL_ENTRY_AUDIT'
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly driverInstances: 1 | 0
  readonly legsAttempted: number
  readonly legsCompleted: number
  readonly nativeProviderBoundSourceKeys: readonly string[]
  readonly runtimeProviderBoundSourceKeys: readonly string[]
  readonly inputSourceKeysEqual: boolean
  readonly inputMessageFingerprintEqual: boolean
  readonly nativeSemanticFingerprint: string | null
  readonly runtimeSemanticFingerprint: string | null
  readonly structuralFingerprintEqual: boolean
  readonly providerConfigHashEqual: boolean
  readonly providerBoundContextChanged: boolean
  readonly treatmentBypassRejected: boolean
  readonly treatmentBypassFailureCode: string | null
  readonly fallbackSent: false
  readonly networkSent: false
  readonly failure?: string
}

export interface C1TreatmentEntryAuditReport {
  readonly auditId: typeof C1_TREATMENT_ENTRY_AUDIT_ID
  readonly schemaVersion: 1
  readonly status: C1TreatmentEntryAuditStatus
  readonly executionMode: 'CREDENTIAL_FREE_NO_NETWORK'
  readonly providerCalls: 0
  readonly networkRequests: 0
  readonly providerExecution: 'NOT_AUTHORIZED'
  readonly formalEntryPoint: {
    readonly className: 'C1StudyOrchestrator'
    readonly method: 'run'
    readonly implementation: 'runC1StudyWithFactories'
    readonly responseSourceFactory: 'INJECTED'
    readonly observationSourceFactory: 'INJECTED'
    readonly toolExecutorFactory: 'INJECTED'
  }
  readonly binding: {
    readonly parentRevision: typeof C1_C_PARENT_REVISION
    readonly treatmentRevision: typeof C1_C_TREATMENT_REVISION
    readonly readinessId: typeof C1_C_READINESS_ID
    readonly contractSha256: typeof C1_C_CONTRACT_SHA256
    readonly assignmentMatrixSha256: typeof C1_C_ASSIGNMENT_MATRIX_SHA256
    readonly taskManifestSha256: typeof C1_C_TASK_MANIFEST_SHA256
    readonly formalEntrySourceSha256: string
  }
  readonly dryRunBoundary: {
    readonly scriptedSourcesAreWrapperOnly: boolean
    readonly lifecycleInjectionIsNotFormalEntryBehavior: boolean
  }
  readonly readiness: Pick<
    C1TreatmentReadinessReport,
    'overallVerdict' | 'providerCalls' | 'contractBinding'
  >
  readonly behaviorProbe: C1TreatmentEntryBehaviorProbeReport
  readonly gates: readonly C1TreatmentEntryAuditGate[]
}

function gate(gateId: string, pass: boolean, observed: string): C1TreatmentEntryAuditGate {
  return { gateId, verdict: pass ? 'PASS' : 'FAIL', observed }
}

function findRequired(source: string, marker: string): number {
  const index = source.indexOf(marker)
  if (index < 0) throw new Error(`treatment entry audit marker not found: ${marker}`)
  return index
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function parseJsonLines(content: string): readonly unknown[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

interface BehaviorEvidenceRow {
  readonly arm: 'NATIVE' | 'RUNTIME'
  readonly callOrdinal: number
  readonly contextStrategy: 'NATIVE_UNMANAGED' | 'RUNTIME_WORKING_SET'
  readonly providerBoundSourceKeys: readonly string[]
  readonly semanticFingerprint: string
  readonly structuralFingerprint: string
  readonly providerConfigHash: string
  readonly fallbackSent: false
  readonly networkSent: false
}

function parseBehaviorEvidenceRow(value: unknown): BehaviorEvidenceRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('formal behavior evidence row is not an object')
  }
  const record = value as Record<string, unknown>
  const arm = record['arm']
  const callOrdinal = record['callOrdinal']
  const contextStrategy = record['contextStrategy']
  const providerBoundSourceKeys = record['providerBoundSourceKeys']
  const semanticFingerprint = record['modelVisibleSemanticContextFingerprint']
  const structuralFingerprint = record['systemDeveloperToolStructuresFingerprint']
  const providerConfigHash = record['providerConfigHash']
  if (
    (arm !== 'NATIVE' && arm !== 'RUNTIME') ||
    typeof callOrdinal !== 'number' ||
    !Number.isSafeInteger(callOrdinal) ||
    callOrdinal < 1 ||
    (contextStrategy !== 'NATIVE_UNMANAGED' && contextStrategy !== 'RUNTIME_WORKING_SET') ||
    !Array.isArray(providerBoundSourceKeys) ||
    !providerBoundSourceKeys.every((key) => typeof key === 'string' && key.length > 0) ||
    typeof semanticFingerprint !== 'string' ||
    semanticFingerprint.length === 0 ||
    typeof structuralFingerprint !== 'string' ||
    structuralFingerprint.length === 0 ||
    typeof providerConfigHash !== 'string' ||
    providerConfigHash.length === 0 ||
    record['fallbackSent'] !== false ||
    record['networkSent'] !== false
  ) {
    throw new Error('formal behavior evidence row is incomplete')
  }
  return {
    arm,
    callOrdinal,
    contextStrategy,
    providerBoundSourceKeys,
    semanticFingerprint,
    structuralFingerprint,
    providerConfigHash,
    fallbackSent: false,
    networkSent: false
  }
}

interface BehaviorInputRecord {
  readonly sourceKeys: readonly string[]
  readonly messageFingerprint: string
}

function sameSourceKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}

function treatmentDifferencePass(native: BehaviorEvidenceRow, runtime: BehaviorEvidenceRow): boolean {
  return (
    native.contextStrategy === 'NATIVE_UNMANAGED' &&
    runtime.contextStrategy === 'RUNTIME_WORKING_SET' &&
    !sameSourceKeys(native.providerBoundSourceKeys, runtime.providerBoundSourceKeys) &&
    native.semanticFingerprint !== runtime.semanticFingerprint
  )
}

function nodeRangeNotRunBehaviorProbe(): C1TreatmentEntryBehaviorProbeReport {
  return {
    status: 'NOT_RUN_NODE_RANGE',
    executionMode: 'CREDENTIAL_FREE_FORMAL_ENTRY_AUDIT',
    providerCalls: 0,
    networkRequests: 0,
    driverInstances: 0,
    legsAttempted: 0,
    legsCompleted: 0,
    nativeProviderBoundSourceKeys: [],
    runtimeProviderBoundSourceKeys: [],
    inputSourceKeysEqual: false,
    inputMessageFingerprintEqual: false,
    nativeSemanticFingerprint: null,
    runtimeSemanticFingerprint: null,
    structuralFingerprintEqual: false,
    providerConfigHashEqual: false,
    providerBoundContextChanged: false,
    treatmentBypassRejected: false,
    treatmentBypassFailureCode: null,
    fallbackSent: false,
    networkSent: false
  }
}

function failedBehaviorProbe(
  failure: string,
  report?: C1StudyOrchestrationReport
): C1TreatmentEntryBehaviorProbeReport {
  return {
    status: 'FAIL',
    executionMode: 'CREDENTIAL_FREE_FORMAL_ENTRY_AUDIT',
    providerCalls: 0,
    networkRequests: 0,
    driverInstances: report?.driverInstances ?? 0,
    legsAttempted: report?.legsAttempted ?? 0,
    legsCompleted: report?.legsCompleted ?? 0,
    nativeProviderBoundSourceKeys: [],
    runtimeProviderBoundSourceKeys: [],
    inputSourceKeysEqual: false,
    inputMessageFingerprintEqual: false,
    nativeSemanticFingerprint: null,
    runtimeSemanticFingerprint: null,
    structuralFingerprintEqual: false,
    providerConfigHashEqual: false,
    providerBoundContextChanged: false,
    treatmentBypassRejected: false,
    treatmentBypassFailureCode: null,
    fallbackSent: false,
    networkSent: false,
    failure
  }
}

async function runFormalEntryBehaviorProbe(
  repoRoot: string
): Promise<C1TreatmentEntryBehaviorProbeReport> {
  if (!nodeVersionSatisfiesC1Range()) return nodeRangeNotRunBehaviorProbe()

  const outputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-entry-behavior-'))
  const signals = new EventEmitter()
  let bypassOutputRoot: string | null = null
  const sharedObservations = new Map<string, ReturnType<typeof createC1ObservedReadTrace>>()
  const inputRecords = new Map<'NATIVE' | 'RUNTIME', BehaviorInputRecord>()
  const responseSourceFactory = async (input: C1StudyLegFactoryInput) => {
    const writablePath = input.task.expectedWritablePaths[0]
    if (writablePath === undefined) {
      throw new Error(`formal behavior task ${input.task.taskId} has no writable path`)
    }
    const originalContent = await readFile(join(input.fixtureRoot, writablePath), 'utf8')
    return new C1ScriptedResponseSource([
      {
        responseId: `${input.plan.runId}-response-01`,
        assistantMessageCount: 1,
        assistantContent: 'formal entry behavior probe',
        usage: {
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 11,
          usageSource: 'SCRIPTED_FAKE'
        },
        toolRequests: [],
        toolExecutions: [],
        outcome: 'CONTINUE'
      },
      {
        responseId: `${input.plan.runId}-response-02`,
        assistantMessageCount: 1,
        assistantContent: 'formal entry behavior completion',
        usage: {
          inputTokens: 12,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 13,
          usageSource: 'SCRIPTED_FAKE'
        },
        toolRequests: [
          {
            toolCallId: `${input.plan.runId}-edit-02`,
            toolName: 'edit',
            argumentsJson: JSON.stringify({
              path: writablePath,
              oldText: originalContent,
              newText: `${originalContent}\n/* formal entry behavior probe */\n`
            })
          }
        ],
        toolExecutions: [],
        outcome: 'COMPLETE'
      }
    ])
  }
  const observationSourceFactory = (
    input: C1StudyLegFactoryInput,
    bypassRuntimeTreatment: boolean,
    recordInput: boolean
  ) => {
    const writablePath = input.task.expectedWritablePaths[0]
    if (writablePath === undefined) {
      throw new Error(`formal behavior task ${input.task.taskId} has no writable path`)
    }
    const fixtureFiles = [writablePath, ...input.task.relevantSources.slice(0, 2)]
    const sharedObservation =
      sharedObservations.get(input.task.taskId) ??
      createC1ObservedReadTrace({
        observationId: `formal-entry-shared-${input.task.taskId}`,
        prompt: input.task.prompt,
        fixtureFiles: [...new Set(fixtureFiles)].sort(),
        taskPhase: 'INVESTIGATE'
      })
    sharedObservations.set(input.task.taskId, sharedObservation)
    const excludedToolCallKey = sharedObservation.currentTargetSourceKeys.find((key) =>
      key.startsWith('run/tool-call://')
    )
    if (excludedToolCallKey === undefined) {
      throw new Error(`formal behavior task ${input.task.taskId} has no tool-call source`)
    }
    const excludedCallId = excludedToolCallKey.slice('run/tool-call://'.length)
    const excludedSourceKeys = [
      excludedToolCallKey,
      `run/tool-result://${excludedCallId}`
    ].filter((key) => sharedObservation.currentTargetSourceKeys.includes(key))
    if (excludedSourceKeys.length !== 2) {
      throw new Error(`formal behavior task ${input.task.taskId} has an incomplete tool pair`)
    }
    const retainedSourceKeys = sharedObservation.currentTargetSourceKeys.filter(
      (key) => !excludedSourceKeys.includes(key)
    )
    const changedObservation = {
      ...sharedObservation,
      observationId: `${sharedObservation.observationId}-${
        bypassRuntimeTreatment ? 'bypass' : 'runtime-exclude'
      }`,
      currentTargetSourceKeys: bypassRuntimeTreatment
        ? sharedObservation.currentTargetSourceKeys
        : retainedSourceKeys,
      excludedSourceKeys: bypassRuntimeTreatment ? [] : excludedSourceKeys
    }
    if (recordInput) {
      inputRecords.set(input.plan.arm, {
        sourceKeys: [...sharedObservation.currentTargetSourceKeys],
        messageFingerprint: sha256(JSON.stringify(sharedObservation.messages))
      })
    }
    return new C1ScriptedObservationSource([sharedObservation, changedObservation])
  }
  const runBehaviorStudy = async (input: {
    readonly outputRoot: string
    readonly studyId: string
    readonly runId: string
    readonly signalSource: EventEmitter
    readonly bypassRuntimeTreatment: boolean
    readonly recordInput: boolean
  }): Promise<C1StudyOrchestrationReport> =>
    new C1StudyOrchestrator({
      repoRoot,
      outputRoot: input.outputRoot,
      studyId: input.studyId,
      runId: input.runId,
      executionMode: 'CREDENTIAL_FREE_FORMAL_ENTRY_AUDIT',
      responseSourceKind: 'SCRIPTED_FAKE',
      dryRun: false,
      maxCalls: 2,
      signalSource: input.signalSource,
      beforeLeg: (plan) => {
        if (plan.legIndex === 2) input.signalSource.emit('SIGINT')
      },
      responseSourceFactory,
      observationSourceFactory: (factoryInput) =>
        observationSourceFactory(
          factoryInput,
          input.bypassRuntimeTreatment,
          input.recordInput
        ),
      toolExecutorFactory: (factoryInput) => new C1SandboxToolExecutor(factoryInput.fixtureRoot),
      expectedProviderCallPermits: 4,
      expectedResponseCalls: 4,
      expectedToolExecutions: 2,
      requireRuntimeDifferenceForCall: (plan, callOrdinal) =>
        plan.arm === 'RUNTIME' && callOrdinal === 2
    }).run()
  try {
    const report = await runBehaviorStudy({
      outputRoot,
      studyId: 'c1-20260905-c1-feasibility-v1-dddddddd',
      runId: 'C1_FORMAL_ENTRY_BEHAVIOR_AUDIT_V1',
      signalSource: signals,
      bypassRuntimeTreatment: false,
      recordInput: true
    })

    if (report.reportDir === null) {
      const details = report.failures
        .map((failure) => `${failure.code}: ${failure.message}`)
        .join('; ')
      return failedBehaviorProbe(
        `formal behavior probe produced no report directory${details.length > 0 ? ` (${details})` : ''}`,
        report
      )
    }
    const rows = parseJsonLines(
      await readFile(join(report.reportDir, 'decision-evidence.jsonl'), 'utf8')
    ).map(parseBehaviorEvidenceRow)
    const nativeRows = rows.filter((row) => row.arm === 'NATIVE')
    const runtimeRows = rows.filter((row) => row.arm === 'RUNTIME')
    const native = nativeRows.at(-1)
    const runtime = runtimeRows.at(-1)
    if (
      native === undefined ||
      runtime === undefined ||
      nativeRows.length !== 2 ||
      runtimeRows.length !== 2 ||
      rows.length !== 4
    ) {
      const details = report.failures
        .map((failure) => `${failure.code}: ${failure.message}`)
        .join('; ')
      return failedBehaviorProbe(
        `formal behavior probe did not produce exactly two Native and Runtime rows${details.length > 0 ? ` (${details})` : ''}`,
        report
      )
    }
    const structuralFingerprintEqual =
      native.structuralFingerprint === runtime.structuralFingerprint
    const providerConfigHashEqual = native.providerConfigHash === runtime.providerConfigHash
    const providerBoundContextChanged = treatmentDifferencePass(native, runtime)
    const nativeInput = inputRecords.get('NATIVE')
    const runtimeInput = inputRecords.get('RUNTIME')
    const inputSourceKeysEqual =
      nativeInput !== undefined &&
      runtimeInput !== undefined &&
      sameSourceKeys(nativeInput.sourceKeys, runtimeInput.sourceKeys)
    const inputMessageFingerprintEqual =
      nativeInput !== undefined &&
      runtimeInput !== undefined &&
      nativeInput.messageFingerprint === runtimeInput.messageFingerprint
    bypassOutputRoot = await mkdtemp(join(tmpdir(), 'canvas-c1-entry-bypass-'))
    const bypassReport = await runBehaviorStudy({
      outputRoot: bypassOutputRoot,
      studyId: 'c1-20260905-c1-feasibility-v1-eeeeeeee',
      runId: 'C1_FORMAL_ENTRY_TREATMENT_BYPASS_AUDIT_V1',
      signalSource: new EventEmitter(),
      bypassRuntimeTreatment: true,
      recordInput: false
    })
    const treatmentBypassFailureCode =
      bypassReport.failures.find((failure) => failure.code === 'RUNTIME_CONTEXT_UNCHANGED')
        ?.code ?? null
    const treatmentBypassRejected =
      bypassReport.status === 'FAIL' &&
      bypassReport.studyTerminal &&
      bypassReport.providerCalls === 0 &&
      bypassReport.networkRequests === 0 &&
      bypassReport.legsAttempted === 2 &&
      bypassReport.legsCompleted === 1 &&
      treatmentBypassFailureCode === 'RUNTIME_CONTEXT_UNCHANGED'
    const pass =
      report.driverInstances === 1 &&
      report.providerCalls === 0 &&
      report.networkRequests === 0 &&
      report.legsAttempted === 2 &&
      report.legsCompleted === 2 &&
      report.operatorSignal === 'SIGINT' &&
      report.failures.some((failure) => failure.code === 'KILL_SWITCH_BLOCKED') &&
      native.fallbackSent === false &&
      runtime.fallbackSent === false &&
      native.networkSent === false &&
      runtime.networkSent === false &&
      inputSourceKeysEqual &&
      inputMessageFingerprintEqual &&
      structuralFingerprintEqual &&
      providerConfigHashEqual &&
      providerBoundContextChanged &&
      treatmentBypassRejected
    return {
      status: pass ? 'PASS' : 'FAIL',
      executionMode: 'CREDENTIAL_FREE_FORMAL_ENTRY_AUDIT',
      providerCalls: 0,
      networkRequests: 0,
      driverInstances: report.driverInstances,
      legsAttempted: report.legsAttempted,
      legsCompleted: report.legsCompleted,
      nativeProviderBoundSourceKeys: native.providerBoundSourceKeys,
      runtimeProviderBoundSourceKeys: runtime.providerBoundSourceKeys,
      inputSourceKeysEqual,
      inputMessageFingerprintEqual,
      nativeSemanticFingerprint: native.semanticFingerprint,
      runtimeSemanticFingerprint: runtime.semanticFingerprint,
      structuralFingerprintEqual,
      providerConfigHashEqual,
      providerBoundContextChanged,
      treatmentBypassRejected,
      treatmentBypassFailureCode,
      fallbackSent: false,
      networkSent: false,
      ...(pass
        ? {}
        : {
            failure: 'formal entry behavior did not satisfy all provider-bound checks'
          })
    }
  } catch (error) {
    return failedBehaviorProbe(error instanceof Error ? error.message : String(error))
  } finally {
    if (bypassOutputRoot !== null) {
      await rm(bypassOutputRoot, { recursive: true, force: true })
    }
    await rm(outputRoot, { recursive: true, force: true })
  }
}

function auditFormalEntrySource(source: string): {
  readonly formalBody: string
  readonly dryRunBody: string
  readonly gates: readonly C1TreatmentEntryAuditGate[]
} {
  const formalStart = findRequired(source, 'async function runC1StudyWithFactories')
  const orchestratorBoundary = findRequired(source, 'export class C1StudyOrchestrator')
  const dryRunStart = findRequired(source, 'export async function runC1StudyDryRun')
  const formalBody = source.slice(formalStart, orchestratorBoundary)
  const dryRunBody = source.slice(dryRunStart)
  const injectedFactoryNames = [
    'options.responseSourceFactory',
    'options.observationSourceFactory',
    'options.toolExecutorFactory'
  ]
  const formalFactoryBinding = injectedFactoryNames.every((name) => formalBody.includes(name))
  const armBinding = formalBody.includes('arm: plan.arm')
  const noScriptedFactoryInFormal = ![
    'C1ScriptedResponseSource',
    'C1ScriptedObservationSource',
    'C1DryRunObservationSource',
    'dryRunResponses'
  ].some((marker) => formalBody.includes(marker))
  const wrapperOwnsScriptedSources = [
    'C1ScriptedResponseSource',
    'C1DryRunObservationSource',
    'dryRunResponses'
  ].every((marker) => dryRunBody.includes(marker))
  const noSyntheticLifecycleInFormal =
    !formalBody.includes('RULED_OUT') &&
    !formalBody.includes('REHYDRATE') &&
    !formalBody.includes('scriptedLifecycleInjection')

  return {
    formalBody,
    dryRunBody,
    gates: [
      gate(
        'formal_factory_slots',
        formalFactoryBinding,
        `response/observation/tool executor factories injected=${String(formalFactoryBinding)}`
      ),
      gate('formal_arm_binding', armBinding, `formal plan arm binding=${String(armBinding)}`),
      gate(
        'formal_entry_has_no_scripted_source',
        noScriptedFactoryInFormal,
        `scripted source marker absent from formal entry=${String(noScriptedFactoryInFormal)}`
      ),
      gate(
        'dry_run_scripted_boundary',
        wrapperOwnsScriptedSources,
        `scripted source markers confined to dry-run wrapper=${String(wrapperOwnsScriptedSources)}`
      ),
      gate(
        'formal_entry_has_no_synthetic_lifecycle',
        noSyntheticLifecycleInFormal,
        `synthetic lifecycle markers absent from formal entry=${String(noSyntheticLifecycleInFormal)}`
      )
    ]
  }
}

/**
 * Audit the formal C1 Native/Runtime entry surface without resolving
 * credentials. The source audit deliberately reports the dry-run wrapper
 * separately, while the behavior probe exercises the same orchestrator entry
 * with scripted responses so source-shape checks cannot stand in for behavior.
 */
export async function runC1TreatmentEntryAudit(
  repoRoot: string = resolve(import.meta.dirname, '..', '..', '..')
): Promise<C1TreatmentEntryAuditReport> {
  const source = await readFile(
    resolve(repoRoot, 'research/context-benchmarks', C1_TREATMENT_ENTRY_SOURCE_RELATIVE_PATH),
    'utf8'
  )
  const sourceAudit = auditFormalEntrySource(source)
  const readiness = runC1TreatmentReadiness()
  const readinessBinding = readiness.contractBinding
  const bindingPass =
    readiness.overallVerdict === 'PASS' &&
    readiness.providerCalls === 0 &&
    readinessBinding.parentRevision === C1_C_PARENT_REVISION &&
    readinessBinding.treatmentRevision === C1_C_TREATMENT_REVISION &&
    readinessBinding.contractSha256 === C1_C_CONTRACT_SHA256 &&
    readinessBinding.assignmentMatrixSha256 === C1_C_ASSIGNMENT_MATRIX_SHA256 &&
    readinessBinding.taskManifestSha256 === C1_C_TASK_MANIFEST_SHA256
  const readinessGate = gate(
    'c1c_readiness_binding',
    bindingPass,
    `readiness=${readiness.overallVerdict};providerCalls=${readiness.providerCalls};treatmentRevision=${readinessBinding.treatmentRevision}`
  )
  const behaviorProbe = await runFormalEntryBehaviorProbe(repoRoot)
  const behaviorGate = gate(
    'formal_entry_behavior',
    behaviorProbe.status === 'PASS',
    `formal orchestrator behavior=${behaviorProbe.status};providerCalls=${behaviorProbe.providerCalls};networkRequests=${behaviorProbe.networkRequests}`
  )
  const gates = [...sourceAudit.gates, readinessGate, behaviorGate]
  const status: C1TreatmentEntryAuditStatus =
    behaviorProbe.status === 'NOT_RUN_NODE_RANGE'
      ? 'INCOMPLETE'
      : gates.every((item) => item.verdict === 'PASS')
        ? 'PASS'
        : 'FAIL'

  return {
    auditId: C1_TREATMENT_ENTRY_AUDIT_ID,
    schemaVersion: 1,
    status,
    executionMode: 'CREDENTIAL_FREE_NO_NETWORK',
    providerCalls: 0,
    networkRequests: 0,
    providerExecution: 'NOT_AUTHORIZED',
    formalEntryPoint: {
      className: 'C1StudyOrchestrator',
      method: 'run',
      implementation: 'runC1StudyWithFactories',
      responseSourceFactory: 'INJECTED',
      observationSourceFactory: 'INJECTED',
      toolExecutorFactory: 'INJECTED'
    },
    binding: {
      parentRevision: C1_C_PARENT_REVISION,
      treatmentRevision: C1_C_TREATMENT_REVISION,
      readinessId: C1_C_READINESS_ID,
      contractSha256: C1_C_CONTRACT_SHA256,
      assignmentMatrixSha256: C1_C_ASSIGNMENT_MATRIX_SHA256,
      taskManifestSha256: C1_C_TASK_MANIFEST_SHA256,
      formalEntrySourceSha256: sha256(sourceAudit.formalBody)
    },
    dryRunBoundary: {
      scriptedSourcesAreWrapperOnly: sourceAudit.gates.some(
        (item) => item.gateId === 'dry_run_scripted_boundary' && item.verdict === 'PASS'
      ),
      lifecycleInjectionIsNotFormalEntryBehavior: sourceAudit.gates.some(
        (item) =>
          item.gateId === 'formal_entry_has_no_synthetic_lifecycle' && item.verdict === 'PASS'
      )
    },
    readiness: {
      overallVerdict: readiness.overallVerdict,
      providerCalls: readiness.providerCalls,
      contractBinding: readiness.contractBinding
    },
    behaviorProbe,
    gates
  }
}
