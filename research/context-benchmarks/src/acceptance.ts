import type {
  AcceptanceCriterionResult,
  BenchmarkAcceptanceCriterion,
  BenchmarkManifest,
  OracleResult
} from './types'

export interface AcceptanceEvaluationInput {
  readonly objectiveOracle: OracleResult
  readonly regressionOracle: OracleResult
  readonly writablePathsValid: boolean
  readonly originalMessagesUnchanged: boolean
  readonly rawProviderPayloadsCaptured: false
}

function oracleEvidence(label: string, result: OracleResult): string {
  return `${label}:passed=${String(result.passed)};exitCode=${String(result.exitCode)};timedOut=${String(result.timedOut)}`
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
