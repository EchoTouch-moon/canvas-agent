import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
  adjudicateC1LifecycleReplayRecord,
  captureC1LifecycleReplayEvidence,
  reconcileC1LifecycleReplayCall,
  type C1LifecycleReplayRecord
} from './c1-lifecycle-replay-evidence'
import {
  applyC1SupersededVersionPolicy,
  c1SupersededVersionCommittedKeys,
  C1_SUPERSEDED_VERSION_POLICY_ID
} from './c1-superseded-version-policy'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  type C1LiveResponseSource,
  type C1LiveOutboundRequest
} from './c1-live-binding'
import {
  C1HardBudgetGuard,
  C1PreflightFailure,
  computeC1FixtureContentSummary,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  type C1AgentObservation,
  type C1PreflightTask
} from './c1-live-preflight'
import {
  assertC1LiveExecutionRevision,
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource
} from './c1-live-study'

/**
 * C1_LIFECYCLE_CANARY_SV1 - Runtime-only pure-evict lifecycle canary.
 * Frozen design: docs/plan/c1-superseded-version-live-canary-2026-09-08.zh-CN.md
 *
 * Hard boundaries implemented here:
 *  1. empty bootstrap is a canary-specific override (bootstrapFiles: []),
 *     the global C1_LIVE_BOOTSTRAP_FILES semantics is untouched;
 *  2. prompt, fixture, marker, tool sequence, budget and bootstrap policy
 *     are all inside the serialized contract -> contractSha256;
 *  3. the call-3 lifecycle gate runs BEFORE the outbound request: on any
 *     mismatch the inner response source is never invoked, so
 *     networkRequests/providerCalls do not increment;
 *  4. replay evidence (five-condition inputs) is persisted separately from
 *     the execution ledger (decisions/composition); records carry no verdict;
 *  5. the tool sequence is an explicit state machine, any other transition
 *     is CANARY_STOP.
 */

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const MARKER = 'ORCHID-42'
const README_CONTENT = `# Synthetic lifecycle diagnostic\nThe diagnostic marker is ${MARKER}.\nThis file contains no project or personal data.\n`
const A_JS_CONTENT = 'export const value = 1;\n'
// Neutral bootstrap: the observation pipeline has a global invariant rejecting
// zero-source observations (observedC1SourceKeys). A truly EMPTY bootstrap is
// therefore not implementable without weakening that shared invariant. This
// synthetic AGENTS.md carries no diagnostic content: src/a.js and README.md
// remain unknown to the model until it reads them, which is what the frozen
// design actually requires (no task-needed tool call can be skipped).
const AGENTS_CONTENT =
  '# Synthetic diagnostic sandbox\nThis sandbox contains a synthetic lifecycle diagnostic.\nIt contains no project or personal data.\n'
const PROMPT =
  'This is a read-only-context lifecycle diagnostic. Do exactly these steps, one tool call at a time: ' +
  '1. Read the file src/a.js. ' +
  '2. Edit src/a.js to change value from 1 to 2. ' +
  '3. After the edit succeeds, read README.md. ' +
  '4. Reply with only the diagnostic marker from README.md. ' +
  'Do not call bash or write or any other tool. Do not read or edit any other path.'
const TOOL_SEQUENCE = ['read:src/a.js', 'edit:src/a.js', 'read:README.md'] as const

