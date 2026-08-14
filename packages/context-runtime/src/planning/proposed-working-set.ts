import { sha256Hex } from '../util/hash'
import type { ContextRepresentation, RepresentationKind, RepresentationLossiness } from '../representation/context-representation'
import type { ContextSourceId, ContextVersionId, UniverseRevision } from '../universe/revision'

export const CONTEXT_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export type ContextPriority = (typeof CONTEXT_PRIORITIES)[number]

// Reasons remain string-compatible so adapters can add provider-neutral facts
// such as TOOL_READ without changing the runtime contract each time.
export type PlanningReason = string

export interface ProposedWorkingSetEntry {
  readonly sourceId: ContextSourceId
  readonly sourceVersionId: ContextVersionId
  readonly representation: ContextRepresentation
  readonly priority: ContextPriority
  readonly reason: readonly PlanningReason[]
  readonly estimatedTokens?: number
}

export interface ProposedWorkingSet {
  readonly id: string
  readonly universeRevisionId: string
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly ProposedWorkingSetEntry[]
  readonly planner: {
    readonly kind: 'DETERMINISTIC'
    readonly version: string
  }
  readonly createdAt: number
  readonly logicalHash: string
}

function freezeRepresentation(representation: ContextRepresentation): ContextRepresentation {
  return Object.freeze({
    id: representation.id,
    kind: representation.kind,
    sourceVersionIds: Object.freeze([...representation.sourceVersionIds]),
    contentHash: representation.contentHash,
    tokenEstimate: representation.tokenEstimate,
    lossiness: representation.lossiness,
    derivation: representation.derivation,
    ...(representation.content !== undefined ? { content: representation.content } : {}),
    ...(representation.contentRef !== undefined ? { contentRef: representation.contentRef } : {})
  })
}

function freezeEntry(entry: ProposedWorkingSetEntry): ProposedWorkingSetEntry {
  return Object.freeze({
    sourceId: entry.sourceId,
    sourceVersionId: entry.sourceVersionId,
    representation: freezeRepresentation(entry.representation),
    priority: entry.priority,
    reason: Object.freeze([...entry.reason]),
    ...(entry.estimatedTokens !== undefined ? { estimatedTokens: entry.estimatedTokens } : {})
  })
}

export function representationFingerprint(representation: ContextRepresentation): string {
  return [
    representation.id,
    representation.kind,
    representation.sourceVersionIds.join(','),
    representation.contentHash,
    String(representation.tokenEstimate),
    representation.lossiness
  ].join('|')
}

function canonicalEntry(entry: ProposedWorkingSetEntry): string {
  return [
    entry.sourceId,
    entry.sourceVersionId,
    representationFingerprint(entry.representation),
    entry.priority,
    entry.reason.join(','),
    String(entry.estimatedTokens ?? entry.representation.tokenEstimate)
  ].join('|')
}

export function computeProposedWorkingSetLogicalHash(input: {
  readonly universeRevisionId: string
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly ProposedWorkingSetEntry[]
  readonly plannerVersion: string
  readonly createdAt: number
}): string {
  return sha256Hex(
    [
      'proposed-working-set-v1',
      input.universeRevisionId,
      input.previousCommittedWorkingSetId ?? '-',
      input.plannerVersion,
      String(input.createdAt),
      ...input.entries.map(canonicalEntry)
    ].join('\u241F')
  )
}

