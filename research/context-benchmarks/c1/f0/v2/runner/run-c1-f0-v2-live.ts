import { runC1F0V2AuthorizedStudy, type C1F0V2LiveAuthorization } from './c1-f0-v2-live-binding'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for an authorized F0-v2 run`)
  }
  return value
}

const authorization: C1F0V2LiveAuthorization = {
  decision: 'AUTHORIZED',
  studyId: required('CANVAS_F0_V2_STUDY_ID'),
  executionRevision: required('CANVAS_F0_V2_EXECUTION_REVISION'),
  executionSurfaceHash: required('CANVAS_F0_V2_EXECUTION_SURFACE_HASH'),
  runContractSha256: required('CANVAS_F0_V2_RUN_CONTRACT_SHA256'),
  finalBoundRunContractSha256: required('CANVAS_F0_V2_FINAL_BOUND_RUN_CONTRACT_SHA256'),
  enrollmentManifestSha256: required('CANVAS_F0_V2_ENROLLMENT_MANIFEST_SHA256'),
  providerConfigHash: required('CANVAS_F0_V2_PROVIDER_CONFIG_HASH')
}

const repoRoot = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '')
const report = await runC1F0V2AuthorizedStudy({ repoRoot, authorization })

console.log(JSON.stringify(report, null, 2))
console.log(`C1_F0_V2_LIVE_STATUS=${report.status}`)
if (report.status !== 'GO_TO_T0_DESIGN') process.exitCode = 1
