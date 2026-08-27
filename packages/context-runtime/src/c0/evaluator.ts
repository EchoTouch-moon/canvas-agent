import type { ReasonCode } from '../planning/planning-request'
import type {
  ContextProtection,
  DecisionKind
} from '../working-set/working-set-types'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.
//
// Gate C evidence evaluator for the CSPV-C0 canary. Scores one recorded
// scenario run (a chain of SHADOW-mode transition/decision records) against
// the eight Gate D readiness criteria from
// docs/research/context-runtime-v0.3-research-rebaseline-2026-08-13.md
// ("Gate D — CR-004 readiness review"). Pure and deterministic: no fs, no
// network, no clock, no provider calls.
//
// Record shape policy: fields mirror what the pipeline actually emits.
// decisionId / kind / sourceKey / sourceVersionId / representationId /
// reasonCodes are ContextDecision fields; transitionSequence is
// ContextTransition.sequence; modelCallSequence is
// ContextUniverseRevision.modelCallSequence; protection is
// ContextWorkingSetItem.protection. The shadow planning path (planWorkingSet,
// mode 'SHADOW') produces NONE of: replay verification, materialization
// outcomes — those exist only as explicit runner-supplied evidence here, and
// their criteria surface NOT_OBSERVED when absent instead of being faked.

// The eight Gate D criteria, in doc order.
export const GATE_D_CRITERIA = [
  'REMOVE_OBSERVED',
  'REHYDRATE_AFTER_REMOVE',
  'FALSE_REMOVAL_AUDITABLE',
  'NO_MANDATORY_EVICTION',
  'EXACT_SOURCE_VERSION_REHYDRATION',
  'DETERMINISTIC_REPLAY',
  'NO_UNEXPLAINED_MATERIALIZATION_FAILURE',
  'REASON_CODE_COVERAGE'
] as const
export type GateDCriterion = (typeof GATE_D_CRITERIA)[number]

export type C0CriterionVerdict = 'PASS' | 'FAIL' | 'NOT_OBSERVED'

// Decisions that change the active set (membership or representation).
// KEEP carries no change and stays outside the reason-coverage denominator.
export const ACTIVE_SET_CHANGE_KINDS = [
  'ADD',
  'REMOVE',
  'REPLACE',
  'COMPRESS',
  'REHYDRATE'
] as const

const ACTIVE_SET_CHANGE_KIND_SET: ReadonlySet<DecisionKind> = new Set(
  ACTIVE_SET_CHANGE_KINDS
)

// Reason codes policy-v0 emits only for MANDATORY / PINNED subjects. A REMOVE
// carrying one of them is a protected eviction even when the runner did not
// attach the removed item's protection field.
const PROTECTED_REASON_CODES: ReadonlySet<ReasonCode> = new Set([
  'MANDATORY_INSTRUCTION',
  'USER_PINNED'
])

// False-removal horizon defaults (C0 run contract). HIGH_PRIORITY when the
// source was needed again within 3 model calls OR 5 transitions.
export const DEFAULT_HIGH_PRIORITY_MAX_MODEL_CALL_DISTANCE = 3
export const DEFAULT_HIGH_PRIORITY_MAX_TRANSITION_DISTANCE = 5

// Materialization outcome vocabulary aligned with admission's
// MaterializationResult statuses ('REJECTED' / 'DEFERRED'), plus the
// successful case. Runner-supplied; the shadow path never materializes.
export type C0MaterializationStatus = 'MATERIALIZED' | 'REJECTED' | 'DEFERRED'

export interface C0DecisionRecord {
  readonly decisionId: string
  readonly kind: DecisionKind
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly reasonCodes: readonly ReasonCode[]
  // ContextTransition.sequence of the transition this decision belongs to.
  readonly transitionSequence: number
  // ContextUniverseRevision.modelCallSequence the plan was derived from.
  // null / undefined when the boundary has no call sequence (seed revision).
  readonly modelCallSequence?: number | null
  // ContextWorkingSetItem.protection of the subject at removal time. The
  // live runner copies it from the previous Working Set item of a REMOVE.
  readonly protection?: ContextProtection
  // Explicit replay evidence: the runner replayed this boundary and compared
  // logical hashes. Absent on every record => DETERMINISTIC_REPLAY is
  // NOT_OBSERVED.
  readonly replayVerified?: boolean
  // Materialization outcome for this decision's representation. Absent on
  // every record => NO_UNEXPLAINED_MATERIALIZATION_FAILURE is NOT_OBSERVED.
  readonly materializationStatus?: C0MaterializationStatus
  // Explanation attached to a REJECTED / DEFERRED outcome; a failure without
  // one counts as unexplained.
  readonly materializationFailureReason?: string
}

export interface C0EvaluationInput {
  readonly records: readonly C0DecisionRecord[]
  // Version ids the recorded decisions must resolve against (the union of
  // admitted version ids of the supplied Universe revisions).
  readonly universeVersionIds: readonly string[]
}

export interface C0EvaluatorOptions {
  // HIGH_PRIORITY horizon when model-call distance <= this (default 3).
  readonly highPriorityMaxModelCallDistance?: number
  // HIGH_PRIORITY horizon when transition distance <= this (default 5).
  readonly highPriorityMaxTransitionDistance?: number
}