export const C1_LIFECYCLE_CANARY_SV1_CONTRACT = Object.freeze({
  contractId: 'C1_LIFECYCLE_CANARY_SV1',
  studyKind: 'CONTROLLED_MECHANISM_NOT_EFFECTIVENESS',
  policyId: C1_SUPERSEDED_VERSION_POLICY_ID,
  provider: 'step-plan',
  model: 'step-3.7-flash',
  arms: ['RUNTIME'],
  maxLegs: 1,
  maxRequests: 4,
  maxToolExecutions: 3,
  requestTimeoutMs: 30000,
  maxWallClockMs: 120000,
  maxOutputTokensPerRequest: C1_AUTHORIZED_PROVIDER_MAX_TOKENS,
  bootstrap: 'NEUTRAL_AGENTS_MD_CANARY_SPECIFIC_OVERRIDE',
  toolSequence: TOOL_SEQUENCE,
  marker: MARKER,
  fixture: {
    kind: 'INLINE_SYNTHETIC',
    files: {
      'AGENTS.md': sha256(AGENTS_CONTENT),
      'README.md': sha256(README_CONTENT),
      'src/a.js': sha256(A_JS_CONTENT)
    }
  },
  promptSha256: sha256(PROMPT),
  terminalIdentity: 'SINGLE_USE_NO_RESUME',
  fallback: 'NONE',
  efficacyClaims: false
})
export const C1_LIFECYCLE_CANARY_SV1_CONTRACT_SHA256 = sha256(
  JSON.stringify(C1_LIFECYCLE_CANARY_SV1_CONTRACT)
)

export interface C1LifecycleCanaryAuthorization {
  readonly decision: 'AUTHORIZED'
  readonly studyId: string
  readonly executionRevision: string
  readonly contractSha256: string
}

/** Default scripted trajectory for FAKE mode: read a.js -> edit a.js -> read
 * README -> answer with the marker. */
