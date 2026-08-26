import type { ContextUniverseEntry, ContextUniverseRevision } from '../universe/context-universe'
import type { ContextRepresentation } from '../representation/context-representation'
import type { ContextPlanningRequest, ReasonCode } from './planning-request'
import { planningRequestHash } from './planning-request'
import type {
  ContextDecision,
  ContextProtection,
  ContextTransition,
  ContextWorkingSet,
  ContextWorkingSetItem
} from '../working-set/working-set-types'
import {
  computeTransitionLogicalHash,
  computeWorkingSetLogicalHash,
  createDecisionId,
  createWorkingSetId
} from '../working-set/working-set-types'

// EXPERIMENTAL deterministic Policy V0 planner. No LLM / embeddings / graph
// ranking. For identical (Universe revision, planning request, previous Working
// Set, policyVersion) the output is identical, including ordering and hash.
//
// Provider neutrality: the core never compares Pi/OpenCode/Codex literals.
// "Recent trustworthy evidence" arrives as a normalized
// `recentEvidenceSourceKeys` signal in the planning request; rehydration
// eligibility comes from an explicit `removalHistory` (previous removal/cold
// records), never from provenance guessing.

export interface PolicyV0Options {
  readonly policyVersion: string
  readonly createdAt: string
  // Map an admitted Universe entry to an experimental representation, or null
  // when the entry is not representable.
  readonly represent: (entry: ContextUniverseEntry) => ContextRepresentation | null
  // Resolve explicit protection from semantic metadata only. Never inferred
  // from source-key text patterns. Default: P0 priority => MANDATORY, pinned
  // source keys => PINNED, otherwise NORMAL.
  readonly protectionOf?: (entry: ContextUniverseEntry) => ContextProtection
}

export interface PlannerResult {
  readonly workingSet: ContextWorkingSet
  readonly decisions: readonly ContextDecision[]
  readonly transition: ContextTransition
}

export class PlanningConflictError extends Error {
  readonly conflictingSourceKeys: readonly string[]

  constructor(message: string, conflictingSourceKeys: readonly string[]) {
    super(message)
    this.name = 'PlanningConflictError'
    this.conflictingSourceKeys = conflictingSourceKeys
  }
}

function isPinned(request: ContextPlanningRequest, sourceKey: string): boolean {
  return request.pinnedSourceKeys.includes(sourceKey)
}

function isExcluded(request: ContextPlanningRequest, sourceKey: string): boolean {
  return request.excludedSourceKeys.includes(sourceKey)
}

function isCurrentTarget(request: ContextPlanningRequest, sourceKey: string): boolean {
  return request.currentTargetSourceKeys.includes(sourceKey)
}

function isLatestVerification(request: ContextPlanningRequest, sourceKey: string): boolean {
  return request.latestVerificationSourceKeys.includes(sourceKey)
}

function isRecentEvidence(request: ContextPlanningRequest, sourceKey: string): boolean {
  return request.recentEvidenceSourceKeys.includes(sourceKey)
}

function lifecycleReasonCodesFor(
  request: ContextPlanningRequest,
  sourceKey: string
): readonly ReasonCode[] {
  const signals = (request.sourceLifecycleSignals ?? [])
    .filter((signal) => signal.sourceKey === sourceKey)
    .map((signal) => signal.kind as ReasonCode)
  return [...new Set(signals)]
}

function removalRecordFor(
  request: ContextPlanningRequest,
  sourceKey: string
): { originalRemovalReasonCodes: readonly ReasonCode[]; removedAtSequence: number; removedFromWorkingSetId: string | null } | undefined {
  return (request.removalHistory ?? []).find((record) => record.sourceKey === sourceKey)
}

// The normalized representation need reason for a source, when present.
// Defaults to the narrowing direction (REPRESENTATION_NARROWED) for a
// representation change; the adapter may supply DETAIL_REQUIRED.
function representationNeedReasonFor(
  request: ContextPlanningRequest,
  sourceKey: string
): ReasonCode {
  const need = (request.representationNeeds ?? []).find((n) => n.sourceKey === sourceKey)
  if (need !== undefined) {
    if (need.reasonCode === 'DETAIL_REQUIRED') return 'DETAIL_REQUIRED'
    if (need.reasonCode === 'REPRESENTATION_NARROWED') return 'REPRESENTATION_NARROWED'
  }
  return 'REPRESENTATION_NARROWED'
}

function defaultProtectionOf(
  entry: ContextUniverseEntry,
  request: ContextPlanningRequest
): ContextProtection {
  if (entry.source.priority === 'P0') return 'MANDATORY'
  if (isPinned(request, entry.source.sourceKey)) return 'PINNED'
  return 'NORMAL'
}

