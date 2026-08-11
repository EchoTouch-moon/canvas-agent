import { sha256Hex } from '../util/hash'
import type { ContextRepresentation } from '../representation/context-representation'
import type { ReasonCode } from '../planning/planning-request'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.

export const DECISION_KINDS = [
  'ADD',
  'KEEP',
  'REMOVE',
  'REPLACE',
  'COMPRESS',
  'REHYDRATE'
] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

export const PROTECTION = ['MANDATORY', 'PINNED', 'NORMAL', 'COLD_PREFERRED'] as const
export type ContextProtection = (typeof PROTECTION)[number]

export interface ContextWorkingSetItem {
  readonly position: number
  readonly representationId: string
  readonly sourceKeys: readonly string[]
  readonly sourceVersionIds: readonly string[]
  readonly authority: string
  readonly baselinePriority?: string
  readonly protection: ContextProtection
  readonly tokenEstimate: number
  readonly inclusionReasonCodes: readonly ReasonCode[]
}

export interface ContextWorkingSet {
  readonly workingSetId: string
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly plannedFromUniverseSequence: number
  readonly plannedFromUniverseHash: string
  readonly previousWorkingSetId: string | null
  readonly policyVersion: string
  readonly planningRequestHash: string
  readonly items: readonly ContextWorkingSetItem[]
  readonly totalTokenEstimate: number
  readonly budget: { readonly maxSemanticTokens: number }
  readonly mode: 'SHADOW'
  readonly logicalHash: string
  readonly createdAt: string
}

export function computeWorkingSetLogicalHash(input: {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly plannedFromUniverseSequence: number
  readonly plannedFromUniverseHash: string
  readonly previousWorkingSetId: string | null
  readonly policyVersion: string
  readonly planningRequestHash: string
  readonly items: readonly ContextWorkingSetItem[]
}): string {
  const items = [...input.items]
    .sort((a, b) => a.position - b.position)
    .map((item) =>
      [
        String(item.position),
        item.representationId,
        item.sourceKeys.join(','),
        item.sourceVersionIds.join(','),
        item.authority,
        item.baselinePriority ?? '-',
        item.protection,
        String(item.tokenEstimate),
        item.inclusionReasonCodes.join(',')
      ].join('|')
    )
  return sha256Hex(
    [
      'working-set-v1',
      input.runtimeSessionId,
      String(input.sequence),
      String(input.plannedFromUniverseSequence),
      input.plannedFromUniverseHash,
      input.previousWorkingSetId ?? '-',
      input.policyVersion,
      input.planningRequestHash,
      ...items
    ].join('\u241F')
  )
}

export function createWorkingSetId(
  runtimeSessionId: string,
  sequence: number
): string {
  return `working-set:${runtimeSessionId}:${sequence}`
}

export interface ContextDecision {
  readonly decisionId: string
  readonly kind: DecisionKind
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly reasonCodes: readonly ReasonCode[]
  readonly policyVersion: string
  readonly tokenDelta: number
}

export function createDecisionId(input: {
  readonly sequence: number
  readonly kind: DecisionKind
  readonly sourceKey: string
}): string {
  return sha256Hex(`decision-v1|${input.sequence}|${input.kind}|${input.sourceKey}`)
}

export interface ContextTransition {
  readonly transitionId: string
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly orderedDecisions: readonly ContextDecision[]
  readonly fromTokenEstimate: number
  readonly toTokenEstimate: number
  readonly policyVersion: string
  readonly logicalHash: string
}

export function computeTransitionLogicalHash(input: {
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly fromWorkingSetId: string | null
  readonly toWorkingSetId: string
  readonly orderedDecisions: readonly ContextDecision[]
  readonly fromTokenEstimate: number
  readonly toTokenEstimate: number
  readonly policyVersion: string
}): string {
  return sha256Hex(
    [
      'transition-v1',
      input.runtimeSessionId,
      String(input.sequence),
      input.fromWorkingSetId ?? '-',
      input.toWorkingSetId,
      String(input.fromTokenEstimate),
      String(input.toTokenEstimate),
      input.policyVersion,
      ...input.orderedDecisions.map((decision) => decision.decisionId)
    ].join('\u241F')
  )
}
