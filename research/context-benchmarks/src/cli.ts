import { join, resolve } from 'node:path'
import { aggregateRuns } from './aggregation'
import { buildSanitizedChildEnvironment, runProcess } from './fixture-generator'
import { loadManifests } from './manifest'
import { runLiveCorpus, runProgressiveWaveA } from './live-runner'
import {
  evaluateReplacementCanaryGate,
  REPLACEMENT_CANARY_REPETITIONS,
  selectReplacementCanaryManifests
} from './replacement-canary'
import { formatValidationSummary, validateCorpus } from './validation'
import {
  isWaveAExecutionAuthorized,
  selectWaveAManifests
} from './wave-a'
import { runC1TreatmentReadiness } from './c1-treatment-readiness'
import { runC1LivePreflight } from './c1-live-preflight'

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'validate'
  const researchRoot = resolve(import.meta.dirname, '..')
  if (command === 'validate') {
    const result = await validateCorpus(researchRoot)
    console.log(formatValidationSummary(result))
    if (!result.credentialFreeReady) process.exitCode = 1
    return
  }
  if (command === 'live') {
    if (process.env['CANVAS_CR005_LIVE'] !== '1') {
      console.log('CR-005 live run skipped: CANVAS_CR005_LIVE=1 is required')
      return
    }
    const manifests = await loadManifests(researchRoot)
    const live = await runLiveCorpus({ researchRoot, manifests })
    if (live.skipped) {
      console.log(`CR-005 live run skipped: ${live.skipReason ?? 'unknown'}`)
      console.log('LIVE_STATUS=SKIPPED')
      return
    }
    const aggregate = aggregateRuns(live.records)
    console.log(`CR-005 live records: ${live.records.length}`)
    console.log(`CR-005 valid records: ${aggregate.validRuns}`)
    console.log(`CR-005 metadata output: ${live.outputPath ?? 'none'}`)
    console.log('LIVE_STATUS=EXECUTED')
    return
  }
  if (command === 'replacement-canary') {
    if (process.env['CANVAS_CR005_REPLACEMENT_CANARY'] !== '1') {
      console.log(
        'CR-005 replacement canary skipped: CANVAS_CR005_REPLACEMENT_CANARY=1 is required'
      )
      console.log('REPLACEMENT_CANARY_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const manifests = selectReplacementCanaryManifests(await loadManifests(researchRoot))
    const live = await runLiveCorpus({
      researchRoot,
      manifests,
      repetitions: REPLACEMENT_CANARY_REPETITIONS,
      outputDirectory: join(researchRoot, '.live-output', 'replacement-canary')
    })
    if (live.skipped) {
      console.log(`CR-005 replacement canary skipped: ${live.skipReason ?? 'unknown'}`)
      console.log('REPLACEMENT_CANARY_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const gate = evaluateReplacementCanaryGate(live.records, process.env['DEEPSEEK_API_KEY'])
    console.log(JSON.stringify(gate))
    console.log(`CR-005 replacement canary output: ${live.outputPath ?? 'none'}`)
    console.log(`REPLACEMENT_CANARY_STATUS=${gate.status}`)
    if (gate.status !== 'PASS') process.exitCode = 1
    return
  }
  if (command === 'wave-a') {
    if (!isWaveAExecutionAuthorized(process.env)) {
      console.log('CR-005 Wave A skipped: CANVAS_CR005_WAVE_A=1 is required')
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const nodeMajor = Number(process.versions.node.split('.')[0])
    if (nodeMajor !== 24) {
      console.log('CR-005 Wave A skipped: node_24_required')
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const expectedBaselineSha = process.env['CANVAS_CR005_WAVE_A_BASELINE_SHA']
    if (expectedBaselineSha === undefined || expectedBaselineSha.length === 0) {
      console.log(
        'CR-005 Wave A skipped: CANVAS_CR005_WAVE_A_BASELINE_SHA is required'
      )
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const baseline = await runProcess(
      'git',
      ['rev-parse', 'HEAD'],
      {
        cwd: resolve(researchRoot, '../..'),
        timeoutMs: 30_000,
        env: buildSanitizedChildEnvironment()
      }
    )
    const currentBaselineSha = baseline.exitCode === 0 ? baseline.stdout.trim() : null
    if (currentBaselineSha === null || currentBaselineSha !== expectedBaselineSha) {
      console.log('CR-005 Wave A skipped: baseline_sha_mismatch')
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const worktree = await runProcess(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      {
        cwd: resolve(researchRoot, '../..'),
        timeoutMs: 30_000,
        env: buildSanitizedChildEnvironment()
      }
    )
    if (worktree.exitCode !== 0 || worktree.stdout.trim().length > 0) {
      console.log('CR-005 Wave A skipped: worktree_not_clean')
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const manifests = selectWaveAManifests(await loadManifests(researchRoot))
    const progressiveOptions = {
      researchRoot,
      manifests,
      baselineSha: currentBaselineSha,
      providerExecutionAuthorized: true,
      resume: process.env['CANVAS_CR005_WAVE_A_RESUME'] === '1',
      outputDirectory: join(researchRoot, '.live-output', 'wave-a')
    } as const
    const configuredRunId = process.env['CANVAS_CR005_WAVE_A_RUN_ID']
    const live = await runProgressiveWaveA(
      configuredRunId === undefined
        ? progressiveOptions
        : { ...progressiveOptions, runId: configuredRunId }
    )
    if (live.skipped) {
      console.log(`CR-005 Wave A skipped: ${live.skipReason ?? 'unknown'}`)
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    console.log(`CR-005 Wave A records: ${live.records.length}`)
    console.log(`CR-005 Wave A completed pairs: ${live.completedPairs}`)
    console.log(`CR-005 Wave A output: ${live.outputPath ?? 'none'}`)
    console.log(`WAVE_A_STATUS=${live.status}`)
    if (live.status !== 'PASS') process.exitCode = 1
    return
  }
  if (command === 'c1-readiness') {
    const report = runC1TreatmentReadiness()
    console.log(JSON.stringify(report, null, 2))
    console.log(`C1_C_READINESS_STATUS=${report.overallVerdict}`)
    if (report.overallVerdict !== 'PASS') process.exitCode = 1
    return
  }
  if (command === 'c1-live-preflight') {
    const report = await runC1LivePreflight()
    console.log(JSON.stringify(report, null, 2))
    console.log(`C1_LIVE_PREFLIGHT_STATUS=${report.status}`)
    if (report.status !== 'PASS') process.exitCode = 1
    return
  }
  throw new Error(`unknown benchmark command: ${command}`)
}

await main()
