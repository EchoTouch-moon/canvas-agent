import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  type C1AgentObservation,
  type C1PreflightTask
} from '../src/c1-live-preflight'
import { C1LiveTaskObservationSource } from '../src/c1-live-study'
import {
  applyC1SupersededVersionPolicy,
  c1SupersededVersionCommittedKeys
} from '../src/c1-superseded-version-policy'
import {
  adjudicateC1LifecycleReplayRecord,
  captureC1LifecycleReplayEvidence,
  reconcileC1LifecycleReplayCall,
  type C1LifecycleReplayRecord
} from '../src/c1-lifecycle-replay-evidence'
import type { PiMessageView } from '@canvas-agent/pi-context-integration'

const A_JS_V1 = 'export const value = 1;\n'
const A_JS_V2 = 'export const value = 2;\n'
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

async function runReplayLeg(root: string, outputRoot: string) {
  const summary = await computeC1FixtureContentSummary(root)
  const studyId = 'c1-mechanism-20260908-svreplay'
  const runId = `${studyId}-RUNTIME`
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
  const binding = await prepareC1StrictProvider({ runIdentity: runId })
  const captured: C1LifecycleReplayRecord[] = []
  const versionProbe = (path: string) => {
    try {
      return sha256(readFileSync(join(root, path), 'utf8'))
    } catch {
      return undefined
    }
  }
  try {
    const driver = new C1LiveBindingDriver({
      providerBinding: binding,
      evidenceSink: new C1JsonlLiveBindingEvidenceSink(join(outputRoot, 'checkpoints.jsonl')),
      budgetGuard: new C1HardBudgetGuard({
        perLeg: { maxProviderCalls: 4, maxToolCalls: 3, maxWallClockMs: 120000 },
        study: { maxProviderCalls: 8, maxToolCalls: 6, maxWallClockMs: 240000, maxLegs: 2 }
      })
    })
    const observations = await C1LiveTaskObservationSource.fromFixture({
      task,
      runId: 'sv-replay-shared-bootstrap',
      fixtureRoot: root
    })
    const source = new C1ScriptedResponseSource(scriptedResponses())
    const result = await driver.runLeg({
      studyId,
      task,
      stratum: task.stratum,
      pairId: 'sv-p01',
      arm: 'RUNTIME',
      runId,
      fixtureContentSha256: summary.sha256,
      fixtureTreeObjectId: task.fixtureRevision.fixtureTreeObjectId,
      runtimeSessionId: `${studyId}-runtime`,
      maxCalls: 4,
      responseAbortSignal: new AbortController().signal,
      observationSource: {
        initialObservation: observations.initialObservation,
        next: (input) => {
          const observation = observations.next(input)
          const committed = c1SupersededVersionCommittedKeys(input.previousExecution)
          captured.push(
            ...captureC1LifecycleReplayEvidence(observation, {
              runId,
              callOrdinal: input.callOrdinal + 1,
              knownCommittedSourceKeys: committed,
              versionProbe
            })
          )
          return applyC1SupersededVersionPolicy(observation, committed, { versionProbe })
        }
      },
      responseSource: { kind: 'SCRIPTED_FAKE', next: (request) => source.next(request) },
      toolExecutor: new C1SandboxToolExecutor(root)
    })
    return { result, captured }
  } finally {
    binding.dispose()
  }
}