export function planWorkingSet(input: {
  readonly universe: ContextUniverseRevision
  readonly request: ContextPlanningRequest
  readonly previousWorkingSet: ContextWorkingSet | null
  readonly options: PolicyV0Options
}): PlannerResult {
  const { universe, request, previousWorkingSet, options } = input
  const policyVersion = options.policyVersion
  const sequence = request.recompositionSequence
  const workingSetId = createWorkingSetId(universe.runtimeSessionId, sequence, {
    policyVersion,
    planningRequestHash: planningRequestHash(request),
    universeHash: universe.logicalHash
  })
  const requestHash = planningRequestHash(request)

  // Resolve protection for every Universe entry up front.
  const protectionOf = options.protectionOf ?? ((entry: ContextUniverseEntry) => defaultProtectionOf(entry, request))
  const protectionByKey = new Map<string, ContextProtection>()
  for (const entry of universe.entries) {
    protectionByKey.set(entry.source.sourceKey, protectionOf(entry))
  }

  // Mandatory/pin vs exclude conflict must be explicit, never silent.
  const conflicts: string[] = []
  for (const entry of universe.entries) {
    const protection = protectionByKey.get(entry.source.sourceKey)
    if (protection === 'MANDATORY' && isExcluded(request, entry.source.sourceKey)) {
      conflicts.push(entry.source.sourceKey)
    }
  }
  if (conflicts.length > 0) {
    throw new PlanningConflictError(
      `mandatory context cannot be silently excluded: ${conflicts.join(', ')}`,
      conflicts
    )
  }

  const previousByKey = new Map<string, ContextWorkingSetItem>()
  for (const item of previousWorkingSet?.items ?? []) {
    for (const key of item.sourceKeys) {
      previousByKey.set(key, item)
    }
  }

  const items: ContextWorkingSetItem[] = []
  const decisions: ContextDecision[] = []
  let totalTokens = 0

  for (const entry of universe.entries) {
    const sourceKey = entry.source.sourceKey
    const state = entry.state
    const admittedVersion = entry.admittedVersion

    // --- ABSENT handling (before requiring an admitted version) ---
    // Accepted CR-002 invariant: ABSENT => admittedVersion is null. For a
    // previously active item we derive the REMOVE subject from the previous
    // Working Set item, not from the now-null admitted version.
    if (state.observationStatus === 'ABSENT') {
      const previousItem = previousByKey.get(sourceKey)
      if (previousItem !== undefined) {
        decisions.push(
          makeDecision({
            sequence,
            kind: 'REMOVE',
            sourceKey,
            sourceVersionId: previousItem.sourceVersionIds[0]!,
            representationId: previousItem.representationId,
            fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
            toWorkingSetId: workingSetId,
            reasonCodes: ['SOURCE_ABSENT'],
            policyVersion,
            tokenDelta: -previousItem.tokenEstimate,
            previousToken: previousItem.tokenEstimate
          })
        )
      }
      continue
    }

    if (admittedVersion === null) continue

    const representation = options.represent(entry)
    if (representation === null) continue

    const protection = protectionByKey.get(sourceKey) ?? 'NORMAL'
    const lifecycleReasonCodes = lifecycleReasonCodesFor(request, sourceKey)

    // Membership determination (deterministic, structured evidence only).
    let active = false
    const reasonCodes: ReasonCode[] = []

    if (protection === 'MANDATORY') {
      active = true
      reasonCodes.push('MANDATORY_INSTRUCTION')
    } else if (protection === 'PINNED') {
      active = true
      reasonCodes.push('USER_PINNED')
    } else if (isExcluded(request, sourceKey)) {
      // Generic exclusion is not enough to infer why a source was removed.
      // When structured lifecycle evidence is present, preserve that reason;
      // otherwise retain the historical EXPLICIT_EXCLUDE behavior.
      active = false
      const previousItem = previousByKey.get(sourceKey)
      if (previousItem !== undefined) {
        decisions.push(
          makeDecision({
            sequence,
            kind: 'REMOVE',
            sourceKey,
            sourceVersionId: previousItem.sourceVersionIds[0]!,
            representationId: previousItem.representationId,
            fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
            toWorkingSetId: workingSetId,
            reasonCodes:
              lifecycleReasonCodes.length > 0
                ? lifecycleReasonCodes
                : ['EXPLICIT_EXCLUDE'],
            policyVersion,
            tokenDelta: -previousItem.tokenEstimate,
            previousToken: previousItem.tokenEstimate
          })
        )
      }
    } else if (isCurrentTarget(request, sourceKey)) {
      active = true
      reasonCodes.push('CURRENT_TARGET')
    } else if (isLatestVerification(request, sourceKey)) {
      active = true
      reasonCodes.push('LATEST_FAILURE')
    } else if (state.observationStatus === 'UNAVAILABLE') {
      active = true
      reasonCodes.push('SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP')
    } else if (previousByKey.has(sourceKey)) {
      active = true
      reasonCodes.push('PREVIOUSLY_ACTIVE')
    } else if (isRecentEvidence(request, sourceKey)) {
      active = true
      reasonCodes.push('RECENT_RUN_EVIDENCE')
    }

    reasonCodes.push(...lifecycleReasonCodes)

    if (!active) continue

    const item: ContextWorkingSetItem = {
      position: items.length,
      representationId: representation.id,
      representationKind: representation.kind,
      sourceKeys: [sourceKey],
      sourceVersionIds: representation.sourceVersionIds,
      authority: entry.source.authority ?? 'REFERENCE',
      ...(entry.source.priority !== undefined
        ? { baselinePriority: entry.source.priority }
        : {}),
      protection,
      tokenEstimate: representation.tokenEstimate,
      inclusionReasonCodes: reasonCodes
    }
    items.push(item)
    totalTokens += representation.tokenEstimate

    // Decision classification: KEEP / REPLACE / REHYDRATE / ADD.
    const previous = previousByKey.get(sourceKey)
    if (previous !== undefined) {
      const previousVersionId = previous.sourceVersionIds[0] ?? null
      const sameVersion = previousVersionId === admittedVersion.versionId
      const sameRepresentation = previous.representationId === representation.id
      if (sameVersion && sameRepresentation) {
        // Same source/version + same representation: plain KEEP.
        decisions.push(
          makeDecision({
            sequence,
            kind: 'KEEP',
            sourceKey,
            sourceVersionId: admittedVersion.versionId,
            representationId: representation.id,
            fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
            toWorkingSetId: workingSetId,
            reasonCodes,
            policyVersion,
            tokenDelta: representation.tokenEstimate - previous.tokenEstimate,
            previousToken: previous.tokenEstimate
          })
        )
      } else if (!sameVersion) {
        // Same sourceKey, admitted SourceVersion advanced: the old
        // representation is stale; replace it with a fresh representation of
        // the new version.
        decisions.push(
          makeDecision({
            sequence,
            kind: 'REPLACE',
            sourceKey,
            sourceVersionId: admittedVersion.versionId,
            representationId: representation.id,
            fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
            toWorkingSetId: workingSetId,
            reasonCodes: ['SOURCE_VERSION_ADVANCED', ...reasonCodes],
            policyVersion,
            tokenDelta: representation.tokenEstimate - previous.tokenEstimate,
            previousToken: previous.tokenEstimate
          })
        )
      } else {
        // Same source/version, representation changed: explicit REPLACE.
        const representationReason = representationNeedReasonFor(request, sourceKey)
        decisions.push(
          makeDecision({
            sequence,
            kind: 'REPLACE',
            sourceKey,
            sourceVersionId: admittedVersion.versionId,
            representationId: representation.id,
            fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
            toWorkingSetId: workingSetId,
            reasonCodes: [representationReason, ...reasonCodes],
            policyVersion,
            tokenDelta: representation.tokenEstimate - previous.tokenEstimate,
            previousToken: previous.tokenEstimate
          })
        )
      }
    } else if (removalRecordFor(request, sourceKey) !== undefined) {
      // The source was previously active and removed/cold (evidence in
      // removalHistory). Re-admission is REHYDRATE, with the original removal
      // reason preserved alongside the rehydration reason.
      const record = removalRecordFor(request, sourceKey)!
      decisions.push(
        makeDecision({
          sequence,
          kind: 'REHYDRATE',
          sourceKey,
          sourceVersionId: admittedVersion.versionId,
          representationId: representation.id,
          fromWorkingSetId: record.removedFromWorkingSetId,
          toWorkingSetId: workingSetId,
          reasonCodes: [
            ...new Set([
              'REHYDRATION_TRIGGERED' as const,
              ...record.originalRemovalReasonCodes,
              ...lifecycleReasonCodes
            ])
          ],
          policyVersion,
          tokenDelta: representation.tokenEstimate,
          previousToken: 0
        })
      )
    } else {
      // First admission (even if pinned/current-target): plain ADD.
      decisions.push(
        makeDecision({
          sequence,
          kind: 'ADD',
          sourceKey,
          sourceVersionId: admittedVersion.versionId,
          representationId: representation.id,
          fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
          toWorkingSetId: workingSetId,
          reasonCodes,
          policyVersion,
          tokenDelta: representation.tokenEstimate,
          previousToken: 0
        })
      )
    }
  }

  // Budget eviction: evict lowest-value NORMAL candidates deterministically;
  // never MANDATORY / PINNED. Highest token cost first, sourceKey tie-break.
  if (totalTokens > request.budget.maxSemanticTokens) {
    const evictable = items
      .filter((item) => item.protection === 'NORMAL')
      .sort((a, b) => {
        const costDelta = b.tokenEstimate - a.tokenEstimate
        if (costDelta !== 0) return costDelta
        return a.sourceKeys[0]!.localeCompare(b.sourceKeys[0]!)
      })
    let excess = totalTokens - request.budget.maxSemanticTokens
    const removed = new Set<string>()
    for (const candidate of evictable) {
      if (excess <= 0) break
      const key = candidate.sourceKeys[0]!
      if (removed.has(key)) continue
      removed.add(key)
      excess -= candidate.tokenEstimate
      // A source must have one coherent decision for this transition. The
      // initial membership pass may have emitted KEEP/ADD/REPLACE before
      // budget arbitration selected the same source for eviction; replace
      // that provisional decision with the authoritative REMOVE.
      for (let index = decisions.length - 1; index >= 0; index -= 1) {
        const decision = decisions[index]
        if (decision?.sourceKey === key && decision.kind !== 'REMOVE') {
          decisions.splice(index, 1)
        }
      }
      decisions.push(
        makeDecision({
          sequence,
          kind: 'REMOVE',
          sourceKey: key,
          sourceVersionId: candidate.sourceVersionIds[0]!,
          representationId: candidate.representationId,
          fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
          toWorkingSetId: workingSetId,
          reasonCodes: ['BUDGET_PRESSURE'],
          policyVersion,
          tokenDelta: -candidate.tokenEstimate,
          previousToken: candidate.tokenEstimate
        })
      )
    }
    const remaining = items
      .filter((item) => !removed.has(item.sourceKeys[0]!))
      .map((item, index) => ({ ...item, position: index }))
    items.length = 0
    items.push(...remaining)
    totalTokens = items.reduce((sum, item) => sum + item.tokenEstimate, 0)
  }

  // Deterministic final order by position.
  const orderedItems = [...items].sort((a, b) => a.position - b.position)

  const fromTokenEstimate = previousWorkingSet?.totalTokenEstimate ?? 0
  const workingSet: ContextWorkingSet = {
    workingSetId,
    runtimeSessionId: universe.runtimeSessionId,
    sequence,
    plannedFromUniverseSequence: universe.sequence,
    plannedFromUniverseHash: universe.logicalHash,
    previousWorkingSetId: previousWorkingSet?.workingSetId ?? null,
    policyVersion,
    planningRequestHash: requestHash,
    items: orderedItems,
    totalTokenEstimate: totalTokens,
    budget: request.budget,
    mode: 'SHADOW',
    logicalHash: computeWorkingSetLogicalHash({
      runtimeSessionId: universe.runtimeSessionId,
      sequence,
      plannedFromUniverseSequence: universe.sequence,
      plannedFromUniverseHash: universe.logicalHash,
      previousWorkingSetId: previousWorkingSet?.workingSetId ?? null,
      policyVersion,
      planningRequestHash: requestHash,
      items: orderedItems
    }),
    createdAt: options.createdAt
  }

  const transition: ContextTransition = {
    transitionId: `transition:${workingSetId}`,
    runtimeSessionId: universe.runtimeSessionId,
    sequence,
    fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
    toWorkingSetId: workingSetId,
    orderedDecisions: decisions,
    fromTokenEstimate,
    toTokenEstimate: totalTokens,
    policyVersion,
    logicalHash: computeTransitionLogicalHash({
      runtimeSessionId: universe.runtimeSessionId,
      sequence,
      fromWorkingSetId: previousWorkingSet?.workingSetId ?? null,
      toWorkingSetId: workingSetId,
      orderedDecisions: decisions,
      fromTokenEstimate,
      toTokenEstimate: totalTokens,
      policyVersion
    })
  }

  return { workingSet, decisions, transition }
}

function makeDecision(input: {
  readonly sequence: number
  readonly kind: ContextDecision['kind']
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly reasonCodes: readonly ReasonCode[]
  readonly policyVersion: string
  readonly tokenDelta: number
  readonly previousToken: number
}): ContextDecision {
  void input.previousToken
  return {
    decisionId: createDecisionId(input.sequence, input.kind, input.sourceKey, {
      sourceVersionId: input.sourceVersionId,
      representationId: input.representationId,
      toWorkingSetId: input.toWorkingSetId,
      reasonCodes: input.reasonCodes
    }),
    kind: input.kind,
    sourceKey: input.sourceKey,
    sourceVersionId: input.sourceVersionId,
    representationId: input.representationId,
    fromWorkingSetId: input.fromWorkingSetId,
    toWorkingSetId: input.toWorkingSetId,
    reasonCodes: input.reasonCodes,
    policyVersion: input.policyVersion,
    tokenDelta: input.tokenDelta
  }
}
