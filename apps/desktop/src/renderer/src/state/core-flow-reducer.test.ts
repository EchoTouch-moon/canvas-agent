import { describe, expect, it } from 'vitest'
import {
  CORE_FLOW_IDS,
  createInitialCoreFlowState,
  type CoreFlowState
} from '@/data/core-flow-fixture'
import {
  coreFlowReducer,
  getFreezeBlockers,
  getSelectedContextTokens,
  type CoreFlowCommand
} from './core-flow-reducer'

function reduce(state: CoreFlowState, command: CoreFlowCommand): CoreFlowState {
  return coreFlowReducer(state, command)
}

function createSucceededRunState(): CoreFlowState {
  let state = createInitialCoreFlowState()
  state = reduce(state, { type: 'TOGGLE_CONTEXT_ITEM', itemId: CORE_FLOW_IDS.recordingVersionNode })
  state = reduce(state, { type: 'FREEZE_SNAPSHOT' })
  state = reduce(state, { type: 'START_RUN' })
  state = reduce(state, { type: 'ADVANCE_RUN' })
  state = reduce(state, { type: 'ADVANCE_RUN' })
  state = reduce(state, { type: 'FINISH_RUN' })
  return state
}

describe('core flow command interactions', () => {
  it('updates optional context count, order and token budget while pinning required items', () => {
    const initial = createInitialCoreFlowState()
    const afterAdd = reduce(initial, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.recordingVersionNode
    })
    const afterSecondAdd = reduce(afterAdd, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.recordingExample
    })
    const afterRemove = reduce(afterSecondAdd, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.recordingVersionNode
    })
    const afterRequiredRemove = reduce(afterRemove, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.projectRule
    })

    expect(afterAdd.selectedContextItemIds).toEqual([
      CORE_FLOW_IDS.projectRule,
      CORE_FLOW_IDS.taskInstruction,
      CORE_FLOW_IDS.recordingVersionNode
    ])
    expect(getSelectedContextTokens(afterSecondAdd)).toBe(6_600)
    expect(afterRemove.selectedContextItemIds).toEqual([
      CORE_FLOW_IDS.projectRule,
      CORE_FLOW_IDS.taskInstruction,
      CORE_FLOW_IDS.recordingExample
    ])
    expect(afterRequiredRemove.selectedContextItemIds).toContain(CORE_FLOW_IDS.projectRule)
    expect(afterRequiredRemove.notice?.title).toBe('Required item is pinned')
  })

  it('blocks Freeze for conflict and overflow without changing a Draft Snapshot', () => {
    const conflictState = reduce(createInitialCoreFlowState(), {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.conflictingNote
    })
    const blockedConflict = reduce(conflictState, { type: 'FREEZE_SNAPSHOT' })
    expect(getFreezeBlockers(conflictState)).toHaveLength(1)
    expect(blockedConflict.snapshot.status).toBe('DRAFT')
    expect(blockedConflict.notice?.title).toBe('Freeze blocked')

    let overflowState = createInitialCoreFlowState()
    overflowState = reduce(overflowState, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.recordingVersionNode
    })
    overflowState = reduce(overflowState, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.schemaNode
    })
    const blockedOverflow = reduce(overflowState, { type: 'FREEZE_SNAPSHOT' })
    expect(getFreezeBlockers(overflowState)).toHaveLength(1)
    expect(blockedOverflow.snapshot.status).toBe('DRAFT')
    expect(blockedOverflow.notice?.message).toContain('over the')
  })

  it('freezes context read-only and starts a Run as a separate command', () => {
    const initial = createInitialCoreFlowState()
    const frozen = reduce(initial, { type: 'FREEZE_SNAPSHOT' })
    const editedAfterFreeze = reduce(frozen, {
      type: 'TOGGLE_CONTEXT_ITEM',
      itemId: CORE_FLOW_IDS.recordingExample
    })
    const queued = reduce(frozen, { type: 'START_RUN' })

    expect(frozen.snapshot.status).toBe('FROZEN')
    expect(editedAfterFreeze.selectedContextItemIds).toEqual(frozen.selectedContextItemIds)
    expect(editedAfterFreeze.notice?.title).toBe('Snapshot is read-only')
    expect(queued.snapshot.status).toBe('FROZEN')
    expect(queued.run.status).toBe('QUEUED')
  })

  it('keeps Task review separate from a succeeded Run and Artifact acceptance', () => {
    const succeeded = createSucceededRunState()
    const applied = reduce(succeeded, { type: 'APPLY_ARTIFACT' })
    const accepted = reduce(applied, { type: 'ACCEPT_ARTIFACT' })
    const evaluated = reduce(accepted, { type: 'EVALUATE_ACCEPTANCE' })

    expect(succeeded.run.outcome).toBe('SUCCEEDED')
    expect(succeeded.task.status).toBe('WAITING_REVIEW')
    expect(accepted.artifact.reviewStatus).toBe('ACCEPTED')
    expect(accepted.task.status).toBe('WAITING_REVIEW')
    expect(evaluated.task.status).toBe('WAITING_REVIEW')
    expect(evaluated.task.acceptanceEvaluated).toBe(true)
  })

  it('requires explicit completion before Baseline activation', () => {
    const evaluated = reduce(reduce(createSucceededRunState(), { type: 'APPLY_ARTIFACT' }), {
      type: 'ACCEPT_ARTIFACT'
    })
    const evaluatedWithCriteria = reduce(evaluated, { type: 'EVALUATE_ACCEPTANCE' })
    const completed = reduce(evaluatedWithCriteria, { type: 'COMPLETE_TASK' })
    const activated = reduce(completed, { type: 'ACTIVATE_BASELINE' })

    expect(evaluatedWithCriteria.baseline.status).toBe('DRAFT')
    expect(completed.task.status).toBe('COMPLETED')
    expect(completed.baseline.status).toBe('DRAFT')
    expect(activated.baseline.status).toBe('ACTIVE')
  })
})
