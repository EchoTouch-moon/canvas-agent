import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '@canvas-agent/context-runtime'
import {
  RepositoryObserver,
  type RepositoryFileObservation
} from '@canvas-agent/repository-observer'
import { runGitCommand, type GitRunOptions } from '@canvas-agent/worker-runtime'
import {
  CandidateIdentityMapper,
  instanceIdFor,
  normalizeSourcePath,
  runIdentityTrace
} from '../../context-runtime/tests/fixtures/source-identity/candidate'
import {
  assertNoOracleFailures,
  validateIdentitySafetyInvariants,
  validateObservationBindings
} from '../../context-runtime/tests/fixtures/source-identity/oracle'
import type {
  CandidateEvidenceInput,
  ConservativeObservation,
  IdentityDecision,
  IdentityTrace
} from '../../context-runtime/tests/fixtures/source-identity/types'
import { decomposePiMessage, type PiMessageView } from '../src'
import {
  mapPiReadResultsToCandidateEvidence,
  type PiReadAuthority
} from './fixtures/lc1-pi-identity-bridge'

const PATH = 'src/reopen-a.ts'
const CONTENT_V3 = 'export const value = "reopen-a:v3"\n'
const CONTENT_V4 = 'export const value = "reopen-a:v4"\n'
const T0 = '2026-08-30T00:00:00.000Z'

interface TempRepository {
  readonly directory: string
  readonly git: (args: readonly string[]) => Promise<string>
  readonly readRevision: () => Promise<RepositoryRevision>
}

interface RepositoryRevision {
  readonly baseCommit: string
  readonly treeHash: string
  readonly workingTreePatchHash: string | null
}

const repositories: TempRepository[] = []

function gitOptions(cwd: string): GitRunOptions {
  return {
    cwd,
    timeoutMs: 30_000,
    maxOutputBytes: 2 * 1024 * 1024,
    commandAllowlist: ['git'],
    signal: undefined
  }
}

