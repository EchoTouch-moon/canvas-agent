import { join, resolve } from 'node:path'
import { aggregateRuns } from './aggregation'
import { loadManifests } from './manifest'
import { runLiveCorpus } from './live-runner'
import {
  evaluateReplacementCanaryGate,
  REPLACEMENT_CANARY_REPETITIONS,
  selectReplacementCanaryManifests
} from './replacement-canary'
import { formatValidationSummary, validateCorpus } from './validation'
import {
  evaluateWaveAGate,
  isWaveAExecutionAuthorized,
  selectWaveAManifests,
  WAVE_A_REPETITIONS
} from './wave-a'

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
    const manifests = selectWaveAManifests(await loadManifests(researchRoot))
    const live = await runLiveCorpus({
      researchRoot,
      manifests,
      repetitions: WAVE_A_REPETITIONS,
      outputDirectory: join(researchRoot, '.live-output', 'wave-a')
    })
    if (live.skipped) {
      console.log(`CR-005 Wave A skipped: ${live.skipReason ?? 'unknown'}`)
      console.log('WAVE_A_STATUS=SKIPPED')
      process.exitCode = 1
      return
    }
    const gate = evaluateWaveAGate(
      live.records,
      process.env['DEEPSEEK_API_KEY']
    )
    console.log(JSON.stringify(gate))
    console.log(`CR-005 Wave A output: ${live.outputPath ?? 'none'}`)
    console.log(`WAVE_A_STATUS=${gate.status}`)
    if (gate.status !== 'PASS') process.exitCode = 1
    return
  }
  throw new Error(`unknown benchmark command: ${command}`)
}

await main()
