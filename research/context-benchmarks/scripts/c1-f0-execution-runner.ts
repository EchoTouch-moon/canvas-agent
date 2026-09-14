import { resolve } from 'node:path'
import { runC1F0CredentialFreeStudy } from '../c1/f0/runner/c1-f0-execution-runner'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const report = await runC1F0CredentialFreeStudy({ repoRoot })

console.log(JSON.stringify(report, null, 2))
console.log(`C1_F0_CREDENTIAL_FREE_STATUS=${report.status}`)
if (report.status !== 'GO_TO_T0_DESIGN') process.exitCode = 1