export function c1LifecycleCanaryScriptedResponses() {
  const usage = {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usageSource: 'SCRIPTED_FAKE' as const
  }
  return [
    {
      responseId: 'lifecycle-1',
      assistantMessageCount: 1,
      assistantContent: '',
      usage,
      toolRequests: [
        { toolCallId: 'lifecycle-read-1', toolName: 'read', argumentsJson: '{"path":"src/a.js"}' }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE' as const
    },
    {
      responseId: 'lifecycle-2',
      assistantMessageCount: 1,
      assistantContent: '',
      usage,
      toolRequests: [
        {
          toolCallId: 'lifecycle-edit-1',
          toolName: 'edit',
          argumentsJson: '{"path":"src/a.js","oldText":"value = 1","newText":"value = 2"}'
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE' as const
    },
    {
      responseId: 'lifecycle-3',
      assistantMessageCount: 1,
      assistantContent: '',
      usage,
      toolRequests: [
        { toolCallId: 'lifecycle-read-2', toolName: 'read', argumentsJson: '{"path":"README.md"}' }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE' as const
    },
    {
      responseId: 'lifecycle-4',
      assistantMessageCount: 1,
      assistantContent: MARKER,
      usage,
      toolRequests: [],
      toolExecutions: [],
      outcome: 'COMPLETE' as const
    }
  ]
}

type Stage =
  'EXPECT_READ_A' | 'EXPECT_EDIT_A' | 'EXPECT_READ_README' | 'EXPECT_COMPLETE' | 'TERMINAL'

const LIFECYCLE_GATE_CALL = 3

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

async function appendDurableJsonl(path: string, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return
  const file = await open(path, 'a', 0o600)
  try {
    for (const value of values) {
      await file.writeFile(`${JSON.stringify(value)}\n`)
    }
    await file.sync()
  } finally {
    await file.close()
  }
  await syncDirectory(dirname(path))
}

export async function runC1LifecycleCanary(options: {
  readonly mode: 'FAKE' | 'LIVE'
  readonly repoRoot: string
  readonly outputRoot: string
  readonly studyId: string
  readonly executionRevision: string
  readonly authorization?: C1LifecycleCanaryAuthorization
  /** When provided, must equal the frozen contract SHA-256 (both modes). */
  readonly contractSha256?: string
  /** Invoked only after all local gates and exclusive identity claim. */
  readonly getApiKey?: () => string
  /** Only the FAKE mode accepts a scripted test source. */
  readonly fakeSourceFactory?: () => C1LiveResponseSource
  /** Test seam: policy application (defaults to the frozen policy). */
  readonly policyApplier?: typeof applyC1SupersededVersionPolicy
  /** Test seam: replay capture (defaults to the frozen capture). */
  readonly replayCapture?: typeof captureC1LifecycleReplayEvidence
}) {
  const contract = C1_LIFECYCLE_CANARY_SV1_CONTRACT
  const contractSha256 = C1_LIFECYCLE_CANARY_SV1_CONTRACT_SHA256
  if (!nodeVersionSatisfiesC1Range()) throw new Error('Lifecycle canary requires Node 24')
  if (!/^c1-lifecycle-\d{8}-[a-f0-9]{8}$/.test(options.studyId))
    throw new Error('Invalid lifecycle canary study identity')
  if (options.contractSha256 !== undefined && options.contractSha256 !== contractSha256)
    throw new Error('Lifecycle canary contract binding mismatch')
  if (options.mode === 'LIVE') {
    const auth = options.authorization
    if (
      auth?.decision !== 'AUTHORIZED' ||
      auth.studyId !== options.studyId ||
      auth.executionRevision !== options.executionRevision ||
      auth.contractSha256 !== contractSha256 ||
      options.fakeSourceFactory !== undefined ||
      options.getApiKey === undefined
    ) {
      throw new Error('Live lifecycle canary requires exact owner authorization')
    }
    await assertC1LiveExecutionRevision(options.repoRoot, options.executionRevision)
    await assertC1LiveWorktreeClean(options.repoRoot)
    const gitDir = await runProcess('git', ['rev-parse', '--git-common-dir'], {
      cwd: options.repoRoot,
      timeoutMs: 30000,
      env: buildSanitizedChildEnvironment()
    })
    if (gitDir.exitCode !== 0 || !gitDir.stdout.trim())
      throw new Error('Cannot locate lifecycle canary identity registry')
    const registry = resolve(options.repoRoot, gitDir.stdout.trim(), 'c1-lifecycle-identities')
    await mkdir(registry, { recursive: true, mode: 0o700 })
    await syncDirectory(dirname(registry))
    await writeExclusiveDurable(join(registry, `${options.studyId}.json`), {
      studyId: options.studyId,
      executionRevision: options.executionRevision,
      contractSha256,
      consumed: true,
      resume: 'FORBIDDEN'
    })
  }
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 })
  const reportDir = join(options.outputRoot, options.studyId)
  await mkdir(reportDir, { mode: 0o700 }) // Exclusive, never resumed, even after a crash.
  const replayPath = join(reportDir, 'lifecycle-replay.jsonl')
  const sink = new C1JsonlLiveBindingEvidenceSink(join(reportDir, 'checkpoints.jsonl'))
  const completed = new Set<string>()
  const policyApplier = options.policyApplier ?? applyC1SupersededVersionPolicy
  const replayCapture = options.replayCapture ?? captureC1LifecycleReplayEvidence
  const exclusionsByCall = new Map<number, readonly string[]>()
  const recordsByCall = new Map<number, readonly C1LifecycleReplayRecord[]>()
  const reconciliation: {
    callOrdinal: number
    verdict: 'MATCH' | 'CONTRACT_CONFLICT' | 'NOT_EVALUATED'
    conflicts: readonly string[]
  }[] = []
  let providerCalls = 0
  let networkRequests = 0
  let fakeResponses = 0
  let answerMatched = false
  let stage: Stage = 'EXPECT_READ_A'
  let failureCode: string | null = null
  let attemptedLegs = 0
  let finalOutcome: string | null = null
  let failureMessage: string | null = null
  const toolResults: { toolCallId: string; toolName: string; path?: string; result: string }[] = []
  const changedCalls: number[] = []
  let carriedAtFinal: readonly string[] = []
  // A sequence violation observed on an already-returned response is recorded
  // here and raised only after the driver persisted that response. Throwing from
  // inside responseSource.next would discard the receipt for a call the provider
  // actually served, leaving a permit with no recorded response.
  let deferredStop: string | null = null

  const stop = (reason: string): never => {
    // Plain Error so the failure ledger records CANARY_STOP via the catch-all,
    // exactly like the mechanism canary's completion-criteria failure.
    throw new Error(`CANARY_STOP: ${reason}`)
  }

  try {
    await writeExclusiveDurable(join(reportDir, 'binding.json'), {
      contract,
      contractSha256,
      studyId: options.studyId,
      executionRevision: options.executionRevision,
      mode: options.mode,
      claimed: true,
      resume: 'FORBIDDEN'
    })
    const binding = await prepareC1StrictProvider({ runIdentity: options.studyId })
    try {
      const apiKey = options.mode === 'LIVE' ? options.getApiKey!() : null
      const driver = new C1LiveBindingDriver({
        providerBinding: binding,
        evidenceSink: sink,
        budgetGuard: new C1HardBudgetGuard({
          perLeg: {
            maxProviderCalls: contract.maxRequests,
            maxToolCalls: contract.maxToolExecutions,
            maxWallClockMs: contract.maxWallClockMs
          },
          study: {
            maxProviderCalls: contract.maxRequests,
            maxToolCalls: contract.maxToolExecutions,
            maxWallClockMs: contract.maxWallClockMs,
            maxLegs: contract.maxLegs
          }
        })
      })
      attemptedLegs += 1
      const root = await mkdtemp(join(tmpdir(), 'c1-lifecycle-fixture-'))
      try {
        await mkdir(join(root, 'src'), { recursive: true })
        await writeFile(join(root, 'AGENTS.md'), AGENTS_CONTENT)
        await writeFile(join(root, 'README.md'), README_CONTENT)
        await writeFile(join(root, 'src', 'a.js'), A_JS_CONTENT)
        const summary = await computeC1FixtureContentSummary(root)
        if (summary.fileCount !== Object.keys(contract.fixture.files).length)
          throw new Error('Lifecycle canary fixture binding mismatch')
        for (const [path, hash] of Object.entries(contract.fixture.files)) {
          if (sha256(readFileSync(join(root, path), 'utf8')) !== hash)
            throw new Error(`Lifecycle canary fixture content mismatch at ${path}`)
        }
        const versionProbe = (path: string): string | undefined => {
          try {
            return sha256(readFileSync(join(root, path), 'utf8'))
          } catch {
            return undefined
          }
        }
        const task: C1PreflightTask = {
          taskId: 'c1-lifecycle-superseded-version-sv1',
          stratum: 'CONTROLLED_SUPERSEDED_VERSION',
          title: 'Pure-evict lifecycle mechanism diagnostic',
          fixtureVersion: 'INLINE_SYNTHETIC_SV1',
          fixturePath: 'INLINE_SYNTHETIC/src/a.js',
          fixtureRevision: {
            baseRevision: options.executionRevision,
            fixtureTreeObjectId: createHash('sha1').update(summary.sha256).digest('hex'),
            fixtureContentSha256: summary.sha256
          },
          prompt: PROMPT,
          promptSha256: contract.promptSha256,
          objectiveOracle: { command: 'node', args: [], expectedExitCode: 0, timeoutMs: 1 },
          regressionOracle: { command: 'node', args: [], expectedExitCode: 0, timeoutMs: 1 },
          expectedWritablePaths: [],
          relevantSources: [],
          distractorSources: [],
          requiredLaterSources: []
        }
        const runId = `${options.studyId}-RUNTIME`
        const observations = await C1LiveTaskObservationSource.fromFixture({
          task,
          runId: 'lifecycle-shared-bootstrap',
          fixtureRoot: root,
          bootstrapFiles: ['AGENTS.md']
        })
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
            : (options.fakeSourceFactory?.() ??
              new C1ScriptedResponseSource(c1LifecycleCanaryScriptedResponses()))
        if (source.kind !== (options.mode === 'LIVE' ? 'AUTHORIZED_PROVIDER' : 'SCRIPTED_FAKE'))
          throw new Error('Lifecycle canary source mode mismatch')
        const sandbox = new C1SandboxToolExecutor(root)
        let callOrdinal = 0

        const expectTool = (
          requests: readonly { toolCallId: string; toolName: string; argumentsJson: string }[],
          expected: { tool: string; path: string }
        ): void => {
          if (requests.length !== 1) stop('expected exactly one tool request in this stage')
          const request = requests[0]!
          let args: unknown
          try {
            args = JSON.parse(request.argumentsJson)
          } catch {
            stop('tool arguments invalid')
          }
          const record = args as Record<string, unknown>
          if (request.toolName !== expected.tool || record['path'] !== expected.path) {
            stop(`stage ${stage} received an out-of-sequence tool ${request.toolName}`)
          }
        }

        const result = await driver.runLeg({
          studyId: options.studyId,
          task,
          stratum: task.stratum,
          pairId: 'lifecycle-p01',
          arm: 'RUNTIME',
          runId,
          fixtureContentSha256: summary.sha256,
          fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
          runtimeSessionId: `${options.studyId}-runtime`,
          maxCalls: contract.maxRequests,
          responseAbortSignal: new AbortController().signal,
          observationSource: {
            initialObservation: observations.initialObservation,
            next: (input) => {
              const observation = observations.next(input)
              const upcoming = input.callOrdinal + 1
              const committed = c1SupersededVersionCommittedKeys(input.previousExecution)
              const records = replayCapture(observation, {
                runId,
                callOrdinal: upcoming,
                knownCommittedSourceKeys: committed,
                versionProbe
              })
              recordsByCall.set(upcoming, records)
              void appendDurableJsonl(replayPath, records)
              const before = new Set(observation.excludedSourceKeys)
              const applied = policyApplier(observation, committed, { versionProbe })
              exclusionsByCall.set(
                upcoming,
                applied.excludedSourceKeys.filter((key) => !before.has(key))
              )
              return applied
            }
          },
          responseSource: {
            kind: source.kind,
            next: async (request: C1LiveOutboundRequest, sourceOptions) => {
              callOrdinal += 1
              // Hard boundary #3: the lifecycle gate runs BEFORE the inner
              // source is invoked, so a failed gate never reaches the network.
              if (callOrdinal === LIFECYCLE_GATE_CALL) {
                if (stage !== 'EXPECT_READ_README') stop('sequence did not reach the edit stage')
                const records = recordsByCall.get(callOrdinal) ?? []
                const exclusions = exclusionsByCall.get(callOrdinal) ?? []
                const adjudications = records.map((record) => ({
                  record,
                  verdict: adjudicateC1LifecycleReplayRecord(record)
                }))
                if (adjudications.some((entry) => entry.verdict === 'UNKNOWN'))
                  stop('lifecycle adjudication UNKNOWN at the gate call')
                const superseded = adjudications.filter((entry) => entry.verdict === 'SUPERSEDED')
                if (superseded.length !== 1)
                  stop(`expected exactly one SUPERSEDED record, received ${superseded.length}`)
                const staleKeys = superseded[0]!.record.sourceKeys
                const removed = new Set(exclusions)
                const reconciliationResult = reconcileC1LifecycleReplayCall({
                  records,
                  removedSourceKeys: exclusions
                })
                reconciliation.push({
                  callOrdinal,
                  verdict: reconciliationResult.verdict,
                  conflicts: reconciliationResult.conflicts
                })
                if (reconciliationResult.verdict !== 'MATCH')
                  stop('CONTRACT_CONFLICT between replay adjudication and policy removals')
                if (
                  staleKeys.length !== 2 ||
                  !staleKeys.every((key) => removed.has(key)) ||
                  ![...removed].every((key) => staleKeys.includes(key))
                )
                  stop('actual REMOVE set is not exactly the stale read pair')
                const bound = new Set(request.capture.providerBoundSourceKeys)
                if (staleKeys.some((key) => bound.has(key)))
                  stop('stale pair still present in provider-bound source keys')
              } else {
                reconciliation.push({ callOrdinal, verdict: 'NOT_EVALUATED', conflicts: [] })
              }
              if (options.mode === 'LIVE') providerCalls += 1
              else fakeResponses += 1
              const response = await source.next(request, sourceOptions)
              if (response.outcome !== 'CONTINUE') {
                // Recorded, not thrown: the driver persists this response's
                // receipt and evidence row before the leg ends, and a terminal
                // outcome already prevents any further outbound request.
                if (stage !== 'EXPECT_COMPLETE')
                  deferredStop ??= 'model completed before the sequence reached EXPECT_COMPLETE'
                answerMatched = response.assistantContent.trim() === MARKER
                if (stage === 'EXPECT_COMPLETE') stage = 'TERMINAL'
              }
              return response
            }
          },
          toolExecutor: {
            execute: async (input) => {
              const expected =
                stage === 'EXPECT_READ_A'
                  ? { tool: 'read', path: 'src/a.js' }
                  : stage === 'EXPECT_EDIT_A'
                    ? { tool: 'edit', path: 'src/a.js' }
                    : stage === 'EXPECT_READ_README'
                      ? { tool: 'read', path: 'README.md' }
                      : null
              if (expected === null) {
                throw new Error(`CANARY_STOP: no tool execution allowed in stage ${stage}`)
              }
              expectTool(input.response.toolRequests, expected)
              const beforeHash = expected.tool === 'edit' ? versionProbe('src/a.js') : undefined
              const execution = await sandbox.execute(input)
              for (const event of execution.executions) {
                toolResults.push({ ...event })
                if (event.result !== 'SUCCESS') stop('tool execution failed')
              }
              if (expected.tool === 'edit') {
                const afterHash = versionProbe('src/a.js')
                if (beforeHash === undefined || afterHash === undefined || beforeHash === afterHash)
                  stop('edit did not change the file fingerprint (no-op)')
              }
              stage =
                stage === 'EXPECT_READ_A'
                  ? 'EXPECT_EDIT_A'
                  : stage === 'EXPECT_EDIT_A'
                    ? 'EXPECT_READ_README'
                    : 'EXPECT_COMPLETE'
              return execution
            }
          }
        })
        finalOutcome = result.finalOutcome
        for (const row of result.evidence) {
          if (row.runtimeContextChanged) changedCalls.push(row.callOrdinal)
        }
        carriedAtFinal = result.evidence.at(-1)?.carriedRemovedSourceKeys ?? []
        // Raised only here: every served response is durable by now. The leg is
        // still not counted as completed, because reaching a terminal outcome is
        // not the same as satisfying the frozen sequence.
        const pendingStop: string | null = deferredStop
        if (pendingStop !== null) stop(pendingStop)
        completed.add(runId)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    } finally {
      binding.dispose()
    }
  } catch (error) {
    failureCode = error instanceof C1PreflightFailure ? error.code : 'CANARY_STOP'
    failureMessage = error instanceof Error ? error.message : String(error)
  }

  const tools = toolResults.length
  // stage is mutated inside closures; read it through an explicit Stage-typed
  // snapshot so control-flow narrowing does not freeze it at the initializer.
  const finalStage: Stage = stage as Stage
  const pass =
    failureCode === null &&
    finalOutcome === 'COMPLETE' &&
    answerMatched &&
    finalStage === 'TERMINAL' &&
    tools === contract.maxToolExecutions &&
    toolResults.every((row) => row.result === 'SUCCESS') &&
    changedCalls.includes(LIFECYCLE_GATE_CALL) &&
    carriedAtFinal.length === 2 &&
    reconciliation.every((entry) => entry.verdict !== 'CONTRACT_CONFLICT')
  const report = {
    contractId: contract.contractId,
    contractSha256,
    executionRevision: options.executionRevision,
    studyId: options.studyId,
    mode: options.mode,
    status: pass ? 'PASS' : 'FAIL',
    terminal: true,
    retired: true,
    attemptedLegs,
    completedLegs: completed.size,
    unexecutedLegs: contract.maxLegs - attemptedLegs,
    providerCalls,
    networkRequests,
    fakeResponses,
    failureCode,
    failureMessage,
    finalStage: stage,
    answerMatched,
    changedCalls,
    carriedRemovedAtFinalCall: carriedAtFinal,
    toolResults,
    reconciliation,
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
