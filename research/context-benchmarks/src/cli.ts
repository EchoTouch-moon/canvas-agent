import { resolve } from 'node:path'
import { aggregateRuns } from './aggregation'
import { loadManifests } from './manifest'
import { runLiveCorpus } from './live-runner'
import { formatValidationSummary, validateCorpus } from './validation'

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
  throw new Error(`unknown benchmark command: ${command}`)
}

await main()
