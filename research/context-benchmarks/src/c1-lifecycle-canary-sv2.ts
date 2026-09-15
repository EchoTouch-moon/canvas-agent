import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'
import { activeMessagesHash } from '@canvas-agent/pi-context-integration/experimental'
import { C1AuthorizedProviderResponseSource } from './c1-authorized-provider'
import { deriveC1CallAccounting } from './c1-call-accounting'
import {
  adjudicateC1LifecycleReplayRecord,
  captureC1LifecycleReplayEvidence,
  reconcileC1LifecycleReplayCall,
  type C1LifecycleReplayRecord
} from './c1-lifecycle-replay-evidence'
import {
  applyC1SupersededVersionPolicy,
  C1_SUPERSEDED_VERSION_POLICY_ID
} from './c1-superseded-version-policy'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1LiveBindingTransport,
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  type C1LiveBindingLegResult,
  type C1LiveModelResponse,
  type C1LiveUsage,
  type C1LiveResponseSource,
  type C1LiveOutboundRequest
} from './c1-live-binding'
import {
  C1HardBudgetGuard,
  C1LegExecutor,
  C1PreflightFailure,
  C1_MODEL_ID,
  C1_PROVIDER_ENDPOINT,
  C1_PROVIDER_ID,
  computeC1FixtureContentSummary,
  nodeVersionSatisfiesC1Range,
  prepareC1StrictProvider,
  type C1AgentObservation,
  type C1PreflightTask,
  type C1StrictProviderBinding
} from './c1-live-preflight'
import {
  assertC1LiveExecutionRevision,
  assertC1LiveWorktreeClean,
  C1LiveTaskObservationSource
} from './c1-live-study'
import { buildSanitizedChildEnvironment, runProcess } from './fixture-generator'

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const sha1 = (value: string): string => createHash('sha1').update(value, 'utf8').digest('hex')

const AGENTS_CONTENT =
  '# Synthetic lifecycle canary\nThis file contains no task instructions or project data.\n'
const A_V1_CONTENT = 'export const value = 1;\n'
const A_V2_CONTENT = 'export const value = 2;\n'
const PROMPT =
  'This is a provider-bound context mechanism diagnostic. The harness has seeded a completed file mutation. Reply with a concise acknowledgement and do not request tools.'
const AGENTS_HASH = sha256(AGENTS_CONTENT)
const A_V1_HASH = sha256(A_V1_CONTENT)
const FIXTURE_CONTENT_HASH = sha256(`${AGENTS_HASH}  AGENTS.md\n${A_V1_HASH}  src/a.js\n`)
const FIXTURE_TREE_ID = sha1(FIXTURE_CONTENT_HASH)

/** Frozen candidate values for one harness-seeded request. */
export const C1_LIFECYCLE_CANARY_SV2_CONTRACT = Object.freeze({
  contractId: 'C1_LIFECYCLE_CANARY_SV2',
  studyKind: 'CONTROLLED_MECHANISM_NOT_EFFECTIVENESS',
  policyId: C1_SUPERSEDED_VERSION_POLICY_ID,
  provider: C1_PROVIDER_ID,
  model: C1_MODEL_ID,
  arms: ['RUNTIME'],
  maxLegs: 1,
  maxProviderRequests: 1,
  maxProviderToolRequests: 0,
  seededToolExecutions: 2,
  requestTimeoutMs: 30_000,
  maxWallClockMs: 120_000,
  maxOutputTokensPerRequest: 16_384,
  bootstrap: 'NEUTRAL_SYNTHETIC_AGENTS_MD',
  fixture: {
    kind: 'INLINE_SYNTHETIC',
    files: {
      'AGENTS.md': AGENTS_HASH,
      'src/a.js': A_V1_HASH
    },
    fixtureContentSha256: FIXTURE_CONTENT_HASH,
    fixtureTreeObjectId: FIXTURE_TREE_ID
  },
  promptSha256: sha256(PROMPT),
  terminalIdentity: 'SINGLE_USE_NO_RESUME',
  fallback: 'NONE',
  efficacyClaims: false
})

export const C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256 = sha256(
  JSON.stringify(C1_LIFECYCLE_CANARY_SV2_CONTRACT)
)

