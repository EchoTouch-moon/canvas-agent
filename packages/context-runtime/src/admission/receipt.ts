import { sha256Hex } from '../util/hash'
import type { ContextRepresentation } from '../representation/context-representation'
import type { ContextSourceId, ContextVersionId } from '../universe/revision'
import type { ProposedWorkingSet } from '../planning/proposed-working-set'
import { representationFingerprint } from '../planning/proposed-working-set'

export const ADMISSION_REJECTION_REASONS = [
  'BUDGET',
  'POLICY',
  'STALE',
  'CONFLICT',
  'ADAPTER_LIMIT'
] as const
export type AdmissionRejectionReason = (typeof ADMISSION_REJECTION_REASONS)[number]

export type AdmissionOutcome =
  | {
      readonly status: 'ADMITTED'
      readonly sourceId: ContextSourceId
      readonly sourceVersionId: ContextVersionId
      readonly representation: ContextRepresentation
      readonly renderedHash: string
    }
  | {
      readonly status: 'REJECTED'
      readonly sourceId: ContextSourceId
      readonly sourceVersionId: ContextVersionId
      readonly reason: AdmissionRejectionReason
    }
  | {
      readonly status: 'DEFERRED'
      readonly sourceId: ContextSourceId
      readonly sourceVersionId: ContextVersionId
      readonly reason: string
    }

export interface AdmissionReceipt {
  readonly id: string
  readonly proposedWorkingSetId: string
  readonly universeRevisionId: string
  readonly outcomes: readonly AdmissionOutcome[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
  readonly logicalHash: string
}

function canonicalOutcome(outcome: AdmissionOutcome): string {
  if (outcome.status === 'ADMITTED') {
    return [
      outcome.status,
      outcome.sourceId,
      outcome.sourceVersionId,
      representationFingerprint(outcome.representation),
      outcome.renderedHash
    ].join('|')
  }
  return [outcome.status, outcome.sourceId, outcome.sourceVersionId, outcome.reason].join('|')
}

export function computeAdmissionReceiptLogicalHash(input: {
  readonly proposedWorkingSetId: string
  readonly universeRevisionId: string
  readonly outcomes: readonly AdmissionOutcome[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
}): string {
  return sha256Hex(
    [
      'admission-receipt-v1',
      input.proposedWorkingSetId,
      input.universeRevisionId,
      input.renderedContextHash,
      input.adapterId,
      input.adapterVersion,
      String(input.createdAt),
      ...input.outcomes.map(canonicalOutcome)
    ].join('\u241F')
  )
}

export function createAdmissionReceipt(input: {
  readonly proposal: ProposedWorkingSet
  readonly universeRevisionId?: string
  readonly outcomes: readonly AdmissionOutcome[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
  readonly id?: string
}): AdmissionReceipt {
  if (!Number.isFinite(input.createdAt)) {
    throw new Error('AdmissionReceipt.createdAt must be a finite number')
  }
  const proposalSourceIds = new Set(input.proposal.entries.map((entry) => entry.sourceId))
  const seen = new Set<string>()
  for (const outcome of input.outcomes) {
    if (!proposalSourceIds.has(outcome.sourceId)) {
      throw new Error(`AdmissionReceipt contains unknown proposal source ${outcome.sourceId}`)
    }
    if (seen.has(outcome.sourceId)) {
      throw new Error(`AdmissionReceipt contains duplicate source ${outcome.sourceId}`)
    }
    seen.add(outcome.sourceId)
  }
  if (seen.size !== proposalSourceIds.size) {
    throw new Error('AdmissionReceipt must contain one outcome for every proposal entry')
  }

  const outcomes = Object.freeze(
    input.outcomes.map((outcome) => {
      if (outcome.status === 'ADMITTED') {
        return Object.freeze({
          status: outcome.status,
          sourceId: outcome.sourceId,
          sourceVersionId: outcome.sourceVersionId,
          representation: Object.freeze({
            ...outcome.representation,
            sourceVersionIds: Object.freeze([...outcome.representation.sourceVersionIds])
          }),
          renderedHash: outcome.renderedHash
        })
      }
      return Object.freeze({ ...outcome })
    })
  ) as readonly AdmissionOutcome[]
  const logicalHash = computeAdmissionReceiptLogicalHash({
    proposedWorkingSetId: input.proposal.id,
    universeRevisionId: input.universeRevisionId ?? input.proposal.universeRevisionId,
    outcomes,
    renderedContextHash: input.renderedContextHash,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    createdAt: input.createdAt
  })
  const id = input.id ?? `admission-receipt:${logicalHash.slice(0, 24)}`
  return Object.freeze({
    id,
    proposedWorkingSetId: input.proposal.id,
    universeRevisionId: input.universeRevisionId ?? input.proposal.universeRevisionId,
    outcomes,
    renderedContextHash: input.renderedContextHash,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    createdAt: input.createdAt,
    logicalHash
  })
}

export interface SerializedAdmissionReceipt {
  readonly schemaVersion: 1
  readonly id: string
  readonly proposedWorkingSetId: string
  readonly universeRevisionId: string
  readonly outcomes: readonly AdmissionOutcome[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
  readonly logicalHash: string
}

export function serializeAdmissionReceipt(receipt: AdmissionReceipt): string {
  const value: SerializedAdmissionReceipt = {
    schemaVersion: 1,
    id: receipt.id,
    proposedWorkingSetId: receipt.proposedWorkingSetId,
    universeRevisionId: receipt.universeRevisionId,
    outcomes: receipt.outcomes,
    renderedContextHash: receipt.renderedContextHash,
    adapterId: receipt.adapterId,
    adapterVersion: receipt.adapterVersion,
    createdAt: receipt.createdAt,
    logicalHash: receipt.logicalHash
  }
  return JSON.stringify(value)
}

export function deserializeAdmissionReceipt(
  serialized: string | SerializedAdmissionReceipt,
  proposal: ProposedWorkingSet
): AdmissionReceipt {
  const value = typeof serialized === 'string'
    ? (JSON.parse(serialized) as SerializedAdmissionReceipt)
    : serialized
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported AdmissionReceipt schema: ${String(value.schemaVersion)}`)
  }
  if (value.proposedWorkingSetId !== proposal.id || value.universeRevisionId !== proposal.universeRevisionId) {
    throw new Error('AdmissionReceipt is bound to a different proposal or UniverseRevision')
  }
  const receipt = createAdmissionReceipt({
    proposal,
    universeRevisionId: value.universeRevisionId,
    outcomes: value.outcomes,
    renderedContextHash: value.renderedContextHash,
    adapterId: value.adapterId,
    adapterVersion: value.adapterVersion,
    createdAt: value.createdAt,
    id: value.id
  })
  if (receipt.logicalHash !== value.logicalHash) {
    throw new Error('AdmissionReceipt logicalHash mismatch during deserialization')
  }
  return receipt
}
