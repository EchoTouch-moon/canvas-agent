import { sha256Hex } from '../util/hash'
import {
  computeCommittedWorkingSetLogicalHash,
  type CommittedWorkingSet,
  type CommittedWorkingSetEntry
} from '../working-set/committed-working-set'

export const WORKING_SET_TRANSITION_ACTIONS = ['ADD', 'KEEP', 'REMOVE', 'REPLACE'] as const
export type WorkingSetTransitionAction = (typeof WORKING_SET_TRANSITION_ACTIONS)[number]

export interface WorkingSetTransitionRecord {
  readonly action: WorkingSetTransitionAction
  readonly sourceId: string
  readonly previousEntry: CommittedWorkingSetEntry | null
  readonly nextEntry: CommittedWorkingSetEntry | null
}

export interface WorkingSetTransition {
  readonly transitionId: string
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly fromRenderedContextHash: string | null
  readonly toRenderedContextHash: string
  readonly actions: readonly WorkingSetTransitionRecord[]
  readonly target: {
    readonly universeRevisionId: string
    readonly proposedWorkingSetId: string
    readonly admissionReceiptId: string
    readonly previousCommittedWorkingSetId: string | null
    readonly adapterId: string
    readonly adapterVersion: string
    readonly createdAt: number
    readonly logicalHash: string
  }
  readonly logicalHash: string
}

