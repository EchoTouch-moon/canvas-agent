import { sha256Hex } from '@canvas-agent/context-runtime'
import {
  benchmarkRecordIsValid,
  retainedEvidenceHasSecretPattern,
  retainedEvidenceIsSanitized
} from './replacement-canary'
import type {
  BenchmarkCategory,
  BenchmarkManifest,
  BenchmarkRunRecord,
  ContextStrategy
} from './types'

interface WaveATarget {
  readonly category: BenchmarkCategory
  readonly taskId: string
  readonly manifestFingerprint: string
  readonly fixtureIdentity: BenchmarkRunRecord['fixtureIdentity']
}

export const WAVE_A_TARGETS = [
  {
    category: 'C2-multi-file-feature',
    taskId: 'cr005-c2-multi-file-feature',
    manifestFingerprint:
      '8eacd176f3615471642d275f6f3db29f720d3e7edd2d767d54851d9e9c65ac2d',
    fixtureIdentity: {
      repositoryRevision: {
        baseCommit: 'f6fae2c899491d8c1f8ad343ae5738cb97e558fc',
        treeHash: '29ea520df7fd1f11c6a3ac8654d1ab2801927f7e',
        workingTreePatchHash: null
      },
      initialStateHash:
        '58af62a05eb673468e1ab5e158c0ec299c1f146f14f45b64985c0b75931d207c'
    }
  },
  {
    category: 'C3-failing-test-diagnosis',
    taskId: 'cr005-c3-failing-test-diagnosis',
    manifestFingerprint:
      'd9d79591dd3bfdbac736e9f56145c7f4acae6b345c81de974be97fe1081e0b78',
    fixtureIdentity: {
      repositoryRevision: {
        baseCommit: '4330f29e37309b349327b12c24d6064528c4bbd9',
        treeHash: 'c90cda0e5faf1beb44abebbd012669921a3e6569',
        workingTreePatchHash: null
      },
      initialStateHash:
        '09b2f1adb09efe1d04dd69c39b855b1708fd9b7b18403cd6750a359c6ba89cfd'
    }
  },
  {
    category: 'C4-constrained-refactor',
    taskId: 'cr005-c4-constrained-refactor',
    manifestFingerprint:
      '7dd89d22161b6289c1a7f951236f71364d39d8b91de70ffcfda02ee6cda9cedb',
    fixtureIdentity: {
      repositoryRevision: {
        baseCommit: '83187a56da63026fb161da3b828f10ed014f3e1f',
        treeHash: '758c13f8ba231579452404a9e6d3c3b6630b22cb',
        workingTreePatchHash: null
      },
      initialStateHash:
        'c47338e610585a750cad330c4b30c9915bc675076cd1f614ac8cea9f77e74159'
    }
  },
  {
    category: 'C5-unrelated-discovery',
    taskId: 'cr005-c5-unrelated-discovery',
    manifestFingerprint:
      'e0738b9644bd99de6d48de22c469a111bcf81a2439ff832a801f951e9be30017',
    fixtureIdentity: {
      repositoryRevision: {
        baseCommit: 'ea1ef1e328fcfd0fa72e64c67eae1ba9fb829ce8',
        treeHash: '893fde9b32b2bd4b3e052580c7d2d38a5fac893a',
        workingTreePatchHash: null
      },
      initialStateHash:
        '144d5e12693f52125c8e34a47a20739e7456a6824531e326e03386119af56f71'
    }
  },
  {
    category: 'C6-wrong-path-rehydration',
    taskId: 'cr005-c6-wrong-path-rehydration',
    manifestFingerprint:
      '955c20139dc11a12e5596aeaa3702c8367f15cce9f04b52c17cca3b7ede0fb03',
    fixtureIdentity: {
      repositoryRevision: {
        baseCommit: 'ae22d0e616df8e27b664c612f80703d9e0e443a5',
        treeHash: '695020a1deef724d43efd85c0b74187020b0a3fe',
        workingTreePatchHash: null
      },
      initialStateHash:
        '13fdae63bbfc5cb5a053d83e66e7e06c5007cd0885d7026544223329447ddc13'
    }
  }
] as const satisfies readonly WaveATarget[]

export const WAVE_A_REPETITIONS = 1
export const WAVE_A_RECORD_COUNT = WAVE_A_TARGETS.length * 2