export interface C1LifecycleCanarySv2Authorization {
  readonly decision: 'AUTHORIZED'
  readonly studyId: string
  readonly executionRevision: string
  readonly contractSha256: string
}

export interface C1LifecycleCanarySv2Report {
  readonly contractId: typeof C1_LIFECYCLE_CANARY_SV2_CONTRACT.contractId
  readonly contractSha256: typeof C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256
  readonly executionRevision: string
  readonly studyId: string
  readonly mode: 'FAKE' | 'LIVE'
  readonly status: 'PASS' | 'FAIL'
  readonly terminal: true
  readonly retired: true
  readonly providerCalls: number
  readonly networkRequests: number
  readonly fakeResponses: number
  readonly attemptedLegs: number
  readonly completedLegs: number
  readonly identityClaimed: boolean
  readonly providerResponseObserved: boolean
  readonly providerTerminalObserved: boolean
  readonly protocolCompleted: boolean
  readonly replayRecords: number
  readonly replayVerdicts: Readonly<Record<string, number>>
  readonly removedSourceKeys: readonly string[]
  readonly providerBoundSourceKeys: readonly string[]
  readonly providerBoundMessagesHash: string | null
  readonly stalePairPresentInProviderBoundMessages: boolean | null
  readonly responseOutcome: C1LiveModelResponse['outcome'] | null
  readonly responseUsage: C1LiveUsage | null
  readonly failureCode: string | null
  readonly failureMessage: string | null
  readonly callAccounting: ReturnType<typeof deriveC1CallAccounting>
  readonly claims: 'MECHANISM_ONLY_NOT_TASK_EFFECTIVENESS_OR_COST_SAVINGS'
}