function entryFingerprint(entry: CommittedWorkingSetEntry | null): string {
  if (entry === null) return '-'
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

function sameSemanticValue(
  previous: CommittedWorkingSetEntry,
  next: CommittedWorkingSetEntry
): boolean {
  return (
    previous.sourceId === next.sourceId &&
    previous.sourceVersionId === next.sourceVersionId &&
    previous.representation.id === next.representation.id
  )
}

function freezeRecord(record: WorkingSetTransitionRecord): WorkingSetTransitionRecord {
  return Object.freeze({
    action: record.action,
    sourceId: record.sourceId,
    previousEntry: record.previousEntry,
    nextEntry: record.nextEntry
  })
}

function canonicalRecord(record: WorkingSetTransitionRecord): string {
  return [
    record.action,
    record.sourceId,
    entryFingerprint(record.previousEntry),
    entryFingerprint(record.nextEntry)
  ].join('|')
}

export function computeWorkingSetTransitionLogicalHash(input: {
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly fromRenderedContextHash: string | null
  readonly toRenderedContextHash: string
  readonly actions: readonly WorkingSetTransitionRecord[]
  readonly targetLogicalHash: string
}): string {
  return sha256Hex(
    [
      'working-set-transition-v1',
      input.fromWorkingSetId ?? '-',
      input.toWorkingSetId,
      input.fromRenderedContextHash ?? '-',
      input.toRenderedContextHash,
      input.targetLogicalHash,
      ...input.actions.map(canonicalRecord)
    ].join('\u241F')
  )
}

/** Derive ADD/KEEP/REMOVE/REPLACE from two committed states. */
export function computeWorkingSetTransition(
  previous: CommittedWorkingSet | null,
  current: CommittedWorkingSet
): WorkingSetTransition {
  if ((current.previousCommittedWorkingSetId ?? null) !== (previous?.id ?? null)) {
    throw new Error('current committed state does not point at the supplied previous state')
  }
  const previousBySource = new Map(
    previous?.entries.map((entry) => [entry.sourceId, entry] as const) ?? []
  )
  const currentBySource = new Map(current.entries.map((entry) => [entry.sourceId, entry] as const))
  const sourceIds = [...new Set([...previousBySource.keys(), ...currentBySource.keys()])].sort((a, b) =>
    a.localeCompare(b)
  )
  const actions: WorkingSetTransitionRecord[] = []
  for (const sourceId of sourceIds) {
    const previousEntry = previousBySource.get(sourceId) ?? null
    const nextEntry = currentBySource.get(sourceId) ?? null
    let action: WorkingSetTransitionAction
    if (previousEntry === null && nextEntry !== null) action = 'ADD'
    else if (previousEntry !== null && nextEntry === null) action = 'REMOVE'
    else if (previousEntry !== null && nextEntry !== null && sameSemanticValue(previousEntry, nextEntry)) action = 'KEEP'
    else action = 'REPLACE'
    actions.push(freezeRecord({ action, sourceId, previousEntry, nextEntry }))
  }

  const target = Object.freeze({
    universeRevisionId: current.universeRevisionId,
    proposedWorkingSetId: current.proposedWorkingSetId,
    admissionReceiptId: current.admissionReceiptId,
    previousCommittedWorkingSetId: current.previousCommittedWorkingSetId,
    adapterId: current.adapterId,
    adapterVersion: current.adapterVersion,
    createdAt: current.createdAt,
    logicalHash: current.logicalHash
  })
  const logicalHash = computeWorkingSetTransitionLogicalHash({
    fromWorkingSetId: previous?.id ?? null,
    toWorkingSetId: current.id,
    fromRenderedContextHash: previous?.renderedContextHash ?? null,
    toRenderedContextHash: current.renderedContextHash,
    actions,
    targetLogicalHash: target.logicalHash
  })
  return Object.freeze({
    transitionId: `working-set-transition:${logicalHash.slice(0, 24)}`,
    fromWorkingSetId: previous?.id ?? null,
    toWorkingSetId: current.id,
    fromRenderedContextHash: previous?.renderedContextHash ?? null,
    toRenderedContextHash: current.renderedContextHash,
    actions: Object.freeze(actions),
    target,
    logicalHash
  })
}

/** Replay a transition without consulting Planner or an Agent adapter. */
export function applyWorkingSetTransition(
  previous: CommittedWorkingSet | null,
  transition: WorkingSetTransition
): CommittedWorkingSet {
  if ((previous?.id ?? null) !== transition.fromWorkingSetId) {
    throw new Error('transition source does not match supplied previous committed state')
  }
  const entriesBySource = new Map(
    previous?.entries.map((entry) => [entry.sourceId, entry] as const) ?? []
  )
  for (const record of transition.actions) {
    const actualPrevious = entriesBySource.get(record.sourceId) ?? null
    if (entryFingerprint(actualPrevious) !== entryFingerprint(record.previousEntry)) {
      throw new Error(`transition precondition mismatch for ${record.sourceId}`)
    }
    if (record.action === 'ADD') {
      if (record.previousEntry !== null || record.nextEntry === null) {
        throw new Error(`invalid ADD transition for ${record.sourceId}`)
      }
      entriesBySource.set(record.sourceId, record.nextEntry)
    } else if (record.action === 'REMOVE') {
      if (record.previousEntry === null || record.nextEntry !== null) {
        throw new Error(`invalid REMOVE transition for ${record.sourceId}`)
      }
      entriesBySource.delete(record.sourceId)
    } else if (record.action === 'KEEP' || record.action === 'REPLACE') {
      if (record.previousEntry === null || record.nextEntry === null) {
        throw new Error(`invalid ${record.action} transition for ${record.sourceId}`)
      }
      entriesBySource.set(record.sourceId, record.nextEntry)
    }
  }

  const entries = [...entriesBySource.values()].sort((a, b) => a.position - b.position)
  const rebuiltLogicalHash = computeCommittedWorkingSetLogicalHash({
    universeRevisionId: transition.target.universeRevisionId,
    proposedWorkingSetId: transition.target.proposedWorkingSetId,
    admissionReceiptId: transition.target.admissionReceiptId,
    previousCommittedWorkingSetId: transition.target.previousCommittedWorkingSetId,
    entries,
    renderedContextHash: transition.toRenderedContextHash,
    adapterId: transition.target.adapterId,
    adapterVersion: transition.target.adapterVersion,
    createdAt: transition.target.createdAt
  })
  if (rebuiltLogicalHash !== transition.target.logicalHash) {
    throw new Error('transition replay produced a different committed logicalHash')
  }
  return Object.freeze({
    id: transition.toWorkingSetId,
    universeRevisionId: transition.target.universeRevisionId,
    proposedWorkingSetId: transition.target.proposedWorkingSetId,
    admissionReceiptId: transition.target.admissionReceiptId,
    previousCommittedWorkingSetId: transition.target.previousCommittedWorkingSetId,
    entries: Object.freeze(entries),
    renderedContextHash: transition.toRenderedContextHash,
    adapterId: transition.target.adapterId,
    adapterVersion: transition.target.adapterVersion,
    createdAt: transition.target.createdAt,
    logicalHash: rebuiltLogicalHash
  })
}

export interface SerializedWorkingSetTransition {
  readonly schemaVersion: 1
  readonly transitionId: string
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly fromRenderedContextHash: string | null
  readonly toRenderedContextHash: string
  readonly actions: readonly WorkingSetTransitionRecord[]
  readonly target: WorkingSetTransition['target']
  readonly logicalHash: string
}

export function serializeWorkingSetTransition(transition: WorkingSetTransition): string {
  const value: SerializedWorkingSetTransition = {
    schemaVersion: 1,
    transitionId: transition.transitionId,
    fromWorkingSetId: transition.fromWorkingSetId,
    toWorkingSetId: transition.toWorkingSetId,
    fromRenderedContextHash: transition.fromRenderedContextHash,
    toRenderedContextHash: transition.toRenderedContextHash,
    actions: transition.actions,
    target: transition.target,
    logicalHash: transition.logicalHash
  }
  return JSON.stringify(value)
}

export function deserializeWorkingSetTransition(
  serialized: string | SerializedWorkingSetTransition
): WorkingSetTransition {
  const value = typeof serialized === 'string'
    ? (JSON.parse(serialized) as SerializedWorkingSetTransition)
    : serialized
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported WorkingSetTransition schema: ${String(value.schemaVersion)}`)
  }
  const actions = Object.freeze(value.actions.map((action) => freezeRecord(action)))
  const logicalHash = computeWorkingSetTransitionLogicalHash({
    fromWorkingSetId: value.fromWorkingSetId,
    toWorkingSetId: value.toWorkingSetId,
    fromRenderedContextHash: value.fromRenderedContextHash,
    toRenderedContextHash: value.toRenderedContextHash,
    actions,
    targetLogicalHash: value.target.logicalHash
  })
  if (logicalHash !== value.logicalHash) {
    throw new Error('WorkingSetTransition logicalHash mismatch during deserialization')
  }
  const expectedTransitionId = `working-set-transition:${logicalHash.slice(0, 24)}`
  if (value.transitionId !== expectedTransitionId) {
    throw new Error(`WorkingSetTransition.transitionId must equal ${expectedTransitionId}`)
  }
  return Object.freeze({
    transitionId: value.transitionId,
    fromWorkingSetId: value.fromWorkingSetId,
    toWorkingSetId: value.toWorkingSetId,
    fromRenderedContextHash: value.fromRenderedContextHash,
    toRenderedContextHash: value.toRenderedContextHash,
    actions,
    target: Object.freeze({ ...value.target }),
    logicalHash
  })
}
