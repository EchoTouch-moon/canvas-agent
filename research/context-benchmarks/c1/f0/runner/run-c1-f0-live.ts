import { resolve } from 'node:path'
import { runC1F0AuthorizedStudy, type C1F0LiveAuthorization } from './c1-f0-live-binding'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for an authorized F0 run`)
  }
  return value
}

const authorization: C1F0LiveAuthorization = {
  decision: 'AUTHORIZED',
  studyId: required('CANVAS_F0_STUDY_ID'),
  executionRevision: required('CANVAS_F0_EXECUTION_SHA'),
  executionSurfaceHash: required('CANVAS_F0_EXECUTION_SURFACE_HASH'),
  runContractSha256: required('CANVAS_F0_RUN_CONTRACT_SHA'),
  providerConfigHash: required('CANVAS_F0_PROVIDER_CONFIG_HASH')
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..', '..')
const report = await runC1F0AuthorizedStudy({ repoRoot, authorization })

console.log(JSON.stringify(report, null, 2))
console.log(`C1_F0_LIVE_STATUS=${report.status}`)
if (report.status !== 'GO_TO_T0_DESIGN') process.exitCode = 1
