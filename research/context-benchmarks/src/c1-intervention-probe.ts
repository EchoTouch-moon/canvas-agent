import { runProcess, buildSanitizedChildEnvironment } from './fixture-generator'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyC1DuplicateReadPolicy,
  c1KnownCommittedSourceKeys,
  C1_DUPLICATE_READ_POLICY_ID
} from './c1-duplicate-read-policy'
import {
  C1SandboxToolExecutor,
  C1ScriptedResponseSource,
  type C1LiveModelResponse
} from './c1-live-binding'
import { C1LiveTaskObservationSource, C1StudyOrchestrator } from './c1-live-study'
import { runC1TreatmentReadiness } from './c1-treatment-readiness'

/** Paired deterministic mechanism experiment. Never uses an authorized response source. */
export async function runC1InterventionProbe(repoRoot: string) {
  const revision = await runProcess('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    timeoutMs: 30000,
    env: buildSanitizedChildEnvironment()
  })
  if (revision.exitCode !== 0) throw new Error('Cannot bind probe revision')
  const paths = [
    'c1-intervention-probe',
    'c1-duplicate-read-policy',
    'c1-carried-removals',
    'c1-live-binding',
    'c1-live-preflight',
    'c1-live-study',
    'c1-call-accounting'
  ]
  const sourceSha256 = Object.fromEntries(
    await Promise.all(
      paths.map(async (name) => {
        const path = `research/context-benchmarks/src/${name}.ts`
        return [
          path,
          createHash('sha256')
            .update(await readFile(join(repoRoot, path)))
            .digest('hex')
        ]
      })
    )
  )
  const root = await mkdtemp(join(tmpdir(), 'c1-intervention-probe-'))
  const variants = []
  try {
    for (const candidate of [false, true]) {
      const signal = new EventEmitter()
      let fakeResponses = 0
      const inputs: { arm: string; callOrdinal: number; fingerprint: string }[] = []
      const report = await new C1StudyOrchestrator({
        repoRoot,
        outputRoot: join(root, candidate ? 'candidate' : 'baseline'),
        studyId: `c1-20260908-c1-feasibility-v1-${candidate ? 'bbbbbbbb' : 'aaaaaaaa'}`,
        runId: 'C1_INTERVENTION_PROBE',
        executionMode: 'SCRIPTED_MECHANISM_PROBE_NOT_LIVE',
        responseSourceKind: 'SCRIPTED_FAKE',
        dryRun: false,
        maxCalls: 3,
        signalSource: signal,
        beforeLeg: (plan) => {
          if (plan.legIndex === 2) signal.emit('SIGINT')
        },
        responseSourceFactory: () => {
          const responses: C1LiveModelResponse[] = [1, 2, 3].map((ordinal) => ({
            responseId: `probe-response-${ordinal}`,
            assistantMessageCount: 1,
            assistantContent: '',
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
                      toolCallId: `probe-read-${ordinal}`,
                      toolName: 'read',
                      argumentsJson: '{"path":"README.md"}'
                    }
                  ]
                : [],
            toolExecutions: [],
            outcome: ordinal < 3 ? 'CONTINUE' : 'COMPLETE'
          }))
          const source = new C1ScriptedResponseSource(responses)
          return {
            kind: 'SCRIPTED_FAKE',
            next: async (request) => {
              fakeResponses += 1
              return source.next(request)
            }
          }
        },
        observationSourceFactory: async (input) => {
          // Shared IDs and exact same fixed fixture content give equal pre-policy inputs.
          const source = await C1LiveTaskObservationSource.fromFixture({
            task: input.task,
            runId: 'shared-probe-observation',
            fixtureRoot: input.fixtureRoot
          })
          function observe(
            observation: typeof source.initialObservation,
            callOrdinal: number,
            committedKeys: ReadonlySet<string> = new Set()
          ) {
            inputs.push({
              arm: input.plan.arm,
              callOrdinal,
              fingerprint: createHash('sha256')
                .update(JSON.stringify(observation.messages))
                .digest('hex')
            })
            return candidate && input.plan.arm === 'RUNTIME'
              ? applyC1DuplicateReadPolicy(observation, committedKeys)
              : observation
          }
          return {
            initialObservation: observe(source.initialObservation, 1),
            next: (next) =>
              observe(
                source.next(next),
                next.callOrdinal + 1,
                c1KnownCommittedSourceKeys(next.previousExecution)
              )
          }
        },
        toolExecutorFactory: (input) => new C1SandboxToolExecutor(input.fixtureRoot)
      }).run()
      if (report.reportDir === null) throw new Error('probe produced no evidence directory')
      const rows = (await readFile(join(report.reportDir, 'decision-evidence.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              arm: string
              callOrdinal: number
              runtimeContextChanged: boolean
              lifecycleEligible: boolean
              carriedRemovedSourceKeys: string[]
              transitionDecisionKinds: string[]
              modelVisibleSemanticContextFingerprint: string
              providerBoundSourceKeys: string[]
              systemDeveloperToolStructuresFingerprint: string
              fallbackSent: boolean
              networkSent: boolean
            }
        )
      const native = rows.filter((row) => row.arm === 'NATIVE')
      const runtime = rows.filter((row) => row.arm === 'RUNTIME')
      const equalInputs = [1, 2, 3].every((ordinal) => {
        const a = inputs.find((row) => row.arm === 'NATIVE' && row.callOrdinal === ordinal)
        const b = inputs.find((row) => row.arm === 'RUNTIME' && row.callOrdinal === ordinal)
        return a !== undefined && b !== undefined && a.fingerprint === b.fingerprint
      })
      const changedCalls = runtime
        .filter((row) => row.runtimeContextChanged)
        .map((row) => row.callOrdinal)
      const removalEntries = runtime
        .flatMap((row) => row.transitionDecisionKinds)
        .filter((kind) => kind === 'REMOVE').length
      const equalStructure =
        native.length === 3 &&
        runtime.length === 3 &&
        native.every(
          (row, i) =>
            row.systemDeveloperToolStructuresFingerprint ===
            runtime[i]!.systemDeveloperToolStructuresFingerprint
        )
      const pass =
        report.legsCompleted === 2 &&
        report.legsAttempted === 2 &&
        fakeResponses === 6 &&
        report.studyTerminal &&
        report.operatorSignal === 'SIGINT' &&
        equalInputs &&
        equalStructure &&
        rows.every((row) => !row.networkSent && !row.fallbackSent) &&
        (candidate
          ? runtime[2]?.carriedRemovedSourceKeys.length === 2 &&
            runtime[2]?.providerBoundSourceKeys.length === 2 &&
            changedCalls.join(',') === '2,3' &&
            removalEntries > 0
          : changedCalls.length === 0 && removalEntries === 0)
      variants.push({
        variant: candidate ? C1_DUPLICATE_READ_POLICY_ID : 'FROZEN_OBSERVATION_BASELINE',
        status: pass ? 'PASS' : 'FAIL',
        fakeResponses,
        completedLegs: report.legsCompleted,
        inputMessageFingerprintsEqual: equalInputs,
        structuralFingerprintsEqual: equalStructure,
        changedCalls,
        removalDecisionEntries: removalEntries,
        boundaryEvidence: rows.map((row) => ({
          arm: row.arm,
          callOrdinal: row.callOrdinal,
          changed: row.runtimeContextChanged,
          eligible: row.lifecycleEligible,
          semanticFingerprint: row.modelVisibleSemanticContextFingerprint,
          carriedRemovedSourceKeys: row.carriedRemovedSourceKeys,
          sourceKeys: row.providerBoundSourceKeys
        })),
        inputEvidence: inputs,
        stop:
          report.operatorSignal === 'SIGINT' ? 'INTENTIONAL_AFTER_ONE_PAIR' : 'FAILED_BEFORE_BOUND',
        failureCodes: report.failures.map((failure) => failure.code),
        terminalReason: report.terminalReason,
        providerCalls: report.providerCalls,
        networkRequests: report.networkRequests
      })
    }
    const readiness = runC1TreatmentReadiness()
    return {
      experimentId: 'C1_INTERVENTION_REACHABILITY_OFFLINE_V1',
      baselineRevision: revision.stdout.trim(),
      sourceSha256,
      status:
        variants.every((variant) => variant.status === 'PASS') &&
        readiness.overallVerdict === 'PASS'
          ? 'PASS'
          : 'FAIL',
      scope: 'CONTROLLED_DUPLICATE_READ_MECHANISM_NOT_NATURAL_TASK_EFFECTIVENESS',
      providerCalls: 0,
      networkRequests: 0,
      variants,
      existingLifecycleReadiness: readiness.overallVerdict,
      limitations: [
        'Scripted responses are not provider behavior.',
        'Synthetic usage cannot estimate efficiency.',
        'V4 metadata lacks read content; historical duplicate opportunities remain unknown.',
        'Existing readiness covers controlled restoration; this candidate only supersedes duplicate reads.'
      ]
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
