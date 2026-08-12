import type {
  AcceptanceCriterionResult,
  BenchmarkAcceptanceCriterion,
  BenchmarkManifest,
  OracleResult
} from './types'
import { runC2ContractProbe } from './fixture-generator'

export interface DeterministicAcceptanceEvidence {
  readonly passed: boolean
  readonly evidence: string
}

export interface AcceptanceEvaluationInput {
  readonly objectiveOracle: OracleResult
  readonly regressionOracle: OracleResult
  readonly writablePathsValid: boolean
  readonly originalMessagesUnchanged: boolean
  readonly rawProviderPayloadsCaptured: false
  readonly c2MultiFileContract?: DeterministicAcceptanceEvidence | null
}

function oracleEvidence(label: string, result: OracleResult): string {
  return `${label}:passed=${String(result.passed)};exitCode=${String(result.exitCode)};timedOut=${String(result.timedOut)};outputLimitExceeded=${String(result.outputLimitExceeded ?? false)}`
}

function evaluateCriterion(
  criterion: BenchmarkAcceptanceCriterion,
  input: AcceptanceEvaluationInput
): AcceptanceCriterionResult {
  switch (criterion.check) {
    case 'OBJECTIVE_ORACLE':
      return {
        ...criterion,
        passed: input.objectiveOracle.passed,
        evidence: oracleEvidence('objectiveOracle', input.objectiveOracle)
      }
    case 'C2_MULTI_FILE_CONTRACT':
      return {
        ...criterion,
        passed: input.c2MultiFileContract?.passed ?? false,
        evidence: input.c2MultiFileContract?.evidence ?? 'c2MultiFileContract:missing_evidence'
      }
    case 'REGRESSION_ORACLE':
      return {
        ...criterion,
        passed: input.regressionOracle.passed,
        evidence: oracleEvidence('regressionOracle', input.regressionOracle)
      }
    case 'WRITABLE_PATH_SCOPE':
      return {
        ...criterion,
        passed: input.writablePathsValid,
        evidence: `writablePathsValid=${String(input.writablePathsValid)}`
      }
    case 'ORIGINAL_MESSAGES_UNCHANGED':
      return {
        ...criterion,
        passed: input.originalMessagesUnchanged,
        evidence: `originalMessagesUnchanged=${String(input.originalMessagesUnchanged)}`
      }
    case 'RAW_PROVIDER_PAYLOADS_ABSENT':
      return {
        ...criterion,
        passed: !input.rawProviderPayloadsCaptured,
        evidence: `rawProviderPayloadsCaptured=${String(input.rawProviderPayloadsCaptured)}`
      }
  }
}

export function evaluateAcceptanceCriteria(
  manifest: BenchmarkManifest,
  input: AcceptanceEvaluationInput
): readonly AcceptanceCriterionResult[] {
  return manifest.acceptanceCriteria.map((criterion) => evaluateCriterion(criterion, input))
}

export async function evaluateC2MultiFileContract(
  fixturePath: string
): Promise<DeterministicAcceptanceEvidence> {
  try {
    const probe = await runC2ContractProbe(fixturePath)
    const passed =
      probe.protocolValid &&
      !probe.timedOut &&
      !probe.outputLimitExceeded &&
      probe.configRuntime &&
      probe.greetingRuntime &&
      probe.indexForwarding
    return {
      passed,
      evidence: `c2MultiFileContract:configRuntime=${String(probe.configRuntime)};greetingRuntime=${String(probe.greetingRuntime)};indexForwarding=${String(probe.indexForwarding)};probeTimedOut=${String(probe.timedOut)};outputLimitExceeded=${String(probe.outputLimitExceeded)};protocolValid=${String(probe.protocolValid)}`
    }
  } catch {
    return { passed: false, evidence: 'c2MultiFileContract:runtime_probe_failed' }
  }
}

export function acceptanceCriteriaPassed(
  manifest: BenchmarkManifest,
  results: readonly AcceptanceCriterionResult[]
): boolean {
  if (results.length !== manifest.acceptanceCriteria.length) return false
  return manifest.acceptanceCriteria.every((criterion, index) => {
    const result = results[index]
    return (
      result !== undefined &&
      result.id === criterion.id &&
      result.description === criterion.description &&
      result.check === criterion.check &&
      result.passed
    )
  })
}
