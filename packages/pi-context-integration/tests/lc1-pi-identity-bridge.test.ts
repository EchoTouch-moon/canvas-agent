import { describe, expect, it } from 'vitest'
import {
  CandidateIdentityMapper,
  instanceIdFor,
  runIdentityTrace
} from '../../context-runtime/tests/fixtures/source-identity/candidate'
import type {
  CandidateEvidenceInput,
  ConservativeObservation,
  IdentityDecision,
  IdentityTrace
} from '../../context-runtime/tests/fixtures/source-identity/types'
import {
  assertNoOracleFailures,
  validateIdentitySafetyInvariants,
  validateObservationBindings
} from '../../context-runtime/tests/fixtures/source-identity/oracle'
import { type PiMessageView } from '../src'
import {
  mapPiReadResultsToCandidateEvidence,
  type PiReadAuthority
} from './fixtures/lc1-pi-identity-bridge'

const PATH = 'src/reopen-a.ts'
const CONTENT = 'export const value = "reopen-a:v3"'

const AVAILABLE_V3: PiReadAuthority = {
  repositoryId: 'repo-a',
  namespace: 'repository-file',
  path: PATH,
  universeRevision: 'universe:r3',
  representationKind: 'FULL',
  status: 'AVAILABLE',
  contentHash: 'hash-reopen-a-v3'
}

function toolMessages(
  callId: string,
  toolName: string,
  path = PATH,
  content = CONTENT
): PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name: toolName, arguments: { path } }]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: content }],
      toolCallId: callId,
      toolName,
      isError: false
    }
  ]
}

function readMessages(callId: string, path = PATH, content = CONTENT): PiMessageView[] {
  return toolMessages(callId, 'read', path, content)
}

function context(
  runtimeSessionId: string,
  modelCallSequence: number,
  repositoryId = 'repo-a',
  namespace = 'repository-file'
) {
  return { runtimeSessionId, modelCallSequence, repositoryId, namespace }
}

function decision(value: IdentityDecision | ConservativeObservation): IdentityDecision {
  if ('outcome' in value) throw new Error(`expected decision, got ${value.outcome}`)
  return value
}

