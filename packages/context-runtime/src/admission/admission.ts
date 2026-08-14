import { sha256Hex } from '../util/hash'
import type { ContextRepresentation } from '../representation/context-representation'
import type { ProposedWorkingSet, ProposedWorkingSetEntry } from '../planning/proposed-working-set'
import type {
  ContextSourceId,
  UniverseEntry,
  UniverseRevision,
  UniverseVersionRecord
} from '../universe/revision'
import {
  createAdmissionReceipt,
  type AdmissionRejectionReason,
  type AdmissionReceipt,
  type AdmissionOutcome
} from './receipt'

export type MaterializationResult =
  | ContextRepresentation
  | { readonly status: 'REJECTED'; readonly reason: AdmissionRejectionReason }
  | { readonly status: 'DEFERRED'; readonly reason: string }

export interface AdmissionMaterializationInput {
  readonly proposalEntry: ProposedWorkingSetEntry
  readonly universeEntry: UniverseEntry
  readonly version: UniverseVersionRecord
  readonly remainingTokens: number
}

export interface AdmissionAdapter {
  readonly adapterId: string
  readonly adapterVersion: string
  readonly materialize?: (
    input: AdmissionMaterializationInput
  ) => MaterializationResult
  readonly render: (representations: readonly ContextRepresentation[]) => string
}

export interface AdmitWorkingSetInput {
  readonly universe: UniverseRevision
  readonly proposal: ProposedWorkingSet
  readonly budget: { readonly maxSemanticTokens: number }
  readonly adapter: AdmissionAdapter
  readonly createdAt: number
}

function renderedRepresentationHash(representation: ContextRepresentation): string {
  return sha256Hex(
    [
      'rendered-representation-v1',
      representation.kind,
      representation.sourceVersionIds.join(','),
      representation.contentHash,
      String(representation.tokenEstimate),
      representation.content ?? representation.contentRef ?? ''
    ].join('|')
  )
}

function admissionEvidence(entry: UniverseEntry): {
  readonly versionId: string | null
  readonly freshness: 'FRESH' | 'LAST_GOOD' | null
  readonly admissionBasis: 'OBSERVED_CURRENT' | 'LAST_GOOD_FALLBACK' | null
} {
  if (entry.observationState === 'PRESENT') {
    return {
      versionId: entry.observedVersionId,
      freshness: 'FRESH',
      admissionBasis: 'OBSERVED_CURRENT'
    }
  }
  if (entry.observationState === 'UNAVAILABLE') {
    return {
      versionId: entry.lastGoodVersionId,
      freshness: 'LAST_GOOD',
      admissionBasis: 'LAST_GOOD_FALLBACK'
    }
  }
  return { versionId: null, freshness: null, admissionBasis: null }
}

function rejected(
  sourceId: ContextSourceId,
  sourceVersionId: string,
  reason: AdmissionRejectionReason
): AdmissionOutcome {
  return { status: 'REJECTED', sourceId, sourceVersionId, reason }
}

/**
 * Admit a proposal against one exact UniverseRevision. This is the boundary
 * where planned representations become model-visible candidates.
 */
export function admitWorkingSet(input: AdmitWorkingSetInput): AdmissionReceipt {
  if (!Number.isFinite(input.budget.maxSemanticTokens) || input.budget.maxSemanticTokens < 0) {
    throw new Error('Admission budget must be a non-negative finite number')
  }

  const outcomes: AdmissionOutcome[] = []
  const admittedRepresentations: ContextRepresentation[] = []
  let remainingTokens = input.budget.maxSemanticTokens

  for (const proposalEntry of input.proposal.entries) {
    const universeEntry = input.universe.entries.get(proposalEntry.sourceId)
    if (universeEntry === undefined) {
      outcomes.push(rejected(proposalEntry.sourceId, proposalEntry.sourceVersionId, 'STALE'))
      continue
    }
    const evidence = admissionEvidence(universeEntry)
    const versionId = evidence.versionId
    if (
      universeEntry.observationState === 'ABSENT' ||
      versionId === null ||
      versionId !== proposalEntry.sourceVersionId
    ) {
      outcomes.push(rejected(proposalEntry.sourceId, proposalEntry.sourceVersionId, 'STALE'))
      continue
    }
    if (evidence.freshness === null || evidence.admissionBasis === null) {
      throw new Error(`missing admission evidence for ${proposalEntry.sourceId}`)
    }
    const version = input.universe.versions.get(proposalEntry.sourceVersionId)
    if (version === undefined || version.sourceId !== proposalEntry.sourceId) {
      outcomes.push(rejected(proposalEntry.sourceId, proposalEntry.sourceVersionId, 'CONFLICT'))
      continue
    }

    const materialized = input.adapter.materialize === undefined
      ? proposalEntry.representation
      : input.adapter.materialize({
          proposalEntry,
          universeEntry,
          version,
          remainingTokens
        })
    if ('status' in materialized) {
      if (materialized.status === 'REJECTED') {
        outcomes.push(rejected(proposalEntry.sourceId, proposalEntry.sourceVersionId, materialized.reason))
      } else {
        outcomes.push({
          status: 'DEFERRED',
          sourceId: proposalEntry.sourceId,
          sourceVersionId: proposalEntry.sourceVersionId,
          reason: materialized.reason
        })
      }
      continue
    }
    if (!materialized.sourceVersionIds.includes(proposalEntry.sourceVersionId)) {
      outcomes.push(rejected(proposalEntry.sourceId, proposalEntry.sourceVersionId, 'CONFLICT'))
      continue
    }
    if (materialized.tokenEstimate > remainingTokens) {
      outcomes.push(rejected(proposalEntry.sourceId, proposalEntry.sourceVersionId, 'BUDGET'))
      continue
    }

    admittedRepresentations.push(materialized)
    remainingTokens -= materialized.tokenEstimate
    outcomes.push({
      status: 'ADMITTED',
      sourceId: proposalEntry.sourceId,
      sourceVersionId: proposalEntry.sourceVersionId,
      freshness: evidence.freshness,
      admissionBasis: evidence.admissionBasis,
      representation: materialized,
      renderedHash: renderedRepresentationHash(materialized)
    })
  }

  const renderedContext = input.adapter.render(admittedRepresentations)
  const renderedContextHash = sha256Hex(`rendered-context-v1|${renderedContext}`)
  return createAdmissionReceipt({
    proposal: input.proposal,
    universeRevisionId: input.universe.revisionId,
    outcomes,
    renderedContextHash,
    adapterId: input.adapter.adapterId,
    adapterVersion: input.adapter.adapterVersion,
    createdAt: input.createdAt
  })
}
