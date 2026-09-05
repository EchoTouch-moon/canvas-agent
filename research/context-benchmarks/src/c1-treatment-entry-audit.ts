import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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

export const C1_TREATMENT_ENTRY_AUDIT_ID = 'C1_TREATMENT_ENTRY_AUDIT_V1'
export const C1_TREATMENT_ENTRY_SOURCE_RELATIVE_PATH = 'src/c1-live-study.ts'

export type C1TreatmentEntryAuditStatus = 'PASS' | 'FAIL'

export interface C1TreatmentEntryAuditGate {
  readonly gateId: string
  readonly verdict: 'PASS' | 'FAIL'
  readonly observed: string
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
  }
  readonly dryRunBoundary: {
    readonly scriptedSourcesAreWrapperOnly: boolean
    readonly lifecycleInjectionIsNotFormalEntryBehavior: boolean
  }
  readonly readiness: Pick<
    C1TreatmentReadinessReport,
    'overallVerdict' | 'providerCalls' | 'contractBinding'
  >
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
 * Audit the formal C1 Native/Runtime entry surface without starting the study
 * or resolving credentials. The source audit deliberately reports the dry-run
 * wrapper separately so scripted lifecycle traces cannot be mistaken for live
 * treatment behavior.
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
  const gates = [...sourceAudit.gates, readinessGate]
  const status: C1TreatmentEntryAuditStatus = gates.every((item) => item.verdict === 'PASS')
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
      taskManifestSha256: C1_C_TASK_MANIFEST_SHA256
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
    gates
  }
}
