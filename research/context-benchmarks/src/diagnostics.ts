import type {
  BenchmarkFailureClass,
  BenchmarkFailureSignal,
  BenchmarkRunRecord
} from './types'

export interface BenchmarkFailureDiagnosis {
  readonly failureClass: BenchmarkFailureClass | null
  readonly failureSignals: readonly BenchmarkFailureSignal[]
}

function failedAcceptanceCriteria(record: BenchmarkRunRecord) {
  return record.acceptanceCriteriaResults.filter((criterion) => !criterion.passed)
}

/**
 * Classify an unsuccessful record for attribution review.
 *
 * This is deliberately separate from the validity gate. A harness-contract
 * diagnosis never makes a record valid and never permits checkpoint resume.
 * It only marks the narrow case where the objective/regression/path/safety
 * evidence passed and the C2 contract probe was unable to produce trustworthy
 * evidence. A trustworthy probe that returns false is a task failure.
 */
export function diagnoseBenchmarkFailure(record: BenchmarkRunRecord): BenchmarkFailureDiagnosis {
  const failedCriteria = failedAcceptanceCriteria(record)
  const failedC2Criterion = failedCriteria.find((criterion) => criterion.check === 'C2_MULTI_FILE_CONTRACT')
  const failedC2Contract = failedC2Criterion !== undefined
  const failedNonC2Criterion = failedCriteria.some((criterion) => criterion.check !== 'C2_MULTI_FILE_CONTRACT')
  const signals: BenchmarkFailureSignal[] = []

  const c2ProbeIsTrustworthy = (criterion: typeof failedC2Criterion): boolean => {
    if (criterion === undefined) return false
    const evidence = criterion.evidence
    if (!evidence.startsWith('c2MultiFileContract:') || evidence.includes('runtime_probe_failed')) return false
    return (
      evidence.includes('probeTimedOut=false') &&
      evidence.includes('outputLimitExceeded=false') &&
      evidence.includes('protocolValid=true')
    )
  }
  const c2ProbeUntrustworthy = failedC2Contract && !c2ProbeIsTrustworthy(failedC2Criterion)

  if (record.status === 'ABORTED' || record.status === 'SKIPPED') signals.push('RUN_NOT_COMPLETED')
  if (!record.objectiveOracle.passed) signals.push('OBJECTIVE_ORACLE_FAILED')
  if (!record.regressionOracle.passed) signals.push('REGRESSION_ORACLE_FAILED')
  if (failedC2Contract) signals.push('C2_MULTI_FILE_CONTRACT_FAILED')
  if (c2ProbeUntrustworthy) signals.push('C2_PROBE_UNTRUSTWORTHY')
  if (failedNonC2Criterion || (record.acceptanceCriteriaResults.length === 0 && record.status === 'INVALID')) {
    signals.push('ACCEPTANCE_CRITERION_FAILED')
  }
  if (!record.writablePathsValid) signals.push('WRITABLE_PATH_SCOPE_FAILED')
  if (!record.originalMessagesUnchanged) signals.push('ORIGINAL_MESSAGES_CHANGED')
  if (record.rawProviderPayloadsCaptured) signals.push('RAW_PROVIDER_PAYLOADS_CAPTURED')
  if (record.observationFailures.length > 0) signals.push('OBSERVATION_FAILURE')

  const isOnlyUntrustworthyC2Failure =
    record.status === 'INVALID' &&
    record.objectiveOracle.passed &&
    record.regressionOracle.passed &&
    record.writablePathsValid &&
    record.originalMessagesUnchanged &&
    !record.rawProviderPayloadsCaptured &&
    record.abortReason === null &&
    record.observationFailures.length === 0 &&
    failedCriteria.length === 1 &&
    c2ProbeUntrustworthy

  let failureClass: BenchmarkFailureClass | null = null
  if (record.status === 'INVALID') {
    failureClass = isOnlyUntrustworthyC2Failure ? 'HARNESS_CONTRACT_FAILURE' : 'TASK_FAILURE'
  }

  if (record.status === 'INVALID' && signals.length === 0) signals.push('ACCEPTANCE_CRITERION_FAILED')

  return { failureClass, failureSignals: signals }
}