function fail(reason: string): never {
  throw new C1PreflightFailure('PREFLIGHT_FAILURE', `SV2 CANARY_STOP: ${reason}`)
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

async function appendDurableJsonl(path: string, values: readonly unknown[]): Promise<void> {
  const file = await open(path, 'a', 0o600)
  try {
    for (const value of values) await file.writeFile(`${JSON.stringify(value)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
  await syncDirectory(dirname(path))
}

function parseJsonLines<T>(value: string): T[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function hasToolCallPair(messages: readonly PiMessageView[], toolCallId: string): boolean {
  let calls = 0
  let results = 0
  for (const message of messages) {
    if (message.role === 'toolResult' && message.toolCallId === toolCallId) results += 1
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    calls += message.content.filter(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'toolCall' &&
        (block as { id?: unknown }).id === toolCallId
    ).length
  }
  return calls === 1 && results === 1
}

function responseWithTool(input: {
  readonly responseId: string
  readonly toolCallId: string
  readonly toolName: 'read' | 'edit'
  readonly argumentsJson: string
}): C1LiveModelResponse {
  return {
    responseId: input.responseId,
    assistantMessageCount: 1,
    assistantContent: '',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
      usageSource: 'SCRIPTED_FAKE'
    },
    toolRequests: [
      {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        argumentsJson: input.argumentsJson
      }
    ],
    toolExecutions: [],
    outcome: 'CONTINUE'
  }
}

function terminalFakeResponse(): C1LiveModelResponse {
  return {
    responseId: 'c1-lifecycle-sv2-fake-terminal',
    assistantMessageCount: 1,
    assistantContent: 'acknowledged',
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 12,
      usageSource: 'SCRIPTED_FAKE'
    },
    toolRequests: [],
    toolExecutions: [],
    outcome: 'COMPLETE'
  }
}

async function claimSv2Identity(
  repoRoot: string,
  authorization: C1LifecycleCanarySv2Authorization
): Promise<void> {
  const gitDir = await runProcess('git', ['rev-parse', '--git-common-dir'], {
    cwd: repoRoot,
    timeoutMs: 30_000,
    env: buildSanitizedChildEnvironment()
  })
  if (gitDir.exitCode !== 0 || !gitDir.stdout.trim()) fail('cannot locate Git common directory')
  const registry = resolve(repoRoot, gitDir.stdout.trim(), 'c1-lifecycle-sv2-identities')
  await mkdir(registry, { recursive: true, mode: 0o700 })
  await syncDirectory(dirname(registry))
  await writeExclusiveDurable(join(registry, `${authorization.studyId}.json`), {
    studyId: authorization.studyId,
    executionRevision: authorization.executionRevision,
    contractSha256: authorization.contractSha256,
    consumed: true,
    resume: 'FORBIDDEN'
  })
}

function syntheticTask(executionRevision: string, fixtureContentSha256: string): C1PreflightTask {
  return {
    taskId: 'c1-lifecycle-sv2-harness-seeded-v1',
    stratum: 'CONTROLLED_SUPERSEDED_VERSION',
    title: 'Harness-seeded provider-bound pure-evict proof',
    fixtureVersion: 'INLINE_SYNTHETIC_SV2',
    fixturePath: 'INLINE_SYNTHETIC/src/a.js',
    fixtureRevision: {
      baseRevision: executionRevision,
      fixtureTreeObjectId: FIXTURE_TREE_ID,
      fixtureContentSha256
    },
    prompt: PROMPT,
    promptSha256: C1_LIFECYCLE_CANARY_SV2_CONTRACT.promptSha256,
    // These fields are required by the shared capture shape but are never run
    // by SV2. This is a mechanism proof, not a task oracle experiment.
    objectiveOracle: {
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      expectedExitCode: 0,
      timeoutMs: 1
    },
    regressionOracle: {
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      expectedExitCode: 0,
      timeoutMs: 1
    },
    expectedWritablePaths: [],
    relevantSources: [],
    distractorSources: [],
    requiredLaterSources: []
  }
}

export async function runC1LifecycleCanarySv2(options: {
  readonly mode: 'FAKE' | 'LIVE'
  readonly repoRoot: string
  readonly outputRoot: string
  readonly studyId: string
  readonly executionRevision: string
  readonly authorization?: C1LifecycleCanarySv2Authorization
  readonly getApiKey?: () => string
  readonly fakeSourceFactory?: () => C1LiveResponseSource
}): Promise<C1LifecycleCanarySv2Report> {
  const contract = C1_LIFECYCLE_CANARY_SV2_CONTRACT
  if (!nodeVersionSatisfiesC1Range()) throw new Error('SV2 requires Node 24')
  if (!/^c1-lifecycle-sv2-\d{8}-[a-f0-9]{8}$/.test(options.studyId)) {
    throw new Error('invalid SV2 study identity')
  }
  if (options.mode === 'LIVE') {
    const auth = options.authorization
    if (
      auth?.decision !== 'AUTHORIZED' ||
      auth.studyId !== options.studyId ||
      auth.executionRevision !== options.executionRevision ||
      auth.contractSha256 !== C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256 ||
      options.fakeSourceFactory !== undefined ||
      options.getApiKey === undefined
    ) {
      throw new Error('SV2 live mode requires exact owner authorization')
    }
    await assertC1LiveExecutionRevision(options.repoRoot, options.executionRevision)
    await assertC1LiveWorktreeClean(options.repoRoot)
  }

  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 })
  const reportDir = join(options.outputRoot, options.studyId)
  await mkdir(reportDir, { mode: 0o700 })
  await writeExclusiveDurable(join(reportDir, 'binding.json'), {
    contract,
    contractSha256: C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256,
    studyId: options.studyId,
    executionRevision: options.executionRevision,
    mode: options.mode,
    claimed: false,
    resume: 'FORBIDDEN'
  })
  const checkpointPath = join(reportDir, 'checkpoints.jsonl')
  const replayPath = join(reportDir, 'lifecycle-replay.jsonl')
  const sink = new C1JsonlLiveBindingEvidenceSink(checkpointPath)
  const replayRecords: C1LifecycleReplayRecord[] = []
  const replayVerdicts = new Map<string, number>()
  let binding: C1StrictProviderBinding | null = null
  let result: C1LiveBindingLegResult | null = null
  let providerCalls = 0
  let networkRequests = 0
  let fakeResponses = 0
  let attemptedLegs = 0
  let completedLegs = 0
  let identityClaimed = false
  let providerResponseObserved = false
  let providerTerminalObserved = false
  let protocolCompleted = false
  let removedSourceKeys: readonly string[] = []
  let providerBoundSourceKeys: readonly string[] = []
  let providerBoundMessagesHash: string | null = null
  let stalePairPresentInProviderBoundMessages: boolean | null = null
  let responseOutcome: C1LiveModelResponse['outcome'] | null = null
  let responseUsage: C1LiveUsage | null = null
  let failureCode: string | null = null
  let failureMessage: string | null = null

  try {
    binding = await prepareC1StrictProvider({ runIdentity: options.studyId })
    const root = await mkdtemp(join(tmpdir(), 'c1-lifecycle-sv2-'))
    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'AGENTS.md'), AGENTS_CONTENT)
      await writeFile(join(root, 'src', 'a.js'), A_V1_CONTENT)
      const summary = await computeC1FixtureContentSummary(root)
      if (summary.sha256 !== FIXTURE_CONTENT_HASH || summary.fileCount !== 2)
        fail('fixture hash mismatch')
      const task = syntheticTask(options.executionRevision, summary.sha256)
      const bootstrap = await C1LiveTaskObservationSource.fromFixture({
        task,
        runId: `${options.studyId}-bootstrap`,
        fixtureRoot: root,
        bootstrapFiles: ['AGENTS.md']
      })
      const sandbox = new C1SandboxToolExecutor(root)
      const seededRead = await sandbox.execute({
        previousObservation: bootstrap.initialObservation,
        observationId: `${options.studyId}-seed-read`,
        response: responseWithTool({
          responseId: 'sv2-seed-read-response',
          toolCallId: 'sv2-seed-read-a-v1',
          toolName: 'read',
          argumentsJson: JSON.stringify({ path: 'src/a.js' })
        })
      })
      if (seededRead.executions.length !== 1 || seededRead.executions[0]!.result !== 'SUCCESS') {
        fail('seeded read did not succeed')
      }
      const seededEdit = await sandbox.execute({
        previousObservation: seededRead.observation,
        observationId: `${options.studyId}-seed-edit`,
        response: responseWithTool({
          responseId: 'sv2-seed-edit-response',
          toolCallId: 'sv2-seed-edit-a-v1-to-v2',
          toolName: 'edit',
          argumentsJson: JSON.stringify({
            path: 'src/a.js',
            oldText: A_V1_CONTENT,
            newText: A_V2_CONTENT
          })
        })
      })
      if (seededEdit.executions.length !== 1 || seededEdit.executions[0]!.result !== 'SUCCESS') {
        fail('seeded edit did not succeed')
      }
      const current = await readFile(join(root, 'src/a.js'), 'utf8')
      if (current !== A_V2_CONTENT) fail('seeded edit did not produce v2 content')
      const seededObservation = seededEdit.observation
      const runtimeSessionId = `${options.studyId}-runtime`
      const baselineTransport = new C1LiveBindingTransport({
        provider: C1_PROVIDER_ID,
        model: C1_MODEL_ID,
        endpoint: C1_PROVIDER_ENDPOINT,
        providerConfigHash: binding.providerConfigHash
      })
      const baselineExecutor = new C1LegExecutor({ providerBinding: binding })
      const baseline = baselineExecutor.execute({
        studyId: options.studyId,
        task,
        stratum: task.stratum,
        pairId: 'lifecycle-sv2-seeded-p01',
        arm: 'RUNTIME',
        runId: `${options.studyId}-baseline`,
        turnId: `${options.studyId}-baseline-turn-01`,
        modelCallId: `${options.studyId}-baseline-model-call-01`,
        fixtureContentSha256: summary.sha256,
        fixtureTreeObjectId: FIXTURE_TREE_ID,
        observation: seededObservation,
        providerBinding: binding,
        transport: baselineTransport,
        treatmentReady: true,
        runtimeSessionId,
        recompositionSequence: 0
      })
      if (baseline.workingSet === null) fail('baseline Working Set was not materialized')
      const knownCommittedSourceKeys = new Set(
        baseline.workingSet.items.flatMap((item) => item.sourceKeys)
      )
      const versionProbe = (path: string): string | undefined => {
        try {
          return sha256(readFileSyncSync(join(root, path)))
        } catch {
          return undefined
        }
      }
      const records = captureC1LifecycleReplayEvidence(seededObservation, {
        runId: `${options.studyId}-RUNTIME`,
        callOrdinal: 1,
        knownCommittedSourceKeys,
        versionProbe
      })
      replayRecords.push(...records)
      await appendDurableJsonl(replayPath, records)
      const replayReadBack = parseJsonLines<C1LifecycleReplayRecord>(
        await readFile(replayPath, 'utf8')
      )
      if (JSON.stringify(replayReadBack) !== JSON.stringify(records))
        fail('replay read-back mismatch')
      const forbiddenEvidence = JSON.stringify(replayReadBack)
      if (
        forbiddenEvidence.includes(A_V1_CONTENT) ||
        forbiddenEvidence.includes(A_V2_CONTENT) ||
        forbiddenEvidence.includes(AGENTS_CONTENT)
      ) {
        fail('replay evidence contains fixture content')
      }
      for (const record of records) {
        const verdict = adjudicateC1LifecycleReplayRecord(record)
        replayVerdicts.set(verdict, (replayVerdicts.get(verdict) ?? 0) + 1)
      }
      const superseded = records.filter(
        (record) => adjudicateC1LifecycleReplayRecord(record) === 'SUPERSEDED'
      )
      if (superseded.length !== 1 || superseded[0]!.readCallId !== 'sv2-seed-read-a-v1') {
        fail(`expected one seeded SUPERSEDED read, received ${superseded.length}`)
      }
      const applied = applyC1SupersededVersionPolicy(seededObservation, knownCommittedSourceKeys, {
        versionProbe
      })
      const staleKeys = superseded[0]!.sourceKeys
      removedSourceKeys = applied.excludedSourceKeys
      if (
        removedSourceKeys.length !== 2 ||
        !staleKeys.every((key) => removedSourceKeys.includes(key)) ||
        applied.currentTargetSourceKeys.some((key) => staleKeys.includes(key))
      ) {
        fail('policy did not remove exactly the stale read pair')
      }
      const reconciliation = reconcileC1LifecycleReplayCall({
        records,
        removedSourceKeys
      })
      if (reconciliation.verdict !== 'MATCH') fail('replay and policy removal conflict')
      const runtimeObservation: C1AgentObservation = {
        ...applied,
        previousWorkingSetId: baseline.workingSet.workingSetId
      }
      if (options.mode === 'LIVE') {
        await claimSv2Identity(options.repoRoot, options.authorization!)
        identityClaimed = true
      }
      const innerSource =
        options.mode === 'LIVE'
          ? new C1AuthorizedProviderResponseSource({
              providerBinding: binding,
              apiKey: options.getApiKey!(),
              requestTimeoutMs: contract.requestTimeoutMs,
              fetchImpl: async (input, init) => {
                networkRequests += 1
                return globalThis.fetch(input, init)
              }
            })
          : (options.fakeSourceFactory?.() ??
            new C1ScriptedResponseSource([terminalFakeResponse()]))
      if (
        innerSource.kind !== (options.mode === 'LIVE' ? 'AUTHORIZED_PROVIDER' : 'SCRIPTED_FAKE')
      ) {
        fail('response source mode mismatch')
      }
      const responseSource: C1LiveResponseSource = {
        kind: innerSource.kind,
        next: async (request: C1LiveOutboundRequest, sourceOptions) => {
          providerBoundSourceKeys = [...request.capture.providerBoundSourceKeys]
          providerBoundMessagesHash = activeMessagesHash(request.providerBoundMessages)
          stalePairPresentInProviderBoundMessages = staleKeys.some((key) =>
            hasToolCallPair(request.providerBoundMessages, key.replace('run/tool-call://', ''))
          )
          if (stalePairPresentInProviderBoundMessages)
            fail('stale pair reached provider-bound messages')
          if (providerBoundSourceKeys.some((key) => staleKeys.includes(key))) {
            fail('stale pair reached provider-bound source keys')
          }
          if (options.mode === 'LIVE') providerCalls += 1
          else fakeResponses += 1
          const response = await innerSource.next(request, sourceOptions)
          providerResponseObserved = true
          providerTerminalObserved = response.outcome !== 'CONTINUE'
          responseOutcome = response.outcome
          responseUsage = response.usage
          return response
        }
      }
      const driver = new C1LiveBindingDriver({
        providerBinding: binding,
        evidenceSink: sink,
        budgetGuard: new C1HardBudgetGuard({
          perLeg: {
            maxProviderCalls: contract.maxProviderRequests,
            maxToolCalls: contract.maxProviderToolRequests,
            maxWallClockMs: contract.maxWallClockMs
          },
          study: {
            maxProviderCalls: contract.maxProviderRequests,
            maxToolCalls: contract.maxProviderToolRequests,
            maxWallClockMs: contract.maxWallClockMs,
            maxLegs: contract.maxLegs
          }
        })
      })
      attemptedLegs = 1
      result = await driver.runLeg({
        studyId: options.studyId,
        task,
        stratum: task.stratum,
        pairId: 'lifecycle-sv2-seeded-p01',
        arm: 'RUNTIME',
        runId: `${options.studyId}-RUNTIME`,
        fixtureContentSha256: summary.sha256,
        fixtureTreeObjectId: FIXTURE_TREE_ID,
        runtimeSessionId,
        observationSource: {
          initialObservation: runtimeObservation,
          next: () => fail('SV2 must not request a second observation')
        },
        responseSource,
        initialWorkingSet: baseline.workingSet,
        maxCalls: 1,
        responseAbortSignal: new AbortController().signal
      })
      completedLegs = 1
      const row = result.evidence[0]
      if (row === undefined) fail('SV2 did not persist response evidence')
      if (
        row.toolCalls !== 0 ||
        row.runtimeContextChanged !== true ||
        !row.transitionDecisionKinds.includes('REMOVE') ||
        row.providerBoundSourceKeys.some((key) => staleKeys.includes(key))
      ) {
        fail('SV2 response capture did not bind the pure-evicted context')
      }
      protocolCompleted = true
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  } catch (error) {
    failureCode = error instanceof C1PreflightFailure ? error.code : 'SV2_CANARY_STOP'
    failureMessage = error instanceof Error ? error.message : String(error)
  } finally {
    binding?.dispose()
  }

  const checkpoints = sink.checkpoints
  const completedRunIds =
    result !== null && protocolCompleted
      ? new Set([`${options.studyId}-RUNTIME`])
      : new Set<string>()
  const status =
    failureCode === null &&
    protocolCompleted &&
    providerResponseObserved &&
    providerTerminalObserved &&
    providerCalls === (options.mode === 'LIVE' ? 1 : 0) &&
    (options.mode === 'FAKE' ? fakeResponses === 1 : true) &&
    removedSourceKeys.length === 2 &&
    stalePairPresentInProviderBoundMessages === false
      ? 'PASS'
      : 'FAIL'
  const report: C1LifecycleCanarySv2Report = {
    contractId: contract.contractId,
    contractSha256: C1_LIFECYCLE_CANARY_SV2_CONTRACT_SHA256,
    executionRevision: options.executionRevision,
    studyId: options.studyId,
    mode: options.mode,
    status,
    terminal: true,
    retired: true,
    providerCalls,
    networkRequests,
    fakeResponses,
    attemptedLegs,
    completedLegs,
    identityClaimed,
    providerResponseObserved,
    providerTerminalObserved,
    protocolCompleted,
    replayRecords: replayRecords.length,
    replayVerdicts: Object.fromEntries(replayVerdicts),
    removedSourceKeys,
    providerBoundSourceKeys,
    providerBoundMessagesHash,
    stalePairPresentInProviderBoundMessages,
    responseOutcome,
    responseUsage,
    failureCode,
    failureMessage,
    callAccounting: deriveC1CallAccounting(checkpoints, completedRunIds, false),
    claims: 'MECHANISM_ONLY_NOT_TASK_EFFECTIVENESS_OR_COST_SAVINGS'
  }
  await writeExclusiveDurable(join(reportDir, 'report.json'), report)
  return report
}

// Synchronous read used only by the in-memory version probe. The canary has
// already created the file and keeps raw fixture bytes out of durable evidence.
function readFileSyncSync(path: string): string {
  // eslint-disable-next-line no-sync
  return readFileSyncNative(path, 'utf8')
}

// Isolated require avoids changing the async fs contract used by the runner.
import { readFileSync as readFileSyncNative } from 'node:fs'
