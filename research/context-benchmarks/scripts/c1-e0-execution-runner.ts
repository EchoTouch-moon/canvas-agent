import { resolve } from 'node:path'
import {
  C1_E0_FAKE_SCENARIOS,
  runC1E0CredentialFreeStudy,
  type C1E0FakeScenario
} from '../src/c1-e0-execution-runner'

const scenario = process.argv[2] ?? C1_E0_FAKE_SCENARIOS[0]
if (!(C1_E0_FAKE_SCENARIOS as readonly string[]).includes(scenario)) {
  throw new Error(`unknown E0 fake scenario: ${scenario}`)
}

const report = await runC1E0CredentialFreeStudy({
  repoRoot: resolve(import.meta.dirname, '../../..'),
  scenario: scenario as C1E0FakeScenario
})

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = report.status === 'PASS' ? 0 : 1