export interface WaveAChecks {
  readonly exactRecordCount: boolean
  readonly exactCategoryAndTaskSet: boolean
  readonly exactStrategyPairPerTask: boolean
  readonly exactRepetition: boolean
  readonly exactRunIds: boolean
  readonly uniqueRunIds: boolean
  readonly allRecordsValid: boolean
  readonly exactFixtureIdentity: boolean
  readonly pairedFixtureIdentityMatches: boolean
  readonly pairedModelProfileMatches: boolean
  readonly exactModelProfile: boolean
  readonly rawProviderPayloadsAbsent: boolean
  readonly retainedEvidenceSanitized: boolean
  readonly credentialValueAbsent: boolean
  readonly secretPatternsAbsent: boolean
}

export interface WaveAGateResult {
  readonly schemaVersion: 1
  readonly status: 'PASS' | 'FAIL'
  readonly recordCount: number
  readonly checks: WaveAChecks
}

export function isWaveAExecutionAuthorized(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return environment['CANVAS_CR005_WAVE_A'] === '1'
}

function manifestExecutionFingerprint(manifest: BenchmarkManifest): string {
  return sha256Hex(
    JSON.stringify({
      taskId: manifest.taskId,
      category: manifest.category,
      title: manifest.title,
      fixtureVersion: manifest.fixtureVersion,
      fixturePath: manifest.fixturePath,
      referencePath: manifest.referencePath,
      repositoryRevision: {
        baseCommit: manifest.repositoryRevision.baseCommit,
        treeHash: manifest.repositoryRevision.treeHash,
        workingTreePatchHash: manifest.repositoryRevision.workingTreePatchHash
      },
      initialStateHash: manifest.initialStateHash,
      prompt: manifest.prompt,
      acceptanceCriteria: manifest.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
        check: criterion.check
      })),
      oracle: {
        command: manifest.oracle.command,
        args: manifest.oracle.args,
        expectedExitCode: manifest.oracle.expectedExitCode,
        timeoutMs: manifest.oracle.timeoutMs
      },
      regressionOracle: {
        command: manifest.regressionOracle.command,
        args: manifest.regressionOracle.args,
        expectedExitCode: manifest.regressionOracle.expectedExitCode,
        timeoutMs: manifest.regressionOracle.timeoutMs
      },
      allowedTools: manifest.allowedTools,
      expectedTools: manifest.expectedTools,
      modelProfile: {
        provider: manifest.modelProfile.provider,
        model: manifest.modelProfile.model,
        thinkingLevel: manifest.modelProfile.thinkingLevel
      },
      contextStrategies: manifest.contextStrategies,
      budget: {
        maxSemanticCalls: manifest.budget.maxSemanticCalls,
        maxToolCalls: manifest.budget.maxToolCalls,
        wallClockMs: manifest.budget.wallClockMs
      },
      expectedWritablePaths: manifest.expectedWritablePaths,
      retentionPolicy: manifest.retentionPolicy,
      knownCandidatePaths: manifest.knownCandidatePaths,
      knownRelevantPaths: manifest.knownRelevantPaths,
      knownIrrelevantPaths: manifest.knownIrrelevantPaths,
      expectedArchitecturalRules: manifest.expectedArchitecturalRules
    })
  )
}

export function selectWaveAManifests(
  manifests: readonly BenchmarkManifest[]
): readonly BenchmarkManifest[] {
  return WAVE_A_TARGETS.map((target) => {
    const matches = manifests.filter(
      (manifest) => manifest.category === target.category
    )
    if (matches.length !== 1) {
      throw new Error(
        `wave_a_manifest_count_invalid:category=${target.category};expected=1;actual=${matches.length}`
      )
    }
    const manifest = matches[0]
    if (manifest === undefined || manifest.taskId !== target.taskId) {
      throw new Error(
        `wave_a_manifest_task_invalid:category=${target.category};expected=${target.taskId};actual=${manifest?.taskId ?? 'missing'}`
      )
    }
    const fingerprint = manifestExecutionFingerprint(manifest)
    if (fingerprint !== target.manifestFingerprint) {
      throw new Error(
        `wave_a_manifest_fingerprint_invalid:category=${target.category};expected=${target.manifestFingerprint};actual=${fingerprint}`
      )
    }
    return manifest
  })
}

