import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  runC1MechanismCanary,
  type C1MechanismCanaryAuthorization
} from '../src/c1-mechanism-canary'

const [mode, authorizationPath, outputRoot] = process.argv.slice(2)
if ((mode !== '--fake' && mode !== '--live') || !authorizationPath || !outputRoot) {
  throw new Error('Usage: c1-mechanism-canary.ts --fake|--live binding.json output-directory')
}
const binding = JSON.parse(
  await readFile(authorizationPath, 'utf8')
) as C1MechanismCanaryAuthorization
const report = await runC1MechanismCanary({
  mode: mode === '--live' ? 'LIVE' : 'FAKE',
  repoRoot: resolve(import.meta.dirname, '../../..'),
  outputRoot: resolve(outputRoot),
  studyId: binding.studyId,
  executionRevision: binding.executionRevision,
  contractSha256: binding.contractSha256,
  ...(mode === '--live'
    ? {
        authorization: binding,
        getApiKey: () => {
          const apiKey = process.env['STEP_PLAN_API_KEY']
          if (!apiKey) throw new Error('Step Plan credential unavailable')
          return apiKey
        }
      }
    : {})
})
process.stdout.write(
  JSON.stringify({
    status: report.status,
    studyId: report.studyId,
    providerCalls: report.providerCalls,
    fakeResponses: report.fakeResponses,
    failureCode: report.failureCode
  }) + '\n'
)
if (report.status !== 'PASS') process.exitCode = 1
