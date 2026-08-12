import { createRequire, Module } from 'node:module'
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

function readExport(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return Object.entries(value).find(([candidate]) => candidate === key)?.[1]
}

function invoke(value: unknown, args: readonly unknown[]): unknown {
  return typeof value === 'function' ? Reflect.apply(value, undefined, args) : undefined
}

function createProbeModule(path: string, exports: unknown): Module {
  const probe = new Module(path)
  probe.filename = path
  probe.loaded = true
  probe.exports = exports
  return probe
}

export function evaluateC2MultiFileContract(
  fixturePath: string
): DeterministicAcceptanceEvidence {
  const indexPath = join(fixturePath, 'src/index.js')
  const greetingPath = join(fixturePath, 'src/greeting.js')
  const configPath = join(fixturePath, 'src/config.js')
  const modulePaths = [configPath, greetingPath, indexPath] as const
  try {
    const fixtureRequire = createRequire(indexPath)
    const originalCache = new Map(modulePaths.map((path) => [path, fixtureRequire.cache[path]] as const))
    const clearContractCache = (): void => {
      for (const path of modulePaths) delete fixtureRequire.cache[path]
    }
    const restoreContractCache = (): void => {
      for (const [path, entry] of originalCache) {
        if (entry === undefined) delete fixtureRequire.cache[path]
        else fixtureRequire.cache[path] = entry
      }
    }

    try {
      clearContractCache()
      const config: unknown = fixtureRequire(configPath)
      const configExportsValid =
        readExport(config, 'DEFAULT_GREETING') === 'Hello' &&
        readExport(config, 'DEFAULT_PUNCTUATION') === '!'

      const probePunctuation = '<probe-punctuation>'
      fixtureRequire.cache[configPath] = createProbeModule(configPath, {
          DEFAULT_GREETING: 'ProbeGreeting',
          DEFAULT_PUNCTUATION: probePunctuation
        })
      delete fixtureRequire.cache[greetingPath]
      const greeting: unknown = fixtureRequire(greetingPath)
      const makeGreeting = readExport(greeting, 'makeGreeting')
      const greetingDefault = invoke(makeGreeting, ['Ada', { formal: false }])
      const greetingFormal = invoke(makeGreeting, ['Ada', { formal: true }])
      const greetingConsumesFormalAndConfig =
        greetingDefault === 'ProbeGreeting, Ada' &&
        greetingFormal === `ProbeGreeting, Ada${probePunctuation}`

      const forwardedCalls: { readonly name: unknown; readonly options: unknown }[] = []
      const forwardedResult = 'INDEX_FORWARDED_SENTINEL'
      fixtureRequire.cache[greetingPath] = createProbeModule(greetingPath, {
          makeGreeting: (name: unknown, options: unknown): string => {
            forwardedCalls.push({ name, options })
            return forwardedResult
          }
        })
      delete fixtureRequire.cache[indexPath]
      const index: unknown = fixtureRequire(indexPath)
      const greetProfile = readExport(index, 'greetProfile')
      const indexOutput = invoke(greetProfile, [{ name: 'Ada', formal: true }])
      const firstForwardedCall = forwardedCalls[0]
      const indexForwardsFormal =
        forwardedCalls.length === 1 &&
        indexOutput === forwardedResult &&
        firstForwardedCall?.name === 'Ada' &&
        readExport(firstForwardedCall.options, 'formal') === true

      const checks = {
        config: configExportsValid,
        greeting: greetingConsumesFormalAndConfig,
        index: indexForwardsFormal
      }
      const passed = Object.values(checks).every(Boolean)
      return {
        passed,
        evidence: `c2MultiFileContract:configRuntime=${String(checks.config)};greetingRuntime=${String(checks.greeting)};indexForwarding=${String(checks.index)}`
      }
    } finally {
      restoreContractCache()
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