export type C0FalseRemovalPriority = 'HIGH_PRIORITY' | 'LOW_PRIORITY'

export interface C0FalseRemovalCandidate {
  readonly sourceKey: string
  readonly removeDecisionId: string
  readonly rehydrateDecisionId: string
  // Model-call distance between the REMOVE and the REHYDRATE. null when
  // either side lacks a model-call sequence (axis NOT_OBSERVED).
  readonly modelCallDistance: number | null
  readonly transitionDistance: number
  readonly priority: C0FalseRemovalPriority
}

export interface C0ScenarioCounts {
  readonly removeObserved: number
  readonly rehydrateObserved: number
  // REHYDRATE records with a prior REMOVE for the same sourceKey in the same
  // chain. Only these count towards Gate D "REHYDRATE after prior REMOVE".
  readonly rehydrateAfterRemoveObserved: number
  // REHYDRATE records without a matching prior REMOVE (policy violation).
  readonly orphanRehydrates: number
  readonly falseRemovalCandidates: readonly C0FalseRemovalCandidate[]
  // REMOVE records of MANDATORY / PINNED subjects (protection field) or
  // carrying MANDATORY_INSTRUCTION / USER_PINNED reason codes.
  readonly mandatoryEvictions: number
  // Qualifying rehydrates whose sourceVersionId differs from the REMOVEd one.
  readonly wrongVersionRehydrates: number
  // Records carrying explicit replay evidence (true or false).
  readonly replayEvidenceCount: number
  readonly replayMismatches: number
  readonly unexplainedMaterializationFailures: number
  // Any decision (KEEP included) with empty reasonCodes.
  readonly unexplainedDecisions: number
  readonly activeSetChanges: number
  readonly explainedActiveSetChanges: number
  // explained / total active-set changes; null when there are none.
  readonly reasonCodeCoverage: number | null
  readonly provenanceResolved: number
  readonly provenanceTotal: number
  // resolved / total decisions; null when there are no records.
  readonly provenanceRetained: number | null
}

export interface C0ScenarioVerdict {
  // PASS only when all eight Gate D criteria are PASS, provenanceRetained
  // is exactly 1 and no decision is unexplained. NOT_OBSERVED criteria
  // therefore block PASS: a readiness gate needs positive evidence.
  readonly overall: 'PASS' | 'FAIL'
  readonly criteria: Readonly<Record<GateDCriterion, C0CriterionVerdict>>
  readonly counts: C0ScenarioCounts
}

function isProtectedRemoval(record: C0DecisionRecord): boolean {
  if (record.protection === 'MANDATORY' || record.protection === 'PINNED') {
    return true
  }
  return record.reasonCodes.some((reasonCode) =>
    PROTECTED_REASON_CODES.has(reasonCode)
  )
}

function classifyFalseRemoval(
  remove: C0DecisionRecord,
  rehydrate: C0DecisionRecord,
  maxModelCallDistance: number,
  maxTransitionDistance: number
): C0FalseRemovalCandidate {
  const modelCallDistance =
    remove.modelCallSequence != null && rehydrate.modelCallSequence != null
      ? Math.abs(rehydrate.modelCallSequence - remove.modelCallSequence)
      : null
  const transitionDistance = Math.abs(
    rehydrate.transitionSequence - remove.transitionSequence
  )
  const withinCalls =
    modelCallDistance !== null && modelCallDistance <= maxModelCallDistance
  const withinTransitions = transitionDistance <= maxTransitionDistance
  return {
    sourceKey: rehydrate.sourceKey,
    removeDecisionId: remove.decisionId,
    rehydrateDecisionId: rehydrate.decisionId,
    modelCallDistance,
    transitionDistance,
    priority:
      withinCalls || withinTransitions ? 'HIGH_PRIORITY' : 'LOW_PRIORITY'
  }
}

