import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runProcess, buildSanitizedChildEnvironment } from './fixture-generator'
import {
  C1AuthorizedProviderResponseSource,
  C1_AUTHORIZED_PROVIDER_MAX_TOKENS
} from './c1-authorized-provider'
import { deriveC1CallAccounting } from './c1-call-accounting'
import {
  applyC1DuplicateReadPolicy,
  c1KnownCommittedSourceKeys,
  C1_DUPLICATE_READ_POLICY_ID
} from './c1-duplicate-read-policy'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  type C1LiveResponseSource,
  type C1LiveBindingLegResult
} from './c1-live-binding'
import {
  C1HardBudgetGuard,
  C1PreflightFailure,
  computeC1FixtureContentSummary,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  type C1PreflightTask
} from './c1-live-preflight'
import {
  assertC1LiveExecutionRevision,
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource
} from './c1-live-study'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const MARKER = 'COBALT-17'
const CONTENT = `# Synthetic mechanism diagnostic\nThe diagnostic marker is ${MARKER}.\nThis file contains no project or personal data.\n`
const PROMPT =
  'This is a read-only mechanism diagnostic. Call read on README.md twice, one call at a time, even though the bootstrap already contains it. Then reply with only the diagnostic marker from that file. Do not call edit or bash or any other tool. Do not read any other path.'
export const C1_MECHANISM_CANARY_CONTRACT = Object.freeze({
  contractId: 'C1_MECHANISM_CANARY_V1',
  studyKind: 'CONTROLLED_MECHANISM_NOT_EFFECTIVENESS',
  policyId: C1_DUPLICATE_READ_POLICY_ID,
  provider: 'step-plan',
  model: 'step-3.7-flash',
  arms: ['NATIVE', 'RUNTIME'],
  maxLegs: 2,
  maxRequestsPerLeg: 3,
  maxRequests: 6,
  maxReadExecutionsPerLeg: 2,
  maxToolExecutions: 4,
  requestTimeoutMs: 30000,
  maxWallClockMsPerLeg: 120000,
  maxWallClockMs: 240000,
  maxOutputTokensPerRequest: C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
  fixture: {
    kind: 'INLINE_SYNTHETIC',
    path: 'README.md',
    contentSha256: sha256(CONTENT),
    fixtureContentSha256: sha256(`${sha256(CONTENT)}  README.md\n`),
    gitTreeObjectId: inlineTreeId()
  },
  promptSha256: sha256(PROMPT),
  allowedTool: 'read',
  allowedPath: 'README.md',
  terminalIdentity: 'SINGLE_USE_NO_RESUME',
  fallback: 'NONE',
  efficacyClaims: false
})
export const C1_MECHANISM_CANARY_CONTRACT_SHA256 = sha256(
  JSON.stringify(C1_MECHANISM_CANARY_CONTRACT)
)

export interface C1MechanismCanaryAuthorization {
  readonly decision: 'AUTHORIZED'
  readonly studyId: string
  readonly executionRevision: string
  readonly contractSha256: string
}

