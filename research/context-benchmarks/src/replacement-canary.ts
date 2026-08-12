import type {
  BenchmarkManifest,
  BenchmarkRunRecord,
  RepositoryObservationEvidence,
  ShadowCallEvidence
} from './types'

export const REPLACEMENT_CANARY_CATEGORY = 'C1-localized-bug-fix' as const
export const REPLACEMENT_CANARY_REPETITIONS = 1
export const REPLACEMENT_CANARY_RECORD_COUNT = 2

export interface ReplacementCanaryChecks {
  readonly exactRecordCount: boolean
  readonly exactCategoryAndTask: boolean
  readonly exactStrategyPair: boolean
  readonly exactRepetition: boolean
  readonly allRecordsValid: boolean
  readonly rawProviderPayloadsAbsent: boolean
  readonly retainedEvidenceSanitized: boolean
  readonly credentialValueAbsent: boolean
  readonly secretPatternsAbsent: boolean
  readonly revisionMismatchMaterializationAbsent: boolean
  readonly dirtyWorldUnavailableRecorded: boolean
  readonly lastKnownVersionPreserved: boolean
  readonly pinnedRepresentationRecovered: boolean
}

export interface ReplacementCanaryGateResult {
  readonly schemaVersion: 1
  readonly status: 'PASS' | 'FAIL'
  readonly recordCount: number
  readonly checks: ReplacementCanaryChecks
}

export function selectReplacementCanaryManifests(
  manifests: readonly BenchmarkManifest[]
): readonly BenchmarkManifest[] {
  const selected = manifests.filter((manifest) => manifest.category === REPLACEMENT_CANARY_CATEGORY)
  if (selected.length !== 1) {
    throw new Error(
      `replacement_canary_manifest_count_invalid:expected=1;actual=${selected.length}`
    )
  }
  return selected
}

export function benchmarkRecordIsValid(record: BenchmarkRunRecord): boolean {
  return (
    record.status === 'VALID' &&
    record.objectiveOracle.passed &&
    record.regressionOracle.passed &&
    record.acceptanceCriteriaPassed &&
    record.acceptanceCriteriaResults.length > 0 &&
    record.acceptanceCriteriaResults.every((criterion) => criterion.passed) &&
    record.writablePathsValid &&
    record.originalMessagesUnchanged &&
    !record.rawProviderPayloadsCaptured
  )
}

export function retainedEvidenceIsSanitized(serialized: string): boolean {
  // 只检查 durable record 中不应出现的机器绝对路径。repository/file://src/...
  // 是规范化 Source key，不属于本机路径。
  return !(
    /\/(?:private\/)?tmp\//.test(serialized) ||
    /\/(?:private\/)?var\/folders\//.test(serialized) ||
    /\/Users\//.test(serialized) ||
    /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(serialized)
  )
}

export function retainedEvidenceHasSecretPattern(serialized: string): boolean {
  return (
    /(?:DEEPSEEK|OPENAI|ANTHROPIC|GITHUB|AWS)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)/i.test(serialized) ||
    /Bearer\s+[A-Za-z0-9._-]{12,}/i.test(serialized) ||
    /sk-[A-Za-z0-9_-]{12,}/.test(serialized)
  )
}

function unavailableRevisionObservation(observation: RepositoryObservationEvidence): boolean {
  return observation.status === 'UNAVAILABLE' && observation.reasonCode === 'REVISION_MISMATCH'
}

function repositoryUnavailableEntries(call: ShadowCallEvidence) {
  return call.universe.entries.filter(
    (entry) =>
      entry.source.sourceKind === 'REPOSITORY_FILE' &&
      entry.state.observationStatus === 'UNAVAILABLE'
  )
}

function unavailableRevisionSourceKeys(record: BenchmarkRunRecord): ReadonlySet<string> {
  return new Set(
    (record.repositoryObservations ?? [])
      .filter(unavailableRevisionObservation)
      .map((observation) => `repository/file://${observation.path}`)
  )
}

export function evaluateReplacementCanaryGate(
  records: readonly BenchmarkRunRecord[],
  credentialValue?: string
): ReplacementCanaryGateResult {
  const serialized = JSON.stringify(records)
  const shadowRecords = records.filter((record) => record.strategy === 'SHADOW')
  const taskIds = new Set(records.map((record) => record.taskId))
  const strategies = [...records.map((record) => record.strategy)].sort()

  const revisionMismatchMaterializationAbsent = shadowRecords.every((record) =>
    record.shadowCalls.every((call) =>
      call.materializationFailures.every((failure) => !failure.includes('REVISION_MISMATCH'))
    )
  )
  const dirtyWorldUnavailableRecorded = shadowRecords.some(
    (record) => unavailableRevisionSourceKeys(record).size > 0
  )
  const lastKnownVersionPreserved = shadowRecords.some((record) =>
    record.shadowCalls.some((call) => {
      const observedUnavailableKeys = unavailableRevisionSourceKeys(record)
      return repositoryUnavailableEntries(call).some(
        (entry) =>
          observedUnavailableKeys.has(entry.source.sourceKey) &&
          entry.admittedVersion !== null &&
          entry.state.admittedVersionId === entry.admittedVersion.versionId &&
          entry.state.lastAvailableVersionId === entry.admittedVersion.versionId
      )
    })
  )
  const pinnedRepresentationRecovered = shadowRecords.some((record) =>
    record.shadowCalls.some((call) => {
      const observedUnavailableKeys = unavailableRevisionSourceKeys(record)
      return repositoryUnavailableEntries(call).some((entry) => {
        if (!observedUnavailableKeys.has(entry.source.sourceKey)) return false
        const admittedVersionId = entry.admittedVersion?.versionId
        if (admittedVersionId === undefined) return false
        return call.representations.some(
          ({ sourceKey, representation }) =>
            sourceKey === entry.source.sourceKey &&
            (representation.kind === 'FULL' || representation.kind === 'LINE_RANGE') &&
            representation.sourceVersionIds.includes(admittedVersionId)
        )
      })
    })
  )

  const checks: ReplacementCanaryChecks = {
    exactRecordCount: records.length === REPLACEMENT_CANARY_RECORD_COUNT,
    exactCategoryAndTask:
      records.every((record) => record.category === REPLACEMENT_CANARY_CATEGORY) &&
      taskIds.size === 1 &&
      taskIds.has('cr005-c1-localized-bug-fix'),
    exactStrategyPair:
      strategies.length === 2 && strategies[0] === 'NATIVE' && strategies[1] === 'SHADOW',
    exactRepetition: records.every(
      (record) => record.repetition === REPLACEMENT_CANARY_REPETITIONS
    ),
    allRecordsValid: records.every(benchmarkRecordIsValid),
    rawProviderPayloadsAbsent: records.every((record) => !record.rawProviderPayloadsCaptured),
    retainedEvidenceSanitized: retainedEvidenceIsSanitized(serialized),
    credentialValueAbsent:
      credentialValue === undefined ||
      credentialValue.length === 0 ||
      !serialized.includes(credentialValue),
    secretPatternsAbsent: !retainedEvidenceHasSecretPattern(serialized),
    revisionMismatchMaterializationAbsent,
    dirtyWorldUnavailableRecorded,
    lastKnownVersionPreserved,
    pinnedRepresentationRecovered
  }
  const passed = Object.values(checks).every(Boolean)
  return {
    schemaVersion: 1,
    status: passed ? 'PASS' : 'FAIL',
    recordCount: records.length,
    checks
  }
}