export function evaluateC0Scenario(
  input: C0EvaluationInput,
  options?: C0EvaluatorOptions
): C0ScenarioVerdict {
  const maxModelCallDistance =
    options?.highPriorityMaxModelCallDistance ??
    DEFAULT_HIGH_PRIORITY_MAX_MODEL_CALL_DISTANCE
  const maxTransitionDistance =
    options?.highPriorityMaxTransitionDistance ??
    DEFAULT_HIGH_PRIORITY_MAX_TRANSITION_DISTANCE
  const universeVersionIds = new Set(input.universeVersionIds)

  let removeObserved = 0
  let rehydrateObserved = 0
  let rehydrateAfterRemoveObserved = 0
  let orphanRehydrates = 0
  let wrongVersionRehydrates = 0
  let mandatoryEvictions = 0
  let replayEvidenceCount = 0
  let replayMismatches = 0
  let materializationObserved = 0
  let unexplainedMaterializationFailures = 0
  let unexplainedDecisions = 0
  let activeSetChanges = 0
  let explainedActiveSetChanges = 0
  let provenanceResolved = 0

  const falseRemovalCandidates: C0FalseRemovalCandidate[] = []
  // Most recent unconsumed REMOVE per sourceKey. A REHYDRATE consumes the
  // removal it re-admits, so a second REHYDRATE without another REMOVE is an
  // orphan rather than a second qualifying pair.
  const lastRemoveByKey = new Map<string, C0DecisionRecord>()

  for (const record of input.records) {
    if (record.reasonCodes.length === 0) unexplainedDecisions += 1
    if (ACTIVE_SET_CHANGE_KIND_SET.has(record.kind)) {
      activeSetChanges += 1
      if (record.reasonCodes.length > 0) explainedActiveSetChanges += 1
    }
    if (universeVersionIds.has(record.sourceVersionId)) provenanceResolved += 1

    if (record.replayVerified !== undefined) {
      replayEvidenceCount += 1
      if (!record.replayVerified) replayMismatches += 1
    }

    if (record.materializationStatus !== undefined) {
      materializationObserved += 1
      const failed = record.materializationStatus !== 'MATERIALIZED'
      const reason = record.materializationFailureReason
      if (failed && (reason == null || reason === '')) {
        unexplainedMaterializationFailures += 1
      }
    }

    if (record.kind === 'REMOVE') {
      removeObserved += 1
      if (isProtectedRemoval(record)) mandatoryEvictions += 1
      lastRemoveByKey.set(record.sourceKey, record)
    } else if (record.kind === 'REHYDRATE') {
      rehydrateObserved += 1
      const remove = lastRemoveByKey.get(record.sourceKey)
      if (remove === undefined) {
        orphanRehydrates += 1
        continue
      }
      rehydrateAfterRemoveObserved += 1
      // Exact SourceVersion rehydration: the re-admitted version must equal
      // the version that was REMOVEd, not a different version of the source.
      if (record.sourceVersionId !== remove.sourceVersionId) {
        wrongVersionRehydrates += 1
      }
      falseRemovalCandidates.push(
        classifyFalseRemoval(
          remove,
          record,
          maxModelCallDistance,
          maxTransitionDistance
        )
      )
      lastRemoveByKey.delete(record.sourceKey)
    }
  }

  const provenanceTotal = input.records.length
  const criteria: Record<GateDCriterion, C0CriterionVerdict> = {
    REMOVE_OBSERVED: removeObserved > 0 ? 'PASS' : 'FAIL',
    REHYDRATE_AFTER_REMOVE:
      rehydrateAfterRemoveObserved > 0 && orphanRehydrates === 0
        ? 'PASS'
        : rehydrateObserved > 0
          ? 'FAIL'
          : 'NOT_OBSERVED',
    FALSE_REMOVAL_AUDITABLE:
      removeObserved === 0
        ? 'NOT_OBSERVED'
        : falseRemovalCandidates.every(
            (candidate) => candidate.modelCallDistance !== null
          )
          ? 'PASS'
          : 'FAIL',
    NO_MANDATORY_EVICTION:
      mandatoryEvictions > 0
        ? 'FAIL'
        : removeObserved > 0
          ? 'PASS'
          : 'NOT_OBSERVED',
    EXACT_SOURCE_VERSION_REHYDRATION:
      wrongVersionRehydrates > 0
        ? 'FAIL'
        : rehydrateAfterRemoveObserved > 0
          ? 'PASS'
          : 'NOT_OBSERVED',
    DETERMINISTIC_REPLAY:
      replayMismatches > 0
        ? 'FAIL'
        : replayEvidenceCount > 0
          ? 'PASS'
          : 'NOT_OBSERVED',
    NO_UNEXPLAINED_MATERIALIZATION_FAILURE:
      unexplainedMaterializationFailures > 0
        ? 'FAIL'
        : materializationObserved > 0
          ? 'PASS'
          : 'NOT_OBSERVED',
    REASON_CODE_COVERAGE:
      activeSetChanges === 0
        ? 'NOT_OBSERVED'
        : explainedActiveSetChanges === activeSetChanges
          ? 'PASS'
          : 'FAIL'
  }

  const allCriteriaPass = GATE_D_CRITERIA.every(
    (criterion) => criteria[criterion] === 'PASS'
  )
  const provenanceComplete =
    provenanceTotal > 0 && provenanceResolved === provenanceTotal
  const overall =
    allCriteriaPass && provenanceComplete && unexplainedDecisions === 0
      ? 'PASS'
      : 'FAIL'

  return {
    overall,
    criteria,
    counts: {
      removeObserved,
      rehydrateObserved,
      rehydrateAfterRemoveObserved,
      orphanRehydrates,
      falseRemovalCandidates,
      mandatoryEvictions,
      wrongVersionRehydrates,
      replayEvidenceCount,
      replayMismatches,
      unexplainedMaterializationFailures,
      unexplainedDecisions,
      activeSetChanges,
      explainedActiveSetChanges,
      reasonCodeCoverage:
        activeSetChanges > 0
          ? explainedActiveSetChanges / activeSetChanges
          : null,
      provenanceResolved,
      provenanceTotal,
      provenanceRetained:
        provenanceTotal > 0 ? provenanceResolved / provenanceTotal : null
    }
  }
}
