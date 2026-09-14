import { resolve } from 'node:path'
import { runC1F0V2CredentialFreeStudy } from '../c1/f0/v2/runner/c1-f0-v2-execution-runner'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const report = await runC1F0V2CredentialFreeStudy({ repoRoot })

console.log(JSON.stringify(report, null, 2))
console.log('C1_F0_V2_CREDENTIAL_FREE_STATUS=' + report.status)
