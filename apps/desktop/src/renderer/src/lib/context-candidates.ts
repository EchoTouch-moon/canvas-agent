import type { ContextAuthority, ContextItemType, ContextPriority } from '@canvas-agent/domain'
import { sourceRefToString, type SourceReference } from '@canvas-agent/contracts'
import type { ProjectStateView } from '@/lib/workspace-types'

export interface ContextCandidate {
  readonly id: string
  readonly source: SourceReference
  readonly label: string
  readonly description: string
  readonly itemType: ContextItemType
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokenEstimate: number
  readonly required: boolean
}

export function estimateTokens(content: string): number {
  const characters = content.replace(/\s+/g, ' ').trim().length
  return Math.max(1, Math.ceil(characters / 4))
}

// The renderer only *selects sources*; Main derives content/authority/priority.
// The pinned TaskSpecVersion is displayed as a required row but is never
// submitted (Main auto-materializes it). NodeVersion candidates are limited to
// members of the base baseline so a selection can actually freeze.
export function buildContextCandidates(workspace: ProjectStateView): ContextCandidate[] {
  const candidates: ContextCandidate[] = []

  const pinnedSpec = workspace.taskSpecs[0]
  if (pinnedSpec) {
    const { spec } = pinnedSpec
    const preview = [
      spec.description,
      spec.scope,
      ...pinnedSpec.criteria.map((criterion) => criterion.description)
    ].join(' ')
    candidates.push({
      id: `task-spec://${spec.id}`,
      source: { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: spec.id },
      label: `Task instruction · ${spec.id}`,
      description: spec.description,
      itemType: 'USER_INPUT',
      authority: 'TASK_INSTRUCTION',
      priority: 'P0',
      tokenEstimate: estimateTokens(preview),
      required: true
    })
  }

  const baseBaseline =
    workspace.baselines.find(
      (aggregate) => aggregate.baseline.id === (workspace.activeBaseline?.id ?? null)
    ) ?? workspace.baselines[0]
  const baselineVersionIds = new Set(
    baseBaseline === undefined ? [] : baseBaseline.items.map((item) => item.nodeVersionId)
  )

  for (const version of workspace.nodeVersions) {
    if (!baselineVersionIds.has(version.id)) {
      continue
    }
    const source: SourceReference = { kind: 'NODE_VERSION', nodeVersionId: version.id }
    candidates.push({
      id: sourceRefToString(source),
      source,
      label: `Node version · ${version.title}`,
      description: version.body,
      itemType: 'NODE_VERSION',
      authority: 'PROJECT_FACT',
      priority: 'P1',
      tokenEstimate: estimateTokens(`${version.title} ${version.body}`),
      required: false
    })
  }

  return candidates
}
