import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1JsonlLiveBindingEvidenceSink,
  C1LiveBindingDriver,
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  type C1LiveModelResponse
} from '../src/c1-live-binding'
import {
  C1HardBudgetGuard,
  computeC1FixtureContentSummary,
  prepareC1StrictProvider,
  type C1PreflightTask
} from '../src/c1-live-preflight'
import { C1LiveTaskObservationSource } from '../src/c1-live-study'
import {
  applyC1SupersededVersionPolicy,
  c1SupersededVersionCommittedKeys
} from '../src/c1-superseded-version-policy'

/**
 * Driver-level fake-source mechanism validation for SUPERSEDED_VERSION
 * (lifecycle contract §11 step 2). Scripted trajectory read -> edit -> later
 * requests; the Runtime arm must evict the stale read pair at the first
 * post-edit request and sustain the eviction afterwards, with zero provider
 * calls. The edit is executed for real inside the sandbox, so the policy's
 * version probe observes the actual v2 fingerprint.
 */

const A_JS_V1 = 'export const value = 1;\n'
const README = '# SV probe\nThe diagnostic marker is SV-OK.\n'
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

function scriptedResponses(): C1LiveModelResponse[] {
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
      responseId: 'sv-1',
      assistantMessageCount: 1,
      assistantContent: '',
      usage,
      toolRequests: [
        { toolCallId: 'sv-read-1', toolName: 'read', argumentsJson: '{"path":"src/a.js"}' }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: 'sv-2',
      assistantMessageCount: 1,
      assistantContent: '',
      usage,
      toolRequests: [
        {
          toolCallId: 'sv-edit-1',
          toolName: 'edit',
          argumentsJson: '{"path":"src/a.js","oldText":"value = 1","newText":"value = 2"}'
        }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: 'sv-3',
      assistantMessageCount: 1,
      assistantContent: '',
      usage,
      toolRequests: [
        { toolCallId: 'sv-read-2', toolName: 'read', argumentsJson: '{"path":"README.md"}' }
      ],
      toolExecutions: [],
      outcome: 'CONTINUE'
    },
    {
      responseId: 'sv-4',
      assistantMessageCount: 1,
      assistantContent: 'SV-OK',
      usage,
      toolRequests: [],
      toolExecutions: [],
      outcome: 'COMPLETE'
    }
  ]
}

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sv-probe-fixture-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'README.md'), README)
  await writeFile(join(root, 'src', 'a.js'), A_JS_V1)
  return root
}

async function runSvLeg(root: string, outputRoot: string, arm: 'NATIVE' | 'RUNTIME') {
  const summary = await computeC1FixtureContentSummary(root)
  const studyId = 'c1-mechanism-20260908-svprobe1'
  const task: C1PreflightTask = {
    taskId: 'c1-superseded-version-probe-v1',
    stratum: 'CONTROLLED_SUPERSEDED_VERSION',
    title: 'Read then edit supersedes stale read evidence',
    fixtureVersion: 'INLINE_SYNTHETIC_SV1',
    fixturePath: 'INLINE_SYNTHETIC/src/a.js',
    fixtureRevision: {
      baseRevision: 'fake-only',
      fixtureTreeObjectId: createHash('sha1').update(summary.sha256).digest('hex'),
      fixtureContentSha256: summary.sha256
    },
    prompt: 'Read src/a.js, edit it, read README.md, then answer with the marker.',
    promptSha256: sha256('sv-probe-prompt'),
    objectiveOracle: { command: 'node', args: [], expectedExitCode: 0, timeoutMs: 1 },
    regressionOracle: { command: 'node', args: [], expectedExitCode: 0, timeoutMs: 1 },
    expectedWritablePaths: [],
    relevantSources: [],
    distractorSources: [],
    requiredLaterSources: []
  }
  const binding = await prepareC1StrictProvider({ runIdentity: `${studyId}-${arm}` })
  try {
    const driver = new C1LiveBindingDriver({
      providerBinding: binding,
      evidenceSink: new C1JsonlLiveBindingEvidenceSink(
        join(outputRoot, `${arm}-checkpoints.jsonl`)
      ),
      budgetGuard: new C1HardBudgetGuard({
        perLeg: { maxProviderCalls: 4, maxToolCalls: 3, maxWallClockMs: 120000 },
        study: { maxProviderCalls: 8, maxToolCalls: 6, maxWallClockMs: 240000, maxLegs: 2 }
      })
    })
    const observations = await C1LiveTaskObservationSource.fromFixture({
      task,
      runId: 'sv-probe-shared-bootstrap',
      fixtureRoot: root
    })
    const sandbox = new C1SandboxToolExecutor(root)
    const source = new C1ScriptedResponseSource(scriptedResponses())
    let answerMatched = false
    return await driver.runLeg({
      studyId,
      task,
      stratum: task.stratum,
      pairId: 'sv-p01',
      arm,
      runId: `${studyId}-${arm}`,
      fixtureContentSha256: summary.sha256,
      fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
      runtimeSessionId: `${studyId}-runtime`,
      maxCalls: 4,
      responseAbortSignal: new AbortController().signal,
      observationSource: {
        initialObservation: observations.initialObservation,
        next: (input) => {
          const observation = observations.next(input)
          if (arm !== 'RUNTIME') return observation
          return applyC1SupersededVersionPolicy(
            observation,
            c1SupersededVersionCommittedKeys(input.previousExecution),
            {
              versionProbe: (path) => {
                try {
                  return sha256(readFileSync(join(root, path), 'utf8'))
                } catch {
                  return undefined
                }
              }
            }
          )
        }
      },
      responseSource: {
        kind: 'SCRIPTED_FAKE',
        next: async (request, options) => {
          const response = await source.next(request)
          if (response.outcome !== 'CONTINUE')
            answerMatched = response.assistantContent.trim() === 'SV-OK'
          return response
        }
      },
      toolExecutor: sandbox
    }).then((result) => ({ result, answerMatched }))
  } finally {
    binding.dispose()
  }
}

