export interface ContextRuntimeCorpusCase {
  readonly id: string
  readonly name: string
  readonly requiredEvidence: readonly string[]
  readonly providerCalls: 0
}

/** The first zero-provider golden corpus for the four-boundary state machine. */
export const CONTEXT_RUNTIME_CORPUS: readonly ContextRuntimeCorpusCase[] = [
  {
    id: 'C1',
    name: 'Initial admission',
    requiredEvidence: ['UniverseRevision', 'ProposedWorkingSet', 'AdmissionReceipt', 'CommittedWorkingSet'],
    providerCalls: 0
  },
  {
    id: 'C2',
    name: 'NO_CHANGE observation',
    requiredEvidence: ['UniverseRevision', 'providerVersion', 'contentHash'],
    providerCalls: 0
  },
  {
    id: 'C3',
    name: 'Source UPDATE',
    requiredEvidence: ['observedVersionId', 'admittedVersionId', 'SOURCE_VERSION'],
    providerCalls: 0
  },
  {
    id: 'C4',
    name: 'UNAVAILABLE preserves last-good',
    requiredEvidence: ['UNAVAILABLE', 'lastGoodVersionId', 'STALE'],
    providerCalls: 0
  },
  {
    id: 'C5',
    name: 'Recovery',
    requiredEvidence: ['RECOVER', 'PRESENT'],
    providerCalls: 0
  },
  {
    id: 'C6',
    name: 'ABSENT removal',
    requiredEvidence: ['ABSENT', 'REMOVE'],
    providerCalls: 0
  },
  {
    id: 'C7',
    name: 'Representation replacement',
    requiredEvidence: ['REPLACE', 'representation'],
    providerCalls: 0
  },
  {
    id: 'C8',
    name: 'Budget rejection',
    requiredEvidence: ['BUDGET', 'REJECTED'],
    providerCalls: 0
  }
] as const