export function createProposedWorkingSet(input: {
  readonly universeRevision: UniverseRevision
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly ProposedWorkingSetEntry[]
  readonly plannerVersion: string
  readonly createdAt: number
  readonly id?: string
}): ProposedWorkingSet {
  if (!Number.isFinite(input.createdAt)) {
    throw new Error('ProposedWorkingSet.createdAt must be a finite number')
  }
  const sourceIds = new Set<string>()
  const entries = input.entries.map((entry) => {
    if (sourceIds.has(entry.sourceId)) {
      throw new Error(`ProposedWorkingSet contains duplicate source ${entry.sourceId}`)
    }
    sourceIds.add(entry.sourceId)
    if (!entry.representation.sourceVersionIds.includes(entry.sourceVersionId)) {
      throw new Error(
        `representation ${entry.representation.id} does not contain proposed version ${entry.sourceVersionId}`
      )
    }
    if (entry.estimatedTokens !== undefined && entry.estimatedTokens < 0) {
      throw new Error(`estimatedTokens must be non-negative for ${entry.sourceId}`)
    }
    return freezeEntry(entry)
  })
  const logicalHash = computeProposedWorkingSetLogicalHash({
    universeRevisionId: input.universeRevision.revisionId,
    previousCommittedWorkingSetId: input.previousCommittedWorkingSetId,
    entries,
    plannerVersion: input.plannerVersion,
    createdAt: input.createdAt
  })
  const id = input.id ?? `proposed-working-set:${logicalHash.slice(0, 24)}`
  return Object.freeze({
    id,
    universeRevisionId: input.universeRevision.revisionId,
    previousCommittedWorkingSetId: input.previousCommittedWorkingSetId,
    entries: Object.freeze(entries),
    planner: Object.freeze({ kind: 'DETERMINISTIC' as const, version: input.plannerVersion }),
    createdAt: input.createdAt,
    logicalHash
  })
}

export interface SerializedProposedWorkingSet {
  readonly schemaVersion: 1
  readonly id: string
  readonly universeRevisionId: string
  readonly previousCommittedWorkingSetId: string | null
  readonly entries: readonly ProposedWorkingSetEntry[]
  readonly planner: { readonly kind: 'DETERMINISTIC'; readonly version: string }
  readonly createdAt: number
  readonly logicalHash: string
}

function deserializeRepresentation(
  representation: ContextRepresentation
): ContextRepresentation {
  const copy: ContextRepresentation = {
    id: representation.id,
    kind: representation.kind as RepresentationKind,
    sourceVersionIds: [...representation.sourceVersionIds],
    contentHash: representation.contentHash,
    tokenEstimate: representation.tokenEstimate,
    lossiness: representation.lossiness as RepresentationLossiness,
    derivation: representation.derivation,
    ...(representation.content !== undefined ? { content: representation.content } : {}),
    ...(representation.contentRef !== undefined ? { contentRef: representation.contentRef } : {})
  }
  return copy
}

export function serializeProposedWorkingSet(proposal: ProposedWorkingSet): string {
  const value: SerializedProposedWorkingSet = {
    schemaVersion: 1,
    id: proposal.id,
    universeRevisionId: proposal.universeRevisionId,
    previousCommittedWorkingSetId: proposal.previousCommittedWorkingSetId,
    entries: proposal.entries,
    planner: proposal.planner,
    createdAt: proposal.createdAt,
    logicalHash: proposal.logicalHash
  }
  return JSON.stringify(value)
}

export function deserializeProposedWorkingSet(
  serialized: string | SerializedProposedWorkingSet,
  universeRevision: UniverseRevision
): ProposedWorkingSet {
  const value = typeof serialized === 'string'
    ? (JSON.parse(serialized) as SerializedProposedWorkingSet)
    : serialized
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported ProposedWorkingSet schema: ${String(value.schemaVersion)}`)
  }
  if (value.universeRevisionId !== universeRevision.revisionId) {
    throw new Error('ProposedWorkingSet is bound to a different UniverseRevision')
  }
  const proposal = createProposedWorkingSet({
    universeRevision,
    previousCommittedWorkingSetId: value.previousCommittedWorkingSetId,
    entries: value.entries.map((entry) => ({
      sourceId: entry.sourceId,
      sourceVersionId: entry.sourceVersionId,
      representation: deserializeRepresentation(entry.representation),
      priority: entry.priority,
      reason: [...entry.reason],
      ...(entry.estimatedTokens !== undefined ? { estimatedTokens: entry.estimatedTokens } : {})
    })),
    plannerVersion: value.planner.version,
    createdAt: value.createdAt,
    id: value.id
  })
  if (proposal.logicalHash !== value.logicalHash) {
    throw new Error('ProposedWorkingSet logicalHash mismatch during deserialization')
  }
  return proposal
}
