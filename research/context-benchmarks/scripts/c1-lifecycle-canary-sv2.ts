import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256,
  runC1LifecycleCanarySv2,
  type C1LifecycleCanarySv2Authorization
} from '../src/c1-lifecycle-canary-sv2'

const [mode, bindingPath, outputRoot] = process.argv.slice(2)
if (
  (mode !== '--fake' && mode !== '--live') ||
  bindingPath === undefined ||
  outputRoot === undefined
) {
  throw new Error('Usage: c1-lifecycle-canary-sv2.ts --fake|--live binding.json output-directory')
}

const binding = JSON.parse(await readFile(bindingPath, 'utf8')) as {
  decision: 'AUTHORIZED' | 'FAKE_ONLY'
  studyId: string
  executionRevision: string
  contractSha256: string
}
if (binding.contractSha256 !== C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256) {
  throw new Error('SV2 contract SHA mismatch')
}

const report = await runC1LifecycleCanarySv2({
  mode: mode === '--live' ? 'LIVE' : 'FAKE',
  repoRoot: resolve(import.meta.dirname, '../../..'),
  outputRoot: resolve(outputRoot),
  studyId: binding.studyId,
  executionRevision: binding.executionRevision,
  ...(mode === '--live'
    ? {
        authorization: binding as C1LifecycleCanarySv2Authorization,
        getApiKey: () => {
          const apiKey = process.env['STEP_PLAN_API_KEY']
          if (apiKey === undefined || apiKey.length === 0)
            throw new Error('STEP_PLAN_API_KEY is unavailable')
          return apiKey
        }
      }
    : {})
})
process.stdout.write(
  `${JSON.stringify({
    status: report.status,
    studyId: report.studyId,
    providerCalls: report.providerCalls,
    networkRequests: report.networkRequests,
    fakeResponses: report.fakeResponses,
    replayRecords: report.replayRecords,
    removedSourceKeys: report.removedSourceKeys,
    failureCode: report.failureCode
  })}\n`
)
if (report.status !== 'PASS') process.exitCode = 1
