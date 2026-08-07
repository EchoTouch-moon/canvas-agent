import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceState } from '@/data/fake-workspace'
import { buildContextCandidates, estimateTokens } from './context-candidates'

describe('buildContextCandidates', () => {
  it('lists the pinned task spec as a required row plus selectable baseline node versions', () => {
    const state = createFakeWorkspaceState()
    const candidates = buildContextCandidates(state)

    const [taskCandidate] = candidates
    expect(taskCandidate?.required).toBe(true)
    expect(taskCandidate?.itemType).toBe('USER_INPUT')
    expect(taskCandidate?.authority).toBe('TASK_INSTRUCTION')
    expect(taskCandidate?.priority).toBe('P0')

    const nodeCandidates = candidates.filter((candidate) => candidate.itemType === 'NODE_VERSION')
    expect(nodeCandidates.length).toBeGreaterThan(0)
    for (const candidate of nodeCandidates) {
      expect(candidate.required).toBe(false)
      expect(candidate.itemType).toBe('NODE_VERSION')
      expect(candidate.authority).toBe('PROJECT_FACT')
      expect(candidate.priority).toBe('P1')
    }
  })

  it('only offers node versions that are members of the base baseline', () => {
    const state = createFakeWorkspaceState()
    const nodeCandidates = buildContextCandidates(state).filter(
      (candidate) => candidate.itemType === 'NODE_VERSION'
    )
    const baselineVersionIds = new Set(
      state.activeBaseline
        ? (state.baselines
            .find((aggregate) => aggregate.baseline.id === state.activeBaseline?.id)
            ?.items.map((item) => item.nodeVersionId) ?? [])
        : []
    )
    for (const candidate of nodeCandidates) {
      expect(candidate.source.kind).toBe('NODE_VERSION')
      if (candidate.source.kind === 'NODE_VERSION') {
        expect(baselineVersionIds.has(candidate.source.nodeVersionId)).toBe(true)
      }
    }
  })

  it('emits canonical selection ids and never repository/artifact content', () => {
    const candidates = buildContextCandidates(createFakeWorkspaceState())
    const itemTypes = new Set(candidates.map((candidate) => candidate.itemType))
    expect(itemTypes.has('REPOSITORY_CONTENT')).toBe(false)
    expect(itemTypes.has('ARTIFACT')).toBe(false)
    expect(itemTypes.has('PROJECT_RULE')).toBe(false)
    expect(candidates[0]?.id.startsWith('task-spec://')).toBe(true)
    for (const candidate of candidates) {
      expect(candidate.id).toMatch(/^(task-spec|node):\/\//)
    }
  })

  it('produces a positive local token preview estimate', () => {
    for (const candidate of buildContextCandidates(createFakeWorkspaceState())) {
      expect(candidate.tokenEstimate).toBeGreaterThan(0)
    }
  })

  it('estimates tokens from content length', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('a'.repeat(8))).toBe(2)
    expect(estimateTokens('word '.repeat(100))).toBe(125)
  })
})
