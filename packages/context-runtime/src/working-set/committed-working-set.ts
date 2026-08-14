import { sha256Hex } from '../util/hash'
import type { ContextRepresentation } from '../representation/context-representation'
import type {
  ContextPriority,
  PlanningReason,
  ProposedWorkingSet,
  ProposedWorkingSetEntry
} from '../planning/proposed-working-set'
import type {
  AdmissionOutcome,
  AdmissionReceipt
} from '../admission/receipt'
import type { ContextSourceId, UniverseRevision } from '../universe/revision'

export interface CommittedWorkingSetEntry {
  readonly position: number
  readonly sourceId: ContextSourceId
  readonly sourceVersionId: string
  readonly representation: ContextRepresentation
  readonly priority: ContextPriority
  readonly reason: readonly PlanningReason[]
  readonly renderedHash: string
}

export interface CommittedWorkingSet {
  readonly id: string
  readonly universeRevisionId: string
  readonly proposedWorkingSetId: string
  readonly admissionReceiptId: string
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly CommittedWorkingSetEntry[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
  readonly logicalHash: string
}

function freezeRepresentation(representation: ContextRepresentation): ContextRepresentation {
  return Object.freeze({
    ...representation,
    sourceVersionIds: Object.freeze([...representation.sourceVersionIds])
  })
}

function freezeEntry(entry: CommittedWorkingSetEntry): CommittedWorkingSetEntry {
  return Object.freeze({
    position: entry.position,
    sourceId: entry.sourceId,
    sourceVersionId: entry.sourceVersionId,
    representation: freezeRepresentation(entry.representation),
    priority: entry.priority,
    reason: Object.freeze([...entry.reason]),
    renderedHash: entry.renderedHash
  })
}

function canonicalEntry(entry: CommittedWorkingSetEntry): string {
  return [
    String(entry.position),
    entry.sourceId,
    entry.sourceVersionId,
    entry.representation.id,
    entry.representation.kind,
    entry.representation.contentHash,
    String(entry.representation.tokenEstimate),
    entry.priority,
    entry.reason.join(','),
    entry.renderedHash
  ].join('|')
}

export function computeCommittedWorkingSetLogicalHash(input: {
  readonly universeRevisionId: string
  readonly proposedWorkingSetId: string
  readonly admissionReceiptId: string
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly CommittedWorkingSetEntry[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
}): string {
  return sha256Hex(
    [
      'committed-working-set-v1',
      input.universeRevisionId,
      input.proposedWorkingSetId,
      input.admissionReceiptId,
      input.previousCommittedWorkingSetId ?? '-',
      input.renderedContextHash,
      input.adapterId,
      input.adapterVersion,
      String(input.createdAt),
      ...input.entries.map(canonicalEntry)
    ].join('\u241F')
  )
}

function proposalEntryBySource(
  proposal: ProposedWorkingSet
): ReadonlyMap<ContextSourceId, ProposedWorkingSetEntry> {
  return new Map(proposal.entries.map((entry) => [entry.sourceId, entry] as const))
}

function outcomeBySource(receipt: AdmissionReceipt): ReadonlyMap<ContextSourceId, AdmissionOutcome> {
  return new Map(receipt.outcomes.map((outcome) => [outcome.sourceId, outcome] as const))
}

/**
 * Materialize the committed state from an exact proposal + receipt pair.
 * Rejected and deferred outcomes are intentionally absent from `entries`.
 */
export function commitAdmission(input: {
  readonly universe: UniverseRevision
  readonly proposal: ProposedWorkingSet
  readonly receipt: AdmissionReceipt
  readonly previousCommittedWorkingSet: CommittedWorkingSet | null
  readonly id?: string
}): CommittedWorkingSet {
  if (
    input.receipt.proposedWorkingSetId !== input.proposal.id ||
    input.receipt.universeRevisionId !== input.universe.revisionId
  ) {
    throw new Error('receipt is bound to a different proposal or UniverseRevision')
  }
  const previousId = input.previousCommittedWorkingSet?.id ?? null
  if (input.proposal.previousCommittedWorkingSetId !== previousId) {
    throw new Error('proposal previousCommittedWorkingSetId does not match previous committed state')
  }

  const proposalBySource = proposalEntryBySource(input.proposal)
  const outcomes = outcomeBySource(input.receipt)
  const entries: CommittedWorkingSetEntry[] = []
  for (const proposalEntry of input.proposal.entries) {
    const outcome = outcomes.get(proposalEntry.sourceId)
    if (outcome === undefined) {
      throw new Error(`missing admission outcome for ${proposalEntry.sourceId}`)
    }
    if (outcome.status !== 'ADMITTED') continue
    const canonicalProposalEntry = proposalBySource.get(outcome.sourceId)
    if (
      canonicalProposalEntry === undefined ||
      canonicalProposalEntry.sourceVersionId !== outcome.sourceVersionId ||
      !outcome.representation.sourceVersionIds.includes(outcome.sourceVersionId)
    ) {
      throw new Error(`admitted outcome conflicts with proposal for ${outcome.sourceId}`)
    }
    const version = input.universe.versions.get(outcome.sourceVersionId)
    const currentEntry = input.universe.entries.get(outcome.sourceId)
    const currentVersionId = currentEntry === undefined
      ? null
      : currentEntry.observationState === 'PRESENT'
        ? currentEntry.observedVersionId
        : currentEntry.admittedVersionId
    if (
      version === undefined ||
      version.sourceId !== outcome.sourceId ||
      currentEntry?.observationState === 'ABSENT' ||
      currentVersionId !== outcome.sourceVersionId
    ) {
      throw new Error(`admitted outcome references unknown version ${outcome.sourceVersionId}`)
    }
    entries.push(
      freezeEntry({
        position: entries.length,
        sourceId: outcome.sourceId,
        sourceVersionId: outcome.sourceVersionId,
        representation: outcome.representation,
        priority: canonicalProposalEntry.priority,
        reason: canonicalProposalEntry.reason,
        renderedHash: outcome.renderedHash
      })
    )
  }

  const logicalHash = computeCommittedWorkingSetLogicalHash({
    universeRevisionId: input.receipt.universeRevisionId,
    proposedWorkingSetId: input.proposal.id,
    admissionReceiptId: input.receipt.id,
    previousCommittedWorkingSetId: previousId,
    entries,
    renderedContextHash: input.receipt.renderedContextHash,
    adapterId: input.receipt.adapterId,
    adapterVersion: input.receipt.adapterVersion,
    createdAt: input.receipt.createdAt
  })
  const id = input.id ?? `committed-working-set:${logicalHash.slice(0, 24)}`
  return Object.freeze({
    id,
    universeRevisionId: input.receipt.universeRevisionId,
    proposedWorkingSetId: input.proposal.id,
    admissionReceiptId: input.receipt.id,
    previousCommittedWorkingSetId: previousId,
    entries: Object.freeze(entries),
    renderedContextHash: input.receipt.renderedContextHash,
    adapterId: input.receipt.adapterId,
    adapterVersion: input.receipt.adapterVersion,
    createdAt: input.receipt.createdAt,
    logicalHash
  })
}

/** Explicit replay name for callers rebuilding state from persisted artifacts. */
export const rebuildCommittedWorkingSet = commitAdmission

export interface SerializedCommittedWorkingSet {
  readonly schemaVersion: 1
  readonly id: string
  readonly universeRevisionId: string
  readonly proposedWorkingSetId: string
  readonly admissionReceiptId: string
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly CommittedWorkingSetEntry[]
  readonly renderedContextHash: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly createdAt: number
  readonly logicalHash: string
}

export function serializeCommittedWorkingSet(committed: CommittedWorkingSet): string {
  const value: SerializedCommittedWorkingSet = {
    schemaVersion: 1,
    id: committed.id,
    universeRevisionId: committed.universeRevisionId,
    proposedWorkingSetId: committed.proposedWorkingSetId,
    admissionReceiptId: committed.admissionReceiptId,
    previousCommittedWorkingSetId: committed.previousCommittedWorkingSetId,
    entries: committed.entries,
    renderedContextHash: committed.renderedContextHash,
    adapterId: committed.adapterId,
    adapterVersion: committed.adapterVersion,
    createdAt: committed.createdAt,
    logicalHash: committed.logicalHash
  }
  return JSON.stringify(value)
}

export function deserializeCommittedWorkingSet(
  serialized: string | SerializedCommittedWorkingSet,
  universe: UniverseRevision,
  proposal: ProposedWorkingSet,
  receipt: AdmissionReceipt,
  previousCommittedWorkingSet: CommittedWorkingSet | null = null
): CommittedWorkingSet {
  const value = typeof serialized === 'string'
    ? (JSON.parse(serialized) as SerializedCommittedWorkingSet)
    : serialized
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported CommittedWorkingSet schema: ${String(value.schemaVersion)}`)
  }
  const committed = commitAdmission({
    universe,
    proposal,
    receipt,
    previousCommittedWorkingSet,
    id: value.id
  })
  if (
    committed.logicalHash !== value.logicalHash ||
    committed.previousCommittedWorkingSetId !== value.previousCommittedWorkingSetId ||
    committed.entries.length !== value.entries.length
  ) {
    throw new Error('CommittedWorkingSet logicalHash mismatch during deserialization')
  }
  return committed
}
