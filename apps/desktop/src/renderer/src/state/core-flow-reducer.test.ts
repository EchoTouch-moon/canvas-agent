import { describe, expect, it } from 'vitest'
import {
  createInitialWorkspaceUiState,
  workspaceUiReducer,
  type WorkspaceUiState
} from './workspace-ui-reducer'

function reduce(
  state: WorkspaceUiState,
  command: Parameters<typeof workspaceUiReducer>[1]
): WorkspaceUiState {
  return workspaceUiReducer(state, command)
}

describe('renderer-local workspace UI reducer', () => {
  it('keeps navigation and selection local', () => {
    let state = createInitialWorkspaceUiState()
    state = reduce(state, { type: 'NAVIGATE', route: 'context' })
    state = reduce(state, { type: 'SELECT_NODE', nodeId: 'node-1' })
    state = reduce(state, { type: 'SELECT_TASK', taskId: 'task-1' })

    expect(state.route).toBe('task')
    expect(state.selectedNodeId).toBe('node-1')
    expect(state.selectedTaskId).toBe('task-1')
  })

  it('coalesces context selection without changing domain records', () => {
    let state = createInitialWorkspaceUiState()
    state = reduce(state, { type: 'INITIALIZE_CONTEXT', itemIds: ['task-spec:1'] })
    state = reduce(state, { type: 'TOGGLE_CONTEXT_ITEM', itemId: 'node-version:1' })
    state = reduce(state, { type: 'TOGGLE_CONTEXT_ITEM', itemId: 'node-version:1' })

    expect(state.selectedContextItemIds).toEqual(['task-spec:1'])
    expect(state.notice).toBeNull()
  })

  it('retains only UI controls and notices', () => {
    let state = createInitialWorkspaceUiState()
    state = reduce(state, { type: 'SET_FILTER', value: 'node' })
    state = reduce(state, { type: 'SET_ARTIFACT_TAB', tab: 'diff' })
    state = reduce(state, { type: 'SET_DIALOG', dialog: 'freeze' })
    state = reduce(state, {
      type: 'SET_NOTICE',
      notice: { tone: 'info', title: 'Saved', message: 'Draft saved.' }
    })

    expect(state.contextFilter).toBe('node')
    expect(state.artifactTab).toBe('diff')
    expect(state.dialog).toBe('freeze')
    expect(state.notice?.title).toBe('Saved')
  })

  it('switches between a frozen projection and a new local Snapshot draft', () => {
    let state = createInitialWorkspaceUiState()
    state = reduce(state, { type: 'INITIALIZE_CONTEXT', itemIds: ['task-spec:1'] })
    state = reduce(state, { type: 'BEGIN_CONTEXT_DRAFT' })

    expect(state.contextSnapshotMode).toBe('draft')
    expect(state.selectedContextItemIds).toEqual([])
    expect(state.route).toBe('context')

    state = reduce(state, { type: 'MARK_CONTEXT_FROZEN' })
    expect(state.contextSnapshotMode).toBe('frozen')
  })
})
