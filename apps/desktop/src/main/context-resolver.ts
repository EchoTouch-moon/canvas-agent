import {
  canonicalContent,
  listBaselineItems,
  listCriteria,
  listTaskTargets,
  requireNode,
  requireNodeVersion,
  requireTaskSpecVersion,
  sha256Hex,
  ValidationError,
  type Persistence
} from '@canvas-agent/persistence'
import type { ContextAuthority, ContextItemType, ContextPriority } from '@canvas-agent/domain'
import {
  sourceRefToString,
  type ContextSelection,
  type SourceReference
} from '@canvas-agent/contracts'

export interface ContextResolutionScope {
  readonly projectId: string
  readonly taskId: string
  readonly taskSpecVersionId: string
  readonly baseBaselineId: string
  readonly expectedRepositoryRevisionId: string
}

export interface ResolvedContextItem {
  readonly itemType: ContextItemType
  readonly sourceRef: string
  readonly resolvedContent: string
  readonly contentHash: string
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokenEstimate: number
  readonly selectionReason?: string | null
}

export function estimateTokens(content: string): number {
  const characters = content.replace(/\s+/g, ' ').trim().length
  return Math.max(1, Math.ceil(characters / 4))
}

// Canonical, hash-stable materialization. The resolvedContent of each item is
// exactly the canonical representation whose sha256 equals the persisted
// aggregate's own contentHash, so a frozen item can be audited against the
// authoritative source.

function materializeTaskSpec(p: Persistence, scope: ContextResolutionScope): ResolvedContextItem {
  const spec = requireTaskSpecVersion(p, scope.taskSpecVersionId)
  if (spec.taskId !== scope.taskId) {
    throw new ValidationError(`TaskSpecVersion ${spec.id} does not belong to Task ${scope.taskId}`)
  }
  const targets = listTaskTargets(p, spec.id)
  const criteria = listCriteria(p, spec.id)
  const resolvedContent = JSON.stringify({
    description: spec.description,
    scope: spec.scope,
    targets: targets.map((target) =>
      JSON.stringify({
        nodeId: target.nodeId ?? null,
        nodeVersionId: target.nodeVersionId ?? null,
        position: target.position
      })
    ),
    criteria: criteria.map((criterion) =>
      JSON.stringify({
        description: criterion.description,
        verificationMethod: criterion.verificationMethod,
        position: criterion.position
      })
    )
  })
  return {
    itemType: 'USER_INPUT',
    sourceRef: sourceRefToString({ kind: 'TASK_SPEC_VERSION', taskSpecVersionId: spec.id }),
    resolvedContent,
    contentHash: sha256Hex(resolvedContent),
    authority: 'TASK_INSTRUCTION',
    priority: 'P0',
    tokenEstimate: estimateTokens(resolvedContent)
  }
}

function materializeNodeVersion(
  p: Persistence,
  scope: ContextResolutionScope,
  ref: Extract<SourceReference, { kind: 'NODE_VERSION' }>,
  selectionReason?: string | null
): ResolvedContextItem {
  const version = requireNodeVersion(p, ref.nodeVersionId)
  const node = requireNode(p, version.nodeId)
  if (node.projectId !== scope.projectId) {
    throw new ValidationError(
      `NodeVersion ${version.id} does not belong to Project ${scope.projectId}`
    )
  }
  const baselineItems = listBaselineItems(p, scope.baseBaselineId)
  if (!baselineItems.some((item) => item.nodeVersionId === version.id)) {
    throw new ValidationError(
      `NodeVersion ${version.id} is not a member of Baseline ${scope.baseBaselineId}`
    )
  }
  const resolvedContent = canonicalContent(version.title, version.body)
  return {
    itemType: 'NODE_VERSION',
    sourceRef: sourceRefToString({ kind: 'NODE_VERSION', nodeVersionId: version.id }),
    resolvedContent,
    contentHash: sha256Hex(resolvedContent),
    authority: 'PROJECT_FACT',
    priority: 'P1',
    tokenEstimate: estimateTokens(resolvedContent),
    selectionReason: selectionReason ?? null
  }
}

export class ContextResolver {
  constructor(private readonly p: Persistence) {}

  resolve(scope: ContextResolutionScope, ref: SourceReference): ResolvedContextItem {
    switch (ref.kind) {
      case 'TASK_SPEC_VERSION': {
        const spec = requireTaskSpecVersion(this.p, ref.taskSpecVersionId)
        if (spec.taskId !== scope.taskId) {
          throw new ValidationError(
            `TaskSpecVersion ${spec.id} does not belong to Task ${scope.taskId}`
          )
        }
        return materializeTaskSpec(this.p, { ...scope, taskSpecVersionId: spec.id })
      }
      case 'NODE_VERSION':
        return materializeNodeVersion(this.p, scope, ref)
    }
  }

  // The pinned TaskSpecVersion is always materialized first at position 0 and
  // never supplied by the renderer (invariant D). Selections resolve in order;
  // duplicate sources are rejected (invariant F).
  materialize(
    scope: ContextResolutionScope,
    selections: readonly ContextSelection[]
  ): ResolvedContextItem[] {
    const items: ResolvedContextItem[] = [
      this.resolve(scope, { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: scope.taskSpecVersionId })
    ]
    const seen = new Set<string>([items[0].sourceRef])
    for (const selection of selections) {
      if (selection.source.kind !== 'NODE_VERSION') {
        throw new ValidationError(
          `Unsupported source kind for freeze selection: ${selection.source.kind}`
        )
      }
      const item = materializeNodeVersion(
        this.p,
        scope,
        selection.source,
        selection.selectionReason
      )
      if (seen.has(item.sourceRef)) {
        throw new ValidationError(`duplicate_context_source: ${item.sourceRef}`)
      }
      seen.add(item.sourceRef)
      items.push(item)
    }
    return items
  }
}