// Real Git object identities for the inline one-file tree, calculated without
// inserting objects into the repository. The fixture is content-addressed, not a checkout.
function inlineTreeId(): string {
  const content = Buffer.from(CONTENT)
  const blob = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest()
  const tree = Buffer.concat([Buffer.from('100644 README.md\0'), blob])
  return createHash('sha1').update(`tree ${tree.length}\0`).update(tree).digest('hex')
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function writeExclusiveDurable(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
  await syncDirectory(dirname(path))
}

export async function runC1MechanismCanary(options: {
  readonly mode: 'FAKE' | 'LIVE'
  readonly repoRoot: string
  readonly outputRoot: string
  readonly studyId: string
  readonly executionRevision: string
  readonly authorization?: C1MechanismCanaryAuthorization
  /** Invoked only after all local gates and exclusive identity claim. */
  readonly getApiKey?: () => string
  /** Only the FAKE mode accepts a scripted test source. */
  readonly fakeSourceFactory?: (arm: 'NATIVE' | 'RUNTIME') => C1LiveResponseSource
}) {
  const contract = C1_MECHANISM_CANARY_CONTRACT
  if (!nodeVersionSatisfiesC1Range()) throw new Error('Canary requires Node 24')
  if (!/^c1-mechanism-\d{8}-[a-f0-9]{8}$/.test(options.studyId))
    throw new Error('Invalid canary study identity')
  if (options.mode === 'LIVE') {
    const auth = options.authorization
    if (
      auth?.decision !== 'AUTHORIZED' ||
      auth.studyId !== options.studyId ||
      auth.executionRevision !== options.executionRevision ||
      auth.contractSha256 !== C1_MECHANISM_CANARY_CONTRACT_SHA256 ||
      options.fakeSourceFactory !== undefined ||
      options.getApiKey === undefined
    ) {
      throw new Error('Live canary requires exact owner authorization')
    }
    await assertC1LiveExecutionRevision(options.repoRoot, options.executionRevision)
    await assertC1LiveWorktreeClean(options.repoRoot)
    // A permanent claim shared by all worktrees prevents reusing a terminal
    // identity merely by changing the output directory. It is never released.
    const gitDir = await runProcess('git', ['rev-parse', '--git-common-dir'], {
      cwd: options.repoRoot,
      timeoutMs: 30000,
      env: buildSanitizedChildEnvironment()
    })
    if (gitDir.exitCode !== 0 || !gitDir.stdout.trim())
      throw new Error('Cannot locate canary identity registry')
    const registry = resolve(options.repoRoot, gitDir.stdout.trim(), 'c1-mechanism-identities')
    await mkdir(registry, { recursive: true, mode: 0o700 })
    await syncDirectory(dirname(registry))
    await writeExclusiveDurable(join(registry, `${options.studyId}.json`), {
      studyId: options.studyId,
      executionRevision: options.executionRevision,
      contractSha256: C1_MECHANISM_CANARY_CONTRACT_SHA256,
      consumed: true,
      resume: 'FORBIDDEN'
    })
  }
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 })
  const reportDir = join(options.outputRoot, options.studyId)
  await mkdir(reportDir, { mode: 0o700 }) // Exclusive, never resumed, even after a crash.
  const sink = new C1JsonlLiveBindingEvidenceSink(join(reportDir, 'checkpoints.jsonl'))
  const completed = new Set<string>()
  const legs: {
    arm: string
    runId: string
    status: string
    responses: number
    tools: number
    changedCalls: number[]
    answerMatched: boolean
  }[] = []
  let binding: Awaited<ReturnType<typeof prepareC1StrictProvider>> | undefined
  let failureCode: string | null = null
  let providerCalls = 0
  let networkRequests = 0
  let fakeResponses = 0
  let attemptedLegs = 0
  const abort = new AbortController()
  const stop = (): void => abort.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await writeExclusiveDurable(join(reportDir, 'binding.json'), {
      contract,
      contractSha256: C1_MECHANISM_CANARY_CONTRACT_SHA256,
      studyId: options.studyId,
      executionRevision: options.executionRevision,
      mode: options.mode,
      claimed: true,
      resume: 'FORBIDDEN'
    })
    binding = await prepareC1StrictProvider({ runIdentity: options.studyId })
    const apiKey = options.mode === 'LIVE' ? options.getApiKey!() : null
    const driver = new C1LiveBindingDriver({
      providerBinding: binding,
      evidenceSink: sink,
      budgetGuard: new C1HardBudgetGuard({
        perLeg: { maxProviderCalls: 3, maxToolCalls: 2, maxWallClockMs: 120000 },
        study: { maxProviderCalls: 6, maxToolCalls: 4, maxWallClockMs: 240000, maxLegs: 2 }
      })
    })
    for (const arm of ['NATIVE', 'RUNTIME'] as const) {
      if (abort.signal.aborted)
        throw new C1PreflightFailure('KILL_SWITCH_BLOCKED', 'canary stopped')
      attemptedLegs += 1
      const root = await mkdtemp(join(tmpdir(), 'c1-mechanism-fixture-'))
      try {
        await writeFile(join(root, 'README.md'), CONTENT)
        const summary = await computeC1FixtureContentSummary(root)
        if (summary.sha256 !== contract.fixture.fixtureContentSha256 || summary.fileCount !== 1)
          throw new Error('Canary fixture binding mismatch')
        const task: C1PreflightTask = {
          taskId: 'c1-mechanism-duplicate-read-v1',
          stratum: 'CONTROLLED_READ_ONLY',
          title: 'Read-only duplicate context mechanism',
          fixtureVersion: 'INLINE_SYNTHETIC_V1',
          fixturePath: 'INLINE_SYNTHETIC/README.md',
          fixtureRevision: {
            baseRevision: options.executionRevision,
            fixtureTreeObjectId: inlineTreeId(),
            fixtureContentSha256: summary.sha256
          },
          prompt: PROMPT,
          promptSha256: contract.promptSha256,
          // Not executed: this diagnostic evaluates the final in-memory response only.
          objectiveOracle: { command: 'node', args: [], expectedExitCode: 0, timeoutMs: 1 },
          regressionOracle: { command: 'node', args: [], expectedExitCode: 0, timeoutMs: 1 },
          expectedWritablePaths: [],
          relevantSources: [],
          distractorSources: [],
          requiredLaterSources: []
        }
        const runId = `${options.studyId}-${arm}`
        const observations = await C1LiveTaskObservationSource.fromFixture({
          task,
          runId: 'mechanism-shared-bootstrap',
          fixtureRoot: root
        })
        let answerMatched = false
        const source =
          options.mode === 'LIVE'
            ? new C1AuthorizedProviderResponseSource({
                providerBinding: binding,
                apiKey: apiKey!,
                requestTimeoutMs: contract.requestTimeoutMs,
                fetchImpl: async (input, init) => {
                  networkRequests += 1
                  return globalThis.fetch(input, init)
                }
              })
            : (options.fakeSourceFactory?.(arm) ??
              new C1ScriptedResponseSource(
                [1, 2, 3].map((ordinal) => ({
                  responseId: `canary-fake-${ordinal}`,
                  assistantMessageCount: 1,
                  assistantContent: ordinal === 3 ? MARKER : '',
                  usage: {
                    inputTokens: 10,
                    outputTokens: 2,
                    totalTokens: 12,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    usageSource: 'SCRIPTED_FAKE'
                  },
                  toolRequests:
                    ordinal < 3
                      ? [
                          {
                            toolCallId: `canary-read-${ordinal}`,
                            toolName: 'read',
                            argumentsJson: '{"path":"README.md"}'
                          }
                        ]
                      : [],
                  toolExecutions: [],
                  outcome: ordinal < 3 ? 'CONTINUE' : 'COMPLETE'
                }))
              ))
        if (source.kind !== (options.mode === 'LIVE' ? 'AUTHORIZED_PROVIDER' : 'SCRIPTED_FAKE'))
          throw new Error('Canary source mode mismatch')
        const sandbox = new C1SandboxToolExecutor(root)
        const result: C1LiveBindingLegResult = await driver.runLeg({
          studyId: options.studyId,
          task,
          stratum: task.stratum,
          pairId: 'mechanism-p01',
          arm,
          runId,
          fixtureContentSha256: summary.sha256,
          fixtureTreeObjectId: inlineTreeId(),
          runtimeSessionId: `${options.studyId}-runtime`,
          maxCalls: 3,
          responseAbortSignal: abort.signal,
          observationSource: {
            initialObservation: observations.initialObservation,
            next: (input) => {
              const observation = observations.next(input)
              return arm === 'RUNTIME'
                ? applyC1DuplicateReadPolicy(
                    observation,
                    c1KnownCommittedSourceKeys(input.previousExecution)
                  )
                : observation
            }
          },
          responseSource: {
            kind: source.kind,
            next: async (request, sourceOptions) => {
              if (options.mode === 'LIVE') providerCalls += 1
              else fakeResponses += 1
              const response = await source.next(request, sourceOptions)
              if (response.outcome !== 'CONTINUE')
                answerMatched = response.assistantContent.trim() === MARKER
              return response
            }
          },
          toolExecutor: {
            execute: async (input) => {
              for (const tool of input.response.toolRequests) {
                let args: unknown
                try {
                  args = JSON.parse(tool.argumentsJson)
                } catch {
                  throw new Error('Canary tool arguments invalid')
                }
                if (
                  tool.toolName !== 'read' ||
                  typeof args !== 'object' ||
                  args === null ||
                  Object.keys(args).length !== 1 ||
                  (args as { path?: unknown }).path !== 'README.md'
                ) {
                  throw new Error('Canary rejected a tool outside the frozen read-only scope')
                }
              }
              return sandbox.execute(input)
            }
          }
        })
        const tools = result.evidence.reduce((sum, row) => sum + row.toolEvents.length, 0)
        const changedCalls = result.evidence
          .filter((row) => row.runtimeContextChanged)
          .map((row) => row.callOrdinal)
        const pass =
          result.finalOutcome === 'COMPLETE' &&
          tools === 2 &&
          answerMatched &&
          result.evidence.every((row) =>
            row.toolEvents.every((tool) => tool.result === 'SUCCESS')
          ) &&
          (arm === 'NATIVE' ? changedCalls.length === 0 : changedCalls.length > 0)
        const leg = {
          arm,
          runId,
          status: pass ? 'PASS' : 'FAIL',
          responses: result.evidence.length,
          tools,
          changedCalls,
          answerMatched
        }
        const legDir = join(reportDir, 'legs', runId)
        await mkdir(legDir, { recursive: true })
        await writeExclusiveDurable(join(legDir, 'leg-manifest.json'), {
          ...leg,
          studyId: options.studyId,
          taskEvaluation: 'DIAGNOSTIC_MARKER_ONLY',
          taskOutcome: pass ? 'SUCCESS' : 'FAILURE'
        })
        completed.add(runId)
        legs.push(leg)
        if (!pass) throw new Error('Canary completion criteria not met')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  } catch (error) {
    failureCode = error instanceof C1PreflightFailure ? error.code : 'CANARY_STOP'
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    binding?.dispose()
  }
  const report = {
    contractId: contract.contractId,
    contractSha256: C1_MECHANISM_CANARY_CONTRACT_SHA256,
    executionRevision: options.executionRevision,
    studyId: options.studyId,
    mode: options.mode,
    status: failureCode === null && legs.length === 2 ? 'PASS' : 'FAIL',
    terminal: true,
    retired: true,
    attemptedLegs,
    completedLegs: completed.size,
    unexecutedLegs: 2 - attemptedLegs,
    providerCalls,
    networkRequests,
    fakeResponses,
    failureCode,
    legs,
    callAccounting: deriveC1CallAccounting(
      sink.checkpoints,
      completed,
      failureCode === 'EVIDENCE_WRITE_FAILURE'
    ),
    claims: 'MECHANISM_ONLY_NOT_TASK_EFFECTIVENESS_OR_COST_SAVINGS'
  }
  await writeExclusiveDurable(join(reportDir, 'report.json'), report)
  return report
}