function recordsForTarget(
  records: readonly BenchmarkRunRecord[],
  target: WaveATarget
): readonly BenchmarkRunRecord[] {
  return records.filter(
    (record) =>
      record.category === target.category && record.taskId === target.taskId
  )
}

function exactStrategyPair(records: readonly BenchmarkRunRecord[]): boolean {
  const strategies = records.map((record) => record.strategy).sort()
  return (
    strategies.length === 2 &&
    strategies[0] === 'NATIVE' &&
    strategies[1] === 'SHADOW'
  )
}

function expectedRunIds(): ReadonlySet<string> {
  const strategies = [
    'NATIVE',
    'SHADOW'
  ] as const satisfies readonly ContextStrategy[]
  return new Set(
    WAVE_A_TARGETS.flatMap((target) =>
      strategies.map(
        (strategy) =>
          `${target.taskId}-${strategy.toLowerCase()}-r${WAVE_A_REPETITIONS}`
      )
    )
  )
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

function pairHasMatchingFixtureIdentity(
  records: readonly BenchmarkRunRecord[]
): boolean {
  if (records.length !== 2) return false
  const [first, second] = records
  if (first === undefined || second === undefined) return false
  return (
    JSON.stringify(first.fixtureIdentity) ===
    JSON.stringify(second.fixtureIdentity)
  )
}

function recordHasExactFixtureIdentity(record: BenchmarkRunRecord): boolean {
  const target = WAVE_A_TARGETS.find(
    (candidate) =>
      candidate.category === record.category &&
      candidate.taskId === record.taskId
  )
  return (
    target !== undefined &&
    JSON.stringify(record.fixtureIdentity) ===
      JSON.stringify(target.fixtureIdentity)
  )
}

function pairHasMatchingModelProfile(
  records: readonly BenchmarkRunRecord[]
): boolean {
  if (records.length !== 2) return false
  const [first, second] = records
  if (first === undefined || second === undefined) return false
  return (
    JSON.stringify(first.modelProfile) === JSON.stringify(second.modelProfile)
  )
}

export function evaluateWaveAGate(
  records: readonly BenchmarkRunRecord[],
  credentialValue?: string
): WaveAGateResult {
  const serialized = JSON.stringify(records)
  const targetRecordGroups = WAVE_A_TARGETS.map((target) =>
    recordsForTarget(records, target)
  )
  const actualRunIds = records.map((record) => record.runId)
  const expectedIds = expectedRunIds()
  const exactCategoryAndTaskSet = records.every((record) =>
    WAVE_A_TARGETS.some(
      (target) =>
        target.category === record.category && target.taskId === record.taskId
    )
  )

  const checks: WaveAChecks = {
    exactRecordCount: records.length === WAVE_A_RECORD_COUNT,
    exactCategoryAndTaskSet:
      exactCategoryAndTaskSet &&
      targetRecordGroups.every((group) => group.length === 2),
    exactStrategyPairPerTask: targetRecordGroups.every(exactStrategyPair),
    exactRepetition: records.every(
      (record) => record.repetition === WAVE_A_REPETITIONS
    ),
    exactRunIds: setsEqual(new Set(actualRunIds), expectedIds),
    uniqueRunIds: new Set(actualRunIds).size === records.length,
    allRecordsValid: records.every(benchmarkRecordIsValid),
    exactFixtureIdentity: records.every(recordHasExactFixtureIdentity),
    pairedFixtureIdentityMatches: targetRecordGroups.every(
      pairHasMatchingFixtureIdentity
    ),
    pairedModelProfileMatches: targetRecordGroups.every(
      pairHasMatchingModelProfile
    ),
    exactModelProfile: records.every(
      (record) =>
        record.modelProfile.provider === 'deepseek' &&
        record.modelProfile.model === 'deepseek-v4-flash' &&
        record.modelProfile.thinkingLevel === 'medium'
    ),
    rawProviderPayloadsAbsent: records.every(
      (record) => !record.rawProviderPayloadsCaptured
    ),
    retainedEvidenceSanitized: retainedEvidenceIsSanitized(serialized),
    credentialValueAbsent:
      credentialValue === undefined ||
      credentialValue.length === 0 ||
      !serialized.includes(credentialValue),
    secretPatternsAbsent: !retainedEvidenceHasSecretPattern(serialized)
  }

  return {
    schemaVersion: 1,
    status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    recordCount: records.length,
    checks
  }
}