async function createRepository(content: string): Promise<TempRepository> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-lc1-repository-bridge-'))
  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, gitOptions(directory))
    if (result.exitCode !== 0) {
      throw new Error(`git failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout.trim()
  }
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'lc1@canvas.local'])
  await git(['config', 'user.name', 'LC1 Repository Bridge'])
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, PATH), content, 'utf8')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'fixture'])
  const readRevision = async (): Promise<RepositoryRevision> => ({
    baseCommit: await git(['rev-parse', 'HEAD']),
    treeHash: await git(['rev-parse', 'HEAD^{tree}']),
    workingTreePatchHash: null
  })
  const repository = { directory, git, readRevision }
  repositories.push(repository)
  return repository
}

afterEach(async () => {
  await Promise.all(
    repositories
      .splice(0)
      .map((repository) => rm(repository.directory, { recursive: true, force: true }))
  )
})

function toolMessages(callId: string, path = PATH, content = CONTENT_V3): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name: 'read', arguments: { path } }]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: content }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function bridgeContext(
  runtimeSessionId: string,
  modelCallSequence: number,
  repositoryId = 'real-repository-a',
  namespace = 'repository-file'
) {
  return { runtimeSessionId, modelCallSequence, repositoryId, namespace }
}

function revisionId(revision: RepositoryRevision): string {
  return `git:${revision.baseCommit}:${revision.treeHash}:${revision.workingTreePatchHash ?? '-'}`
}

function readPaths(
  messages: readonly PiMessageView[],
  runtimeSessionId: string,
  modelCallSequence: number
): string[] {
  const paths = new Set<string>()
  messages.forEach((message, messagePosition) => {
    const entries = requirePiDecomposition(
      message,
      runtimeSessionId,
      modelCallSequence,
      messagePosition
    )
    for (const entry of entries) {
      if (entry.element.elementKind !== 'TOOL_CALL' || entry.element.toolName !== 'read') continue
      for (const hint of entry.attribution.resourceHints ?? []) {
        if (hint.sourceKey.startsWith('repository/file://')) {
          try {
            paths.add(normalizeSourcePath(hint.sourceKey.slice('repository/file://'.length)))
          } catch {
            // Unsafe hints stay out of the authoritative request entirely.
          }
        }
      }
    }
  })
  return [...paths].sort()
}

function requirePiDecomposition(
  message: PiMessageView,
  runtimeSessionId: string,
  modelCallSequence: number,
  messagePosition: number
) {
  return decomposePiMessageForTest(message, {
    runtimeSessionId,
    modelCallSequence,
    messagePosition
  })
}

function decomposePiMessageForTest(
  message: PiMessageView,
  ctx: {
    readonly runtimeSessionId: string
    readonly modelCallSequence: number
    readonly messagePosition: number
  }
) {
  return decomposePiMessage(message, ctx)
}

async function observeAuthorities(
  repository: TempRepository,
  messages: readonly PiMessageView[],
  context: ReturnType<typeof bridgeContext>,
  expectedRevision: RepositoryRevision
): Promise<readonly PiReadAuthority[]> {
  const observations = await new RepositoryObserver().observe({
    repositoryPath: repository.directory,
    expectedRevision,
    paths: readPaths(messages, context.runtimeSessionId, context.modelCallSequence),
    observedAt: T0
  })
  return observations.map((observation) => authorityFromObservation(observation, context))
}

function authorityFromObservation(
  observation: RepositoryFileObservation,
  context: ReturnType<typeof bridgeContext>
): PiReadAuthority {
  const path = observation.sourceKey.slice('repository/file://'.length)
  const base = {
    repositoryId: context.repositoryId,
    namespace: context.namespace,
    path,
    universeRevision: revisionId(observation.expectedRevision),
    representationKind: 'FULL' as const
  }
  if (observation.observation.status === 'AVAILABLE') {
    return { ...base, status: 'AVAILABLE', contentHash: observation.observation.contentHash }
  }
  if (observation.observation.status === 'UNAVAILABLE') {
    return { ...base, status: 'UNAVAILABLE', unavailableReason: observation.observation.reasonCode }
  }
  return { ...base, status: 'ABSENT' }
}

function decision(value: IdentityDecision | ConservativeObservation): IdentityDecision {
  if ('outcome' in value) throw new Error(`expected decision, got ${value.outcome}`)
  return value
}

function observation(value: IdentityDecision | ConservativeObservation): ConservativeObservation {
  if (!('outcome' in value)) throw new Error(`expected observation, got ${value.kind}`)
  return value
}

function availableEvidence(value: CandidateEvidenceInput) {
  if (value.status !== 'AVAILABLE') throw new Error(`expected AVAILABLE, got ${value.status}`)
  return value
}

describe('LC1 real RepositoryObserver to Pi identity bridge candidate', () => {
  it('uses a clean Git authority to complete ADD -> REMOVE -> REHYDRATE', async () => {
    const repository = await createRepository(CONTENT_V3)
    const firstMessages = toolMessages('real-call-1')
    const laterMessages = toolMessages('real-call-2', './src\\reopen-a.ts')
    const revision = await repository.readRevision()
    const firstAuthority = await observeAuthorities(
      repository,
      firstMessages,
      bridgeContext('real-session', 1),
      revision
    )
    const laterAuthority = await observeAuthorities(
      repository,
      laterMessages,
      bridgeContext('real-session', 2),
      revision
    )
    const first = mapPiReadResultsToCandidateEvidence(
      firstMessages,
      bridgeContext('real-session', 1),
      firstAuthority
    )
    const later = mapPiReadResultsToCandidateEvidence(
      laterMessages,
      bridgeContext('real-session', 2),
      laterAuthority
    )
    expect(first.unmapped).toEqual([])
    expect(later.unmapped).toEqual([])
    expect(first.mapped[0]?.evidence).toMatchObject({
      status: 'AVAILABLE',
      contentHash: sha256Hex(CONTENT_V3),
      universeRevision: revisionId(revision)
    })

    const mapper = new CandidateIdentityMapper()
    const initial = decision(mapper.observe('E1', 'T1', first.mapped[0]!.evidence))
    mapper.commit(initial)
    const removed = mapper.remove('T2', initial.evidenceInstanceId!, ['RULED_OUT'])
    const rehydrated = decision(mapper.observe('E3', 'T3', later.mapped[0]!.evidence))

    expect(removed.kind).toBe('REMOVE')
    expect(rehydrated.kind).toBe('REHYDRATE')
    expect(rehydrated.subjectKey).toBe(initial.subjectKey)
    expect(rehydrated.sourceVersionId).toBe(initial.sourceVersionId)
    expect(rehydrated.evidenceInstanceId).not.toBe(initial.evidenceInstanceId)
    expect(rehydrated.originatingRemoveTransitionId).toBe('T2')
    mapper.commit(rehydrated)
  })

  it('turns a dirty working tree into UNAVAILABLE and never into false authority', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revision = await repository.readRevision()
    await writeFile(join(repository.directory, PATH), CONTENT_V4, 'utf8')
    const messages = toolMessages('dirty-call')
    const context = bridgeContext('dirty-session', 1)
    const authorities = await observeAuthorities(repository, messages, context, revision)
    expect(authorities).toHaveLength(1)
    expect(authorities[0]).toMatchObject({
      status: 'UNAVAILABLE',
      unavailableReason: 'REVISION_MISMATCH'
    })

    const mapped = mapPiReadResultsToCandidateEvidence(messages, context, authorities)
    expect(mapped.unmapped).toEqual([])
    const evidence = mapped.mapped[0]?.evidence
    expect(evidence?.status).toBe('UNAVAILABLE')
    if (evidence === undefined) throw new Error('expected dirty evidence')
    const result = observation(new CandidateIdentityMapper().observe('E1', 'T1', evidence))
    expect(result).toMatchObject({
      status: 'UNAVAILABLE',
      sourceVersionId: null,
      outcome: 'CONSERVATIVE_KEEP'
    })
  })

  it('binds committed versions and explicit deletion without inferring ABSENT', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revisionV3 = await repository.readRevision()
    const firstMessages = toolMessages('version-call-1')
    const firstContext = bridgeContext('version-session', 1)
    const firstAuthority = await observeAuthorities(
      repository,
      firstMessages,
      firstContext,
      revisionV3
    )
    const mapper = new CandidateIdentityMapper()
    const initial = decision(
      mapper.observe(
        'E1',
        'T1',
        availableEvidence(
          mapPiReadResultsToCandidateEvidence(firstMessages, firstContext, firstAuthority)
            .mapped[0]!.evidence
        )
      )
    )
    mapper.commit(initial)
    mapper.remove('T2', initial.evidenceInstanceId!, ['RULED_OUT'])

    await writeFile(join(repository.directory, PATH), CONTENT_V4, 'utf8')
    await repository.git(['add', '-A'])
    await repository.git(['commit', '-q', '-m', 'v4'])
    const revisionV4 = await repository.readRevision()
    const v4Messages = toolMessages('version-call-2', PATH, CONTENT_V4)
    const v4Context = bridgeContext('version-session', 2)
    const v4Authority = await observeAuthorities(repository, v4Messages, v4Context, revisionV4)
    const next = decision(
      mapper.observe(
        'E3',
        'T3',
        mapPiReadResultsToCandidateEvidence(v4Messages, v4Context, v4Authority).mapped[0]!.evidence
      )
    )
    expect(next.kind).toBe('ADD')
    expect(next.sourceVersionId).not.toBe(initial.sourceVersionId)
    expect(next.originatingRemoveTransitionId).toBeNull()
    mapper.commit(next)

    await repository.git(['rm', '-q', PATH])
    await repository.git(['commit', '-q', '-m', 'remove fixture'])
    const revisionAbsent = await repository.readRevision()
    const absentMessages = toolMessages('absent-call', PATH, '')
    const absentContext = bridgeContext('version-session', 3)
    const absentAuthority = await observeAuthorities(
      repository,
      absentMessages,
      absentContext,
      revisionAbsent
    )
    expect(absentAuthority[0]).toMatchObject({ status: 'ABSENT', path: PATH })
    const absentEvidence = mapPiReadResultsToCandidateEvidence(
      absentMessages,
      absentContext,
      absentAuthority
    )
    expect(absentEvidence.unmapped).toEqual([])
    const absent = observation(mapper.observe('E4', 'T4', absentEvidence.mapped[0]!.evidence))
    expect(absent).toMatchObject({
      status: 'ABSENT',
      sourceVersionId: null,
      outcome: 'CONFIRMED_ABSENT'
    })
  })

  it('replays real-authority evidence through LC1 safety checks with stable trace hash', async () => {
    const repository = await createRepository(CONTENT_V3)
    const revision = await repository.readRevision()
    const firstMessages = toolMessages('trace-call-1')
    const laterMessages = toolMessages('trace-call-2')
    const first = availableEvidence(
      mapPiReadResultsToCandidateEvidence(
        firstMessages,
        bridgeContext('trace-session', 1),
        await observeAuthorities(
          repository,
          firstMessages,
          bridgeContext('trace-session', 1),
          revision
        )
      ).mapped[0]!.evidence
    )
    const later = availableEvidence(
      mapPiReadResultsToCandidateEvidence(
        laterMessages,
        bridgeContext('trace-session', 2),
        await observeAuthorities(
          repository,
          laterMessages,
          bridgeContext('trace-session', 2),
          revision
        )
      ).mapped[0]!.evidence
    )
    const firstId = instanceIdFor(first)
    const laterId = instanceIdFor(later)
    const trace: IdentityTrace = {
      id: 'REAL-PI-BRIDGE-TRACE',
      events: [
        { kind: 'OBSERVE', id: 'E1', transitionId: 'T1', observation: first },
        { kind: 'KEEP', id: 'E2', transitionId: 'T2', evidenceInstanceId: firstId },
        {
          kind: 'REMOVE',
          id: 'E3',
          transitionId: 'T3',
          evidenceInstanceId: firstId,
          reasonCodes: ['RULED_OUT']
        },
        { kind: 'OBSERVE', id: 'E4', transitionId: 'T4', observation: later },
        { kind: 'KEEP', id: 'E5', transitionId: 'T5', evidenceInstanceId: laterId }
      ]
    }
    const result = runIdentityTrace(trace)
    assertNoOracleFailures([
      ...validateObservationBindings(trace, result),
      ...validateIdentitySafetyInvariants(trace, result)
    ])
    expect(result.decisions.map((item) => item.kind)).toEqual([
      'ADD',
      'KEEP',
      'REMOVE',
      'REHYDRATE',
      'KEEP'
    ])
    expect(result.traceHash).toBe(runIdentityTrace(trace).traceHash)
  })
})
