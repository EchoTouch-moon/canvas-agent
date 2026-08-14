import type { ContextRepresentation } from '../representation/context-representation'
import type {
  ContextSourceId,
  UniverseEntry,
  UniverseRevision,
  UniverseVersionRecord
} from '../universe/revision'
import type { CommittedWorkingSet } from '../working-set/committed-working-set'
import {
  createProposedWorkingSet,
  type ContextPriority,
  type PlanningReason,
  type ProposedWorkingSet
} from './proposed-working-set'

export interface PlannerBudget {
  readonly maxSemanticTokens: number
}

export interface PlannerTaskHints {
  readonly mandatorySourceIds?: readonly ContextSourceId[]
  readonly pinnedSourceIds?: readonly ContextSourceId[]
  readonly currentTargetSourceIds?: readonly ContextSourceId[]
  readonly referencedSourceIds?: readonly ContextSourceId[]
  readonly dependencySourceIds?: readonly ContextSourceId[]
}

export interface DeterministicPlannerPolicy {
  readonly version: string
  readonly budget: PlannerBudget
  readonly represent: (
    entry: UniverseEntry,
    version: UniverseVersionRecord
  ) => ContextRepresentation | null
}

export interface PlanProposedWorkingSetInput {
  readonly universe: UniverseRevision
  readonly previousCommittedWorkingSet: CommittedWorkingSet | null
  readonly policy: DeterministicPlannerPolicy
  readonly taskHints?: PlannerTaskHints
  readonly createdAt: number
}

interface Candidate {
  readonly entry: UniverseEntry
  readonly version: UniverseVersionRecord
  readonly representation: ContextRepresentation
  readonly priority: ContextPriority
  readonly reasons: readonly PlanningReason[]
  readonly order: number
}

const PRIORITY_ORDER: Record<ContextPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

function sourceSet(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(values ?? [])
}

function classify(
  sourceId: string,
  previous: ReadonlySet<string>,
  hints: PlannerTaskHints
): { priority: ContextPriority; reasons: readonly PlanningReason[] } {
  const mandatory = sourceSet(hints.mandatorySourceIds)
  const pinned = sourceSet(hints.pinnedSourceIds)
  const currentTarget = sourceSet(hints.currentTargetSourceIds)
  const referenced = sourceSet(hints.referencedSourceIds)
  const dependency = sourceSet(hints.dependencySourceIds)

  if (mandatory.has(sourceId)) {
    return { priority: 'P0', reasons: ['MANDATORY_INSTRUCTION'] }
  }
  if (pinned.has(sourceId)) {
    return { priority: 'P0', reasons: ['USER_PINNED'] }
  }
  const directReasons: PlanningReason[] = []
  if (currentTarget.has(sourceId)) directReasons.push('CURRENT_TASK_TARGET')
  if (referenced.has(sourceId)) directReasons.push('CURRENT_TASK_REFERENCE')
  if (directReasons.length > 0) {
    return { priority: 'P1', reasons: directReasons }
  }
  if (dependency.has(sourceId)) {
    return { priority: 'P2', reasons: ['DEPENDENCY'] }
  }
  if (previous.has(sourceId)) {
    return { priority: 'P2', reasons: ['PREVIOUSLY_ACTIVE'] }
  }
  return { priority: 'P3', reasons: ['BACKGROUND_CANDIDATE'] }
}

/**
 * Deterministic Planner v0. It selects and explains candidates only; it does
 * not claim that the model has received any of them. Admission owns the final
 * budget and version decision.
 */
export function planProposedWorkingSet(
  input: PlanProposedWorkingSetInput
): ProposedWorkingSet {
  if (!Number.isFinite(input.policy.budget.maxSemanticTokens) || input.policy.budget.maxSemanticTokens < 0) {
    throw new Error('Planner budget must be a non-negative finite number')
  }

  const hints = input.taskHints ?? {}
  const previousSourceIds = new Set(
    input.previousCommittedWorkingSet?.entries.map((entry) => entry.sourceId) ?? []
  )
  const candidates: Candidate[] = []

  for (const entry of input.universe.entries.values()) {
    if (entry.observationState === 'ABSENT') continue
    const versionId = entry.admittedVersionId
    if (versionId === null) continue
    const version = input.universe.versions.get(versionId)
    if (version === undefined) {
      throw new Error(`Universe entry ${entry.sourceId} references missing version ${versionId}`)
    }
    const representation = input.policy.represent(entry, version)
    if (representation === null) continue
    const classification = classify(entry.sourceId, previousSourceIds, hints)
    candidates.push({
      entry,
      version,
      representation,
      priority: classification.priority,
      reasons: entry.observationState === 'UNAVAILABLE'
        ? [...classification.reasons, 'SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP']
        : classification.reasons,
      order: candidates.length
    })
  }

  candidates.sort((a, b) => {
    const priorityDelta = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (priorityDelta !== 0) return priorityDelta
    return a.entry.sourceId.localeCompare(b.entry.sourceId)
  })

  let estimatedTotal = 0
  const selected = [] as Candidate[]
  for (const candidate of candidates) {
    const estimate = candidate.representation.tokenEstimate
    const mandatory = candidate.priority === 'P0'
    if (mandatory || estimatedTotal + estimate <= input.policy.budget.maxSemanticTokens) {
      selected.push(candidate)
      estimatedTotal += estimate
    }
  }

  const entries = selected.map((candidate) => ({
    sourceId: candidate.entry.sourceId,
    sourceVersionId: candidate.version.versionId,
    representation: candidate.representation,
    priority: candidate.priority,
    reason: candidate.reasons,
    estimatedTokens: candidate.representation.tokenEstimate
  }))

  return createProposedWorkingSet({
    universeRevision: input.universe,
    previousCommittedWorkingSetId: input.previousCommittedWorkingSet?.id ?? null,
    entries,
    plannerVersion: input.policy.version,
    createdAt: input.createdAt
  })
}