describe('SUPERSEDED_VERSION driver-level mechanism validation (fake source)', () => {
  it('evicts the stale read pair at the first post-edit request and sustains it', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'sv-probe-out-'))
    const nativeRoot = await makeFixture()
    const runtimeRoot = await makeFixture()
    try {
      const native = await runSvLeg(nativeRoot, outputRoot, 'NATIVE')
      expect(native.result.finalOutcome).toBe('COMPLETE')
      expect(native.answerMatched).toBe(true)
      expect(native.result.evidence.every((row) => !row.runtimeContextChanged)).toBe(true)

      // The scripted edit really happened; the probe must see v2.
      expect(readFileSync(join(nativeRoot, 'src', 'a.js'), 'utf8')).toBe(
        'export const value = 2;\n'
      )

      const runtime = await runSvLeg(runtimeRoot, outputRoot, 'RUNTIME')
      expect(runtime.result.finalOutcome).toBe('COMPLETE')
      expect(runtime.answerMatched).toBe(true)
      const changed = runtime.result.evidence
        .filter((row) => row.runtimeContextChanged)
        .map((row) => row.callOrdinal)
      expect(changed).toEqual([3, 4])

      const postEdit = runtime.result.evidence.find((row) => row.callOrdinal === 3)!
      const removals = (postEdit.decisionDetails ?? []).filter(
        (decision) => decision.kind === 'REMOVE'
      )
      expect(removals).toHaveLength(2)
      expect(
        removals.every(
          (decision) =>
            decision.reasonCodes.includes('SUPERSEDED') &&
            decision.sourceVersionId.length > 0 &&
            decision.sourceKey.includes('sv-read-1')
        )
      ).toBe(true)
      expect(postEdit.providerBoundSourceKeys.some((key) => key.includes('sv-read-1'))).toBe(false)
      expect(postEdit.providerBoundSourceKeys.some((key) => key.includes('sv-edit-1'))).toBe(true)
      // Bootstrap pair stays: README was never edited before call 3.
      expect(postEdit.providerBoundSourceKeys.some((key) => key.includes('bootstrap'))).toBe(true)

      const last = runtime.result.evidence.at(-1)!
      const carried = last.carriedRemovedSourceKeys ?? []
      expect(carried).toHaveLength(2)
      expect(carried.every((key) => key.includes('sv-read-1'))).toBe(true)
      expect(last.providerBoundSourceKeys.some((key) => key.includes('sv-read-1'))).toBe(false)
      expect(last.carriedRemovalEvidence?.[0]?.removalTransitionId).toBeTruthy()
    } finally {
      await rm(nativeRoot, { recursive: true, force: true })
      await rm(runtimeRoot, { recursive: true, force: true })
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)
})