describe('fingerprint-only lifecycle replay evidence', () => {
  it('re-adjudicates the live decisions from stored inputs alone (MATCH), with zero content leakage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sv-replay-fixture-'))
    const outputRoot = await mkdtemp(join(tmpdir(), 'sv-replay-out-'))
    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'README.md'), README)
      await writeFile(join(root, 'src', 'a.js'), A_JS_V1)
      const { result, captured } = await runReplayLeg(root, outputRoot)
      expect(result.finalOutcome).toBe('COMPLETE')

      // Call 2 (before the edit): the model read pair exists, no mutation yet.
      const call2 = captured.filter((record) => record.callOrdinal === 2)
      const early = call2.find((record) => record.readCallId === 'sv-read-1')!
      expect(early.mutation).toBeNull()
      expect(adjudicateC1LifecycleReplayRecord(early)).toBe('NOT_CANDIDATE')

      // Call 3 (first post-edit request): five-condition inputs all present.
      const call3 = captured.filter((record) => record.callOrdinal === 3)
      const stale = call3.find((record) => record.readCallId === 'sv-read-1')!
      expect(stale).toMatchObject({
        pairShape: 'ISOLATED_CLEAN',
        protected: false,
        committed: true,
        beforeVersionFingerprint: sha256(A_JS_V1),
        mutation: { callId: 'sv-edit-1', tool: 'edit', succeeded: true },
        after: { probeStatus: 'OBSERVED', versionFingerprint: sha256(A_JS_V2) }
      })
      expect(adjudicateC1LifecycleReplayRecord(stale)).toBe('SUPERSEDED')

      // Replay verdicts vs the live policy's actual removals at call 3.
      const postEdit = result.evidence.find((row) => row.callOrdinal === 3)!
      const removedKeys = (postEdit.decisionDetails ?? [])
        .filter((decision) => decision.kind === 'REMOVE')
        .map((decision) => decision.sourceKey)
      const reconciliation = reconcileC1LifecycleReplayCall({
        records: call3,
        removedSourceKeys: removedKeys
      })
      expect(reconciliation.verdict).toBe('MATCH')
      expect(reconciliation.supersededCallIds).toEqual(['sv-read-1'])

      // No raw content anywhere in the persisted records.
      const serialized = JSON.stringify(captured)
      for (const forbidden of [
        'value = 1',
        'value = 2',
        'export const',
        'SV-OK',
        'oldText',
        'newText',
        'diagnostic marker'
      ]) {
        expect(serialized).not.toContain(forbidden)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outputRoot, { recursive: true, force: true })
    }
  }, 60000)

  const baseRecord: C1LifecycleReplayRecord = {
    schemaVersion: 1,
    kind: 'C1_LIFECYCLE_REPLAY_RECORD',
    runId: 'unit',
    callOrdinal: 3,
    readCallId: 'r1',
    path: 'src/a.js',
    pairShape: 'ISOLATED_CLEAN',
    protected: false,
    committed: true,
    beforeVersionFingerprint: 'a'.repeat(64),
    mutation: { callId: 'e1', tool: 'edit', succeeded: true },
    after: { probeStatus: 'OBSERVED', versionFingerprint: 'b'.repeat(64) },
    pairFingerprint: 'c'.repeat(64),
    sourceKeys: ['run/tool-call://r1', 'run/tool-result://r1']
  }

  it.each([
    ['SUPERSEDED', {}, 'SUPERSEDED'],
    [
      'UNKNOWN when the probe is unobservable',
      { after: { probeStatus: 'UNOBSERVABLE', versionFingerprint: null } },
      'UNKNOWN'
    ],
    [
      'NOT_SUPERSEDED when the version is unchanged',
      { after: { probeStatus: 'OBSERVED', versionFingerprint: 'a'.repeat(64) } },
      'NOT_SUPERSEDED'
    ],
    ['NOT_CANDIDATE without a later mutation', { mutation: null }, 'NOT_CANDIDATE'],
    ['NOT_CANDIDATE when guarded', { pairShape: 'GUARDED' }, 'NOT_CANDIDATE'],
    ['NOT_CANDIDATE when protected', { protected: true }, 'NOT_CANDIDATE'],
    ['NOT_CANDIDATE when uncommitted', { committed: false }, 'NOT_CANDIDATE']
  ] as const)('adjudicates %s', (_name, patch, expected) => {
    expect(
      adjudicateC1LifecycleReplayRecord({
        ...baseRecord,
        ...(patch as Partial<C1LifecycleReplayRecord>)
      })
    ).toBe(expected)
  })

  it('flags CONTRACT_CONFLICT only when live removals and replay verdicts diverge', () => {
    const match = reconcileC1LifecycleReplayCall({
      records: [baseRecord],
      removedSourceKeys: baseRecord.sourceKeys
    })
    expect(match.verdict).toBe('MATCH')
    const liveKept = reconcileC1LifecycleReplayCall({
      records: [baseRecord],
      removedSourceKeys: []
    })
    expect(liveKept.verdict).toBe('CONTRACT_CONFLICT')
    expect(liveKept.conflicts[0]).toContain('replay SUPERSEDED but live kept')
    const liveRemovedExtra = reconcileC1LifecycleReplayCall({
      records: [baseRecord],
      removedSourceKeys: [...baseRecord.sourceKeys, 'run/tool-call://other']
    })
    expect(liveRemovedExtra.verdict).toBe('CONTRACT_CONFLICT')
    expect(liveRemovedExtra.conflicts[0]).toContain('live removed without replay SUPERSEDED')
  })
})
