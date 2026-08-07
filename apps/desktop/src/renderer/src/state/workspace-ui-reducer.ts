export type FlowRoute =
  'dashboard' | 'outline' | 'node' | 'task' | 'context' | 'run' | 'artifact' | 'baseline'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'
export type ArtifactTab = 'summary' | 'diff' | 'tests'
export type ContextSnapshotMode = 'draft' | 'frozen'

export interface FlowNotice {
  readonly tone: NoticeTone
  readonly title: string
  readonly message: string
}

export interface WorkspaceUiState {
  readonly route: FlowRoute
  readonly selectedNodeId: string | null
  readonly selectedTaskId: string | null
  readonly selectedContextItemIds: readonly string[]
  readonly contextSnapshotMode: ContextSnapshotMode
  readonly artifactTab: ArtifactTab
  readonly contextFilter: string
  readonly notice: FlowNotice | null
  readonly dialog: 'none' | 'freeze' | 'project'
}

export type WorkspaceUiCommand =
  | { readonly type: 'NAVIGATE'; readonly route: FlowRoute }
  | { readonly type: 'SELECT_NODE'; readonly nodeId: string }
  | { readonly type: 'SELECT_TASK'; readonly taskId: string }
  | { readonly type: 'TOGGLE_CONTEXT_ITEM'; readonly itemId: string }
  | { readonly type: 'SET_ARTIFACT_TAB'; readonly tab: ArtifactTab }
  | { readonly type: 'SET_FILTER'; readonly value: string }
  | { readonly type: 'SET_DIALOG'; readonly dialog: WorkspaceUiState['dialog'] }
  | { readonly type: 'SET_NOTICE'; readonly notice: FlowNotice | null }
  | { readonly type: 'CLEAR_NOTICE' }
  | { readonly type: 'RESET_PROJECT_VIEW' }
  | { readonly type: 'BEGIN_CONTEXT_DRAFT' }
  | { readonly type: 'MARK_CONTEXT_FROZEN' }
  | { readonly type: 'INITIALIZE_CONTEXT'; readonly itemIds: readonly string[] }

export function createInitialWorkspaceUiState(): WorkspaceUiState {
  return {
    route: 'dashboard',
    selectedNodeId: null,
    selectedTaskId: null,
    selectedContextItemIds: [],
    contextSnapshotMode: 'frozen',
    artifactTab: 'summary',
    contextFilter: '',
    notice: null,
    dialog: 'none'
  }
}

export function workspaceUiReducer(
  state: WorkspaceUiState,
  command: WorkspaceUiCommand
): WorkspaceUiState {
  switch (command.type) {
    case 'NAVIGATE':
      return { ...state, route: command.route, notice: null }
    case 'SELECT_NODE':
      return { ...state, selectedNodeId: command.nodeId, route: 'node', notice: null }
    case 'SELECT_TASK':
      return { ...state, selectedTaskId: command.taskId, route: 'task', notice: null }
    case 'TOGGLE_CONTEXT_ITEM': {
      const selected = state.selectedContextItemIds.includes(command.itemId)
      return {
        ...state,
        selectedContextItemIds: selected
          ? state.selectedContextItemIds.filter((itemId) => itemId !== command.itemId)
          : [...state.selectedContextItemIds, command.itemId],
        notice: null
      }
    }
    case 'SET_ARTIFACT_TAB':
      return { ...state, artifactTab: command.tab, notice: null }
    case 'SET_FILTER':
      return { ...state, contextFilter: command.value }
    case 'SET_DIALOG':
      return { ...state, dialog: command.dialog }
    case 'SET_NOTICE':
      return { ...state, notice: command.notice }
    case 'CLEAR_NOTICE':
      return { ...state, notice: null }
    case 'RESET_PROJECT_VIEW':
      return {
        ...state,
        route: 'dashboard',
        selectedNodeId: null,
        selectedTaskId: null,
        selectedContextItemIds: [],
        contextSnapshotMode: 'frozen',
        notice: null
      }
    case 'BEGIN_CONTEXT_DRAFT':
      return {
        ...state,
        route: 'context',
        selectedContextItemIds: [],
        contextSnapshotMode: 'draft',
        notice: null
      }
    case 'MARK_CONTEXT_FROZEN':
      return { ...state, contextSnapshotMode: 'frozen' }
    case 'INITIALIZE_CONTEXT':
      return state.selectedContextItemIds.length > 0
        ? state
        : { ...state, selectedContextItemIds: [...command.itemIds] }
  }
}
