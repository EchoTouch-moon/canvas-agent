import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceState } from '@/data/fake-workspace'
import { buildContextCandidates, estimateTokens } from './context-candidates'

describe('buildContextCandidates', () => {
  it('derives candidates only from authoritative persisted content', () => {
    const state = createFakeWorkspaceState()
    const candidates = buildContextCandidates(state)

    const specItems = candidates.filter((candidate) => candidate.itemType === 'USER_INPUT')
    const versionItems = candidates.filter((candidate) => candidate.itemType === 'NODE_VERSION')

    expect(candidates).toHaveLength(state.taskSpecs.length + state.nodeVersions.length)
    expect(specItems).toHaveLength(state.taskSpecs.length)
    expect(versionItems).toHaveLength(state.nodeVersions.length)
  })

  it('marks the task instruction as P0 and node versions as P1 with TASK_INSTRUCTION/PROJECT_FACT authority', () => {
    const state = createFakeWorkspaceState()
    const [taskCandidate] = buildContextCandidates(state).filter(
      (candidate) => candidate.itemType === 'USER_INPUT'
    )

    expect(taskCandidate?.authority).toBe('TASK_INSTRUCTION')
    expect(taskCandidate?.priority).toBe('P0')
    expect(taskCandidate?.sourceRef).toBe(`task-spec://${state.taskSpecs[0]?.spec.id}`)
    expect(taskCandidate?.resolvedContent).toContain(state.taskSpecs[0]?.spec.description ?? '')

    const versionCandidate = buildContextCandidates(state).find(
      (candidate) => candidate.itemType === 'NODE_VERSION'
    )
    expect(versionCandidate?.authority).toBe('PROJECT_FACT')
    expect(versionCandidate?.priority).toBe('P1')
    expect(versionCandidate?.resolvedContent).toContain(state.nodeVersions[0]?.title ?? '')
  })

  it('produces a positive token estimate and strictly increasing positions', () => {
    const candidates = buildContextCandidates(createFakeWorkspaceState())

    for (const [index, candidate] of candidates.entries()) {
      expect(candidate.tokenEstimate).toBeGreaterThan(0)
      expect(candidate.position).toBe(index)
    }
  })

  it('never emits fixture-only content types', () => {
    const candidates = buildContextCandidates(createFakeWorkspaceState())
    const itemTypes = new Set(candidates.map((candidate) => candidate.itemType))
    expect(itemTypes.has('REPOSITORY_CONTENT')).toBe(false)
    expect(itemTypes.has('ARTIFACT')).toBe(false)
    expect(itemTypes.has('PROJECT_RULE')).toBe(false)
  })

  it('estimates tokens from the content length', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('a'.repeat(8))).toBe(2)
    expect(estimateTokens('word '.repeat(100))).toBe(125)
  })
})
