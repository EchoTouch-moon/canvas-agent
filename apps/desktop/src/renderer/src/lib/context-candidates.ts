import type { ContextAuthority, ContextItemType, ContextPriority } from '@canvas-agent/domain'
import type { ProjectStateView } from '@/lib/workspace-types'

export interface ContextCandidateInput {
  readonly id: string
  readonly itemType: ContextItemType
  readonly sourceRef: string
  readonly resolvedContent: string
  readonly authority: ContextAuthority
  readonly priority: ContextPriority
  readonly tokenEstimate: number
  readonly position: number
  readonly label: string
  readonly description: string
}

export function estimateTokens(content: string): number {
  const characters = content.replace(/\s+/g, ' ').trim().length
  return Math.max(1, Math.ceil(characters / 4))
}

export function buildContextCandidates(workspace: ProjectStateView): ContextCandidateInput[] {
  const candidates: ContextCandidateInput[] = []

  for (const aggregate of workspace.taskSpecs) {
    const { spec, criteria } = aggregate
    const content = [
      `TaskSpecVersion ${spec.id}`,
      `Description: ${spec.description}`,
      `Scope: ${spec.scope}`,
      ...criteria.map((criterion, index) => `Criterion ${index + 1}: ${criterion.description}`)
    ].join('\n')
    candidates.push({
      id: `task-spec://${spec.id}`,
      itemType: 'USER_INPUT',
      sourceRef: `task-spec://${spec.id}`,
      resolvedContent: content,
      authority: 'TASK_INSTRUCTION',
      priority: 'P0',
      tokenEstimate: estimateTokens(content),
      position: candidates.length,
      label: `Task instruction · ${spec.id}`,
      description: spec.description
    })
  }

  for (const version of workspace.nodeVersions) {
    const content = `${version.title}\n\n${version.body}`
    candidates.push({
      id: `node://${version.id}`,
      itemType: 'NODE_VERSION',
      sourceRef: `node://${version.id}`,
      resolvedContent: content,
      authority: 'PROJECT_FACT',
      priority: 'P1',
      tokenEstimate: estimateTokens(content),
      position: candidates.length,
      label: `Node version · ${version.title}`,
      description: version.body
    })
  }

  return candidates
}
