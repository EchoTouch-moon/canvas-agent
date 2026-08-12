import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AcceptanceCriterionResult,
  BenchmarkAcceptanceCriterion,
  BenchmarkManifest,
  OracleResult
} from './types'

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

const C2_CONTRACT_FILES = ['src/config.js', 'src/greeting.js', 'src/index.js'] as const

function hasAll(source: string, fragments: readonly string[]): boolean {
  return fragments.every((fragment) => source.includes(fragment))
}

function readFailureEvidence(error: unknown): string {
  return error instanceof Error && error.name === 'AbortError'
    ? 'read_failed:aborted'
    : 'read_failed:unavailable'
}

export async function evaluateC2MultiFileContract(
  fixturePath: string
): Promise<DeterministicAcceptanceEvidence> {
  try {
    const [config, greeting, index] = await Promise.all([
      readFile(join(fixturePath, C2_CONTRACT_FILES[0]), 'utf8'),
      readFile(join(fixturePath, C2_CONTRACT_FILES[1]), 'utf8'),
      readFile(join(fixturePath, C2_CONTRACT_FILES[2]), 'utf8')
    ])
    const checks = {
      config: hasAll(config, [
        'DEFAULT_GREETING',
        'DEFAULT_PUNCTUATION',
        'module.exports = { DEFAULT_GREETING, DEFAULT_PUNCTUATION }'
      ]),
      greeting: hasAll(greeting, [
        "require('./config')",
        'options.formal === true',
        'DEFAULT_PUNCTUATION'
      ]),
      index: hasAll(index, [
        "require('./greeting')",
        'makeGreeting(profile.name',
        'profile.formal === true'
      ])
    }
    const passed = Object.values(checks).every(Boolean)
    return {
      passed,
      evidence: `c2MultiFileContract:config=${String(checks.config)};greeting=${String(checks.greeting)};index=${String(checks.index)}`
    }
  } catch (error) {
    return { passed: false, evidence: `c2MultiFileContract:${readFailureEvidence(error)}` }
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