describe('LC1 Pi-to-authority bridge candidate', () => {
  it('provides enough authoritative metadata for ADD -> REMOVE -> REHYDRATE', () => {
    const first = mapPiReadResultsToCandidateEvidence(
      readMessages('call-1'),
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    const later = mapPiReadResultsToCandidateEvidence(
      readMessages('call-2', './src\\reopen-a.ts'),
      context('session-a', 2),
      [AVAILABLE_V3]
    )
    expect(first.unmapped).toEqual([])
    expect(later.unmapped).toEqual([])
    expect(first.mapped[0]?.eventSourceKey).toBe('run/tool-result://call-1')
    expect(later.mapped[0]?.eventSourceKey).toBe('run/tool-result://call-2')
    expect(first.mapped[0]?.evidence).toMatchObject({
      repositoryId: 'repo-a',
      namespace: 'repository-file',
      path: PATH,
      contentHash: 'hash-reopen-a-v3',
      callId: 'pi-evidence:v1:session-a:call-1'
    })

    const mapper = new CandidateIdentityMapper()
    const initial = decision(mapper.observe('E1', 'T1', first.mapped[0]!.evidence))
    expect(initial.kind).toBe('ADD')
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

  it('replays Pi-backed evidence through the generic LC1 safety oracles deterministically', () => {
    const first = availableEvidence(
      mapPiReadResultsToCandidateEvidence(
        readMessages('replay-call-1'),
        context('replay-session', 1),
        [AVAILABLE_V3]
      ).mapped[0]!.evidence
    )
    const later = availableEvidence(
      mapPiReadResultsToCandidateEvidence(
        readMessages('replay-call-2', './src\\reopen-a.ts'),
        context('replay-session', 2),
        [AVAILABLE_V3]
      ).mapped[0]!.evidence
    )
    const firstInstanceId = instanceIdFor(first)
    const laterInstanceId = instanceIdFor(later)
    const trace: IdentityTrace = {
      id: 'PI-BRIDGE-REPLAY',
      events: [
        { kind: 'OBSERVE', id: 'E1', transitionId: 'T1', observation: first },
        { kind: 'KEEP', id: 'E2', transitionId: 'T2', evidenceInstanceId: firstInstanceId },
        {
          kind: 'REMOVE',
          id: 'E3',
          transitionId: 'T3',
          evidenceInstanceId: firstInstanceId,
          reasonCodes: ['RULED_OUT']
        },
        { kind: 'OBSERVE', id: 'E4', transitionId: 'T4', observation: later },
        { kind: 'KEEP', id: 'E5', transitionId: 'T5', evidenceInstanceId: laterInstanceId }
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
    expect(result.decisions[3]?.originatingRemoveTransitionId).toBe('T3')
    expect(result.traceHash).toBe(runIdentityTrace(trace).traceHash)
  })

  it('does not turn a changed authoritative version into REHYDRATE', () => {
    const first = mapPiReadResultsToCandidateEvidence(
      readMessages('call-1'),
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    const changed = mapPiReadResultsToCandidateEvidence(
      readMessages('call-2', PATH, 'export const value = "reopen-a:v4"'),
      context('session-a', 2),
      [
        {
          ...AVAILABLE_V3,
          universeRevision: 'universe:r4',
          contentHash: 'hash-reopen-a-v4'
        }
      ]
    )
    const mapper = new CandidateIdentityMapper()
    const initial = decision(mapper.observe('E1', 'T1', first.mapped[0]!.evidence))
    mapper.commit(initial)
    mapper.remove('T2', initial.evidenceInstanceId!, ['SUPERSEDED'])
    const next = decision(mapper.observe('E3', 'T3', changed.mapped[0]!.evidence))

    expect(next.kind).toBe('ADD')
    expect(next.subjectKey).toBe(initial.subjectKey)
    expect(next.sourceVersionId).not.toBe(initial.sourceVersionId)
    expect(next.originatingRemoveTransitionId).toBeNull()
    mapper.commit(next)
  })

  it('fails closed when authority is missing, ambiguous, unavailable, or unsafe', () => {
    const missing = mapPiReadResultsToCandidateEvidence(
      readMessages('missing-call'),
      context('session-a', 1),
      []
    )
    expect(missing.mapped).toEqual([])
    expect(missing.unmapped[0]?.reason).toBe('NO_AUTHORITATIVE_SOURCE')

    const ambiguous = mapPiReadResultsToCandidateEvidence(
      readMessages('ambiguous-call'),
      context('session-a', 1),
      [AVAILABLE_V3, { ...AVAILABLE_V3, contentHash: 'hash-duplicate-v3' }]
    )
    expect(ambiguous.mapped).toEqual([])
    expect(ambiguous.unmapped[0]?.reason).toBe('AMBIGUOUS_AUTHORITY')

    const unavailable = mapPiReadResultsToCandidateEvidence(
      readMessages('unavailable-call'),
      context('session-a', 1),
      [
        {
          repositoryId: 'repo-a',
          namespace: 'repository-file',
          path: PATH,
          universeRevision: 'universe:r3',
          representationKind: 'FULL',
          status: 'UNAVAILABLE',
          unavailableReason: 'REVISION_MISMATCH'
        }
      ]
    )
    expect(unavailable.unmapped).toEqual([])
    const unavailableEvidence = unavailable.mapped[0]?.evidence
    expect(unavailableEvidence?.status).toBe('UNAVAILABLE')
    if (unavailableEvidence === undefined) throw new Error('expected unavailable evidence')
    const mapper = new CandidateIdentityMapper()
    const unavailableObservation = mapper.observe('E4', 'T4', unavailableEvidence)
    expect(observation(unavailableObservation)).toMatchObject({
      status: 'UNAVAILABLE',
      outcome: 'CONSERVATIVE_KEEP',
      sourceVersionId: null
    })

    const absent = mapPiReadResultsToCandidateEvidence(
      readMessages('absent-call'),
      context('session-a', 1),
      [
        {
          repositoryId: 'repo-a',
          namespace: 'repository-file',
          path: PATH,
          universeRevision: 'universe:r3',
          representationKind: 'FULL',
          status: 'ABSENT'
        }
      ]
    )
    expect(absent.unmapped).toEqual([])
    const absentObservation = mapper.observe('E5', 'T5', absent.mapped[0]!.evidence)
    expect(observation(absentObservation)).toMatchObject({
      status: 'ABSENT',
      outcome: 'CONFIRMED_ABSENT',
      sourceVersionId: null
    })

    const unsupported = mapPiReadResultsToCandidateEvidence(
      toolMessages('write-call', 'write'),
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    expect(unsupported.mapped).toEqual([])
    expect(unsupported.unmapped[0]?.reason).toBe('UNSUPPORTED_TOOL')

    const unsafe = mapPiReadResultsToCandidateEvidence(
      readMessages('unsafe-call', '../secret.ts'),
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    expect(unsafe.mapped).toEqual([])
    expect(unsafe.unmapped[0]?.reason).toBe('MISSING_PATH_HINT')

    const noCallId = mapPiReadResultsToCandidateEvidence(
      [{ role: 'toolResult', content: [{ type: 'text', text: CONTENT }], toolName: 'read' }],
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    expect(noCallId.mapped).toEqual([])
    expect(noCallId.unmapped[0]?.reason).toBe('MISSING_CALL_ID')

    const wrongScope = mapPiReadResultsToCandidateEvidence(
      readMessages('wrong-scope-call'),
      context('session-a', 1, 'repo-b'),
      [AVAILABLE_V3]
    )
    expect(wrongScope.mapped).toEqual([])
    expect(wrongScope.unmapped[0]?.reason).toBe('NO_AUTHORITATIVE_SOURCE')
  })

  it('namespaces evidence instances by runtime session and rejects call-id remapping', () => {
    const first = mapPiReadResultsToCandidateEvidence(
      readMessages('same-call'),
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    const second = mapPiReadResultsToCandidateEvidence(
      readMessages('same-call'),
      context('session-b', 1),
      [AVAILABLE_V3]
    )
    expect(first.mapped[0]?.evidence.callId).not.toBe(second.mapped[0]?.evidence.callId)

    const remapped = mapPiReadResultsToCandidateEvidence(
      [...readMessages('remapped-call', PATH), ...readMessages('remapped-call', 'src/other.ts')],
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    expect(remapped.mapped).toEqual([])
    expect(remapped.unmapped.map((item) => item.reason)).toEqual(['CALL_ID_REMAP', 'CALL_ID_REMAP'])
  })

  it('does not link the same path across repository identities', () => {
    const first = mapPiReadResultsToCandidateEvidence(
      readMessages('repo-a-call'),
      context('session-a', 1),
      [AVAILABLE_V3]
    )
    const second = mapPiReadResultsToCandidateEvidence(
      readMessages('repo-b-call'),
      context('session-a', 2, 'repo-b'),
      [{ ...AVAILABLE_V3, repositoryId: 'repo-b' }]
    )
    const mapper = new CandidateIdentityMapper()
    const firstDecision = decision(mapper.observe('E1', 'T1', first.mapped[0]!.evidence))
    mapper.commit(firstDecision)
    const secondDecision = decision(mapper.observe('E2', 'T2', second.mapped[0]!.evidence))

    expect(secondDecision.kind).toBe('ADD')
    expect(secondDecision.subjectKey).not.toBe(firstDecision.subjectKey)
    expect(secondDecision.originatingRemoveTransitionId).toBeNull()
  })
})

function observation(value: IdentityDecision | ConservativeObservation): ConservativeObservation {
  if (!('outcome' in value)) throw new Error(`expected observation, got ${value.kind}`)
  return value
}

function availableEvidence(value: CandidateEvidenceInput) {
  if (value.status !== 'AVAILABLE')
    throw new Error(`expected available evidence, got ${value.status}`)
  return value
}
