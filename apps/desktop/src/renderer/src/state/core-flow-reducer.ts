import {
  assertBaselineTransition,
  assertRunState,
  assertRunTransition,
  assertTaskTransition
} from '@canvas-agent/domain'
import type {
  ArtifactTab,
  CoreFlowState,
  ContextCandidate,
  FlowNotice,
  FlowRoute,
  RunTimelineEvent
} from '@/data/core-flow-fixture'
import { createInitialCoreFlowState } from '@/data/core-flow-fixture'

export type CoreFlowCommand =
  | { readonly type: 'NAVIGATE'; readonly route: FlowRoute }
  | { readonly type: 'SELECT_NODE'; readonly nodeId: string }
  | { readonly type: 'TOGGLE_CONTEXT_ITEM'; readonly itemId: string }
  | { readonly type: 'FREEZE_SNAPSHOT' }
  | { readonly type: 'START_RUN' }
  | { readonly type: 'ADVANCE_RUN' }
  | { readonly type: 'FINISH_RUN' }
  | { readonly type: 'SET_ARTIFACT_TAB'; readonly tab: ArtifactTab }
  | { readonly type: 'APPLY_ARTIFACT' }
  | { readonly type: 'ACCEPT_ARTIFACT' }
  | { readonly type: 'REJECT_ARTIFACT' }
  | { readonly type: 'REQUEST_CHANGES' }
  | { readonly type: 'COMPLETE_TASK' }
  | { readonly type: 'ACTIVATE_BASELINE' }
  | { readonly type: 'CLEAR_NOTICE' }
  | { readonly type: 'RESET_FLOW' }

function notice(tone: FlowNotice['tone'], title: string, message: string): FlowNotice {
  return { tone, title, message }
}

function withNotice(state: CoreFlowState, nextNotice: FlowNotice): CoreFlowState {
  return { ...state, notice: nextNotice }
}

function canTaskTransition(
  from: CoreFlowState['task']['status'],
  to: CoreFlowState['task']['status']
): boolean {
  try {
    assertTaskTransition(from, to)
    return true
  } catch {
    return false
  }
}

function canRunTransition(
  from: CoreFlowState['run']['status'],
  to: CoreFlowState['run']['status']
): boolean {
  try {
    assertRunTransition(from, to)
    return true
  } catch {
    return false
  }
}

function canBaselineTransition(
  from: CoreFlowState['baseline']['status'],
  to: CoreFlowState['baseline']['status']
): boolean {
  try {
    assertBaselineTransition(from, to)
    return true
  } catch {
    return false
  }
}

export function getSelectedContextItems(state: CoreFlowState): readonly ContextCandidate[] {
  const itemById = new Map(state.contextItems.map((item) => [item.id, item]))
  return state.selectedContextItemIds.flatMap((itemId) => {
    const item = itemById.get(itemId)
    return item ? [item] : []
  })
}

export function getSelectedContextTokens(state: CoreFlowState): number {
  return getSelectedContextItems(state).reduce((total, item) => total + item.tokens, 0)
}

export function getFreezeBlockers(state: CoreFlowState): readonly string[] {
  const selected = getSelectedContextItems(state)
  const blockers: string[] = []
  const conflictingItem = selected.find((item) => item.conflictsWith !== undefined)

  if (conflictingItem) {
    const conflictingTarget = state.contextItems.find(
      (item) => item.id === conflictingItem.conflictsWith
    )
    blockers.push(
      `${conflictingItem.label} conflicts with ${conflictingTarget?.label ?? 'the task specification'}.`
    )
  }

  const selectedTokens = getSelectedContextTokens(state)
  if (selectedTokens > state.snapshot.tokenBudget) {
    blockers.push(
      `Selected context uses ${selectedTokens.toLocaleString()} tokens, over the ${state.snapshot.tokenBudget.toLocaleString()} token budget.`
    )
  }

  return blockers
}

function updateTimeline(
  timeline: readonly RunTimelineEvent[],
  updates: Readonly<Record<string, Partial<RunTimelineEvent>>>
): readonly RunTimelineEvent[] {
  return timeline.map((event) => {
    const update = updates[event.id]
    return update ? { ...event, ...update } : event
  })
}

function runCommandFailure(state: CoreFlowState, title: string, message: string): CoreFlowState {
  return withNotice(state, notice('warning', title, message))
}

export function coreFlowReducer(state: CoreFlowState, command: CoreFlowCommand): CoreFlowState {
  switch (command.type) {
    case 'NAVIGATE':
      return { ...state, route: command.route, notice: null }

    case 'SELECT_NODE':
      return state.nodes.some((node) => node.id === command.nodeId)
        ? { ...state, selectedNodeId: command.nodeId, route: 'node', notice: null }
        : runCommandFailure(
            state,
            'Node unavailable',
            'That node is not present in the current fixture.'
          )

    case 'TOGGLE_CONTEXT_ITEM': {
      const item = state.contextItems.find((candidate) => candidate.id === command.itemId)
      if (!item)
        return runCommandFailure(
          state,
          'Context item unavailable',
          'Choose an item from the fixture list.'
        )
      if (state.snapshot.status !== 'DRAFT') {
        return runCommandFailure(
          state,
          'Snapshot is read-only',
          'Frozen context cannot be changed. Create a new draft snapshot for another Run.'
        )
      }

      const isSelected = state.selectedContextItemIds.includes(item.id)
      if (isSelected && item.required) {
        return runCommandFailure(
          state,
          'Required item is pinned',
          `${item.label} is required by the TaskSpecVersion and cannot be removed.`
        )
      }

      const selectedContextItemIds = isSelected
        ? state.selectedContextItemIds.filter((itemId) => itemId !== item.id)
        : [...state.selectedContextItemIds, item.id]
      return {
        ...state,
        selectedContextItemIds,
        notice: notice(
          'info',
          isSelected ? 'Context item removed' : 'Context item added',
          `${item.label} is ${isSelected ? 'no longer selected' : 'now selected'} for Snapshot draft 04.`
        )
      }
    }

    case 'FREEZE_SNAPSHOT': {
      if (state.snapshot.status !== 'DRAFT') {
        return runCommandFailure(
          state,
          'Snapshot is already frozen',
          'Starting a Run is a separate action.'
        )
      }
      const blockers = getFreezeBlockers(state)
      if (blockers.length > 0) {
        return withNotice(
          state,
          notice('danger', 'Freeze blocked', `Snapshot stays Draft. ${blockers.join(' ')}`)
        )
      }
      return {
        ...state,
        snapshot: { ...state.snapshot, status: 'FROZEN', frozenAt: 'Just now' },
        notice: notice(
          'success',
          'Snapshot frozen',
          'Selected context is now read-only. Starting RUN-009 remains a separate action.'
        )
      }
    }

    case 'START_RUN': {
      if (state.snapshot.status !== 'FROZEN') {
        return runCommandFailure(
          state,
          'Freeze required before Run',
          'Resolve ContextSnapshot blockers and freeze the selected context first.'
        )
      }
      if (state.run.status !== 'CREATED') {
        return runCommandFailure(
          state,
          'Run already started',
          'Continue the existing Run from its timeline.'
        )
      }
      if (!canRunTransition(state.run.status, 'QUEUED')) {
        return runCommandFailure(
          state,
          'Run transition blocked',
          'The mock Run cannot enter the queue from its current state.'
        )
      }
      return {
        ...state,
        route: 'run',
        run: {
          ...state.run,
          status: 'QUEUED',
          startedAt: 'Just now',
          timeline: updateTimeline(state.run.timeline, {
            'timeline-created': {
              state: 'complete',
              detail: 'A frozen ContextSnapshot is attached.'
            },
            'timeline-queued': { state: 'active', detail: 'RUN-009 is queued for the mock worker.' }
          })
        },
        notice: notice(
          'info',
          'Run queued',
          'Worker preparation is visible in the timeline as a separate step.'
        )
      }
    }

    case 'ADVANCE_RUN': {
      if (state.run.status === 'QUEUED' && canRunTransition('QUEUED', 'PREPARING')) {
        return {
          ...state,
          run: {
            ...state.run,
            status: 'PREPARING',
            timeline: updateTimeline(state.run.timeline, {
              'timeline-queued': { state: 'complete', detail: 'The mock worker claimed RUN-009.' },
              'timeline-finished': {
                state: 'active',
                detail: 'Execution is preparing acceptance evidence.'
              }
            })
          },
          notice: notice(
            'info',
            'Worker preparing',
            'The next explicit mock action starts execution.'
          )
        }
      }
      if (state.run.status === 'PREPARING' && canRunTransition('PREPARING', 'RUNNING')) {
        return {
          ...state,
          run: {
            ...state.run,
            status: 'RUNNING',
            timeline: updateTimeline(state.run.timeline, {
              'timeline-finished': {
                state: 'active',
                detail: 'Tests are running against the frozen snapshot.'
              }
            })
          },
          notice: notice('info', 'Run executing', 'RUN-009 is still separate from Task acceptance.')
        }
      }
      return runCommandFailure(
        state,
        'No mock step available',
        'Start or finish the Run from its current timeline state.'
      )
    }

    case 'FINISH_RUN': {
      if (state.run.status !== 'RUNNING' || !canRunTransition(state.run.status, 'FINISHED')) {
        return runCommandFailure(
          state,
          'Run is not ready to finish',
          'Advance the mock Run until it is executing.'
        )
      }
      if (!canTaskTransition(state.task.status, 'WAITING_REVIEW')) {
        return runCommandFailure(
          state,
          'Task review gate unavailable',
          'The Task cannot enter review from its current status.'
        )
      }
      const nextRun: CoreFlowState['run'] = {
        ...state.run,
        status: 'FINISHED',
        outcome: 'SUCCEEDED',
        timeline: updateTimeline(state.run.timeline, {
          'timeline-finished': {
            state: 'complete',
            detail: 'Run succeeded. Human acceptance is still required.'
          }
        })
      }
      assertRunState({ status: nextRun.status, outcome: nextRun.outcome })
      return {
        ...state,
        task: { ...state.task, status: 'WAITING_REVIEW' },
        run: nextRun,
        route: 'artifact',
        notice: notice(
          'success',
          'Run succeeded',
          'Task remains Waiting review until Artifact acceptance, acceptance evaluation and completion are explicit.'
        )
      }
    }

    case 'SET_ARTIFACT_TAB':
      return { ...state, artifact: { ...state.artifact, activeTab: command.tab }, notice: null }

    case 'APPLY_ARTIFACT':
      if (state.run.outcome !== 'SUCCEEDED') {
        return runCommandFailure(
          state,
          'Run evidence required',
          'Apply is available after a succeeded Run.'
        )
      }
      return {
        ...state,
        artifact: { ...state.artifact, applicationStatus: 'APPLIED' },
        notice: notice(
          'info',
          'Artifact applied',
          'The patch is applied to the mock workspace; it is not accepted yet.'
        )
      }

    case 'ACCEPT_ARTIFACT':
      if (state.run.outcome !== 'SUCCEEDED') {
        return runCommandFailure(
          state,
          'Run evidence required',
          'Accept is available after a succeeded Run.'
        )
      }
      if (state.artifact.reviewStatus === 'ACCEPTED') {
        return runCommandFailure(
          state,
          'Artifact already accepted',
          'This artifact has already been accepted.'
        )
      }
      return {
        ...state,
        route: 'task',
        artifact: {
          ...state.artifact,
          applicationStatus: 'APPLIED',
          reviewStatus: 'ACCEPTED'
        },
        notice: notice(
          'success',
          'Artifact accepted',
          'The patch is applied and human review is recorded. Task completion remains a separate explicit action.'
        )
      }

    case 'REJECT_ARTIFACT':
      return {
        ...state,
        artifact: { ...state.artifact, reviewStatus: 'REJECTED' },
        notice: notice(
          'danger',
          'Artifact rejected',
          'The Task remains open and the Baseline stays Draft.'
        )
      }

    case 'REQUEST_CHANGES':
      return {
        ...state,
        task: canTaskTransition(state.task.status, 'IN_PROGRESS')
          ? { ...state.task, status: 'IN_PROGRESS' }
          : state.task,
        artifact: { ...state.artifact, reviewStatus: 'CHANGES_REQUESTED' },
        notice: notice(
          'warning',
          'Changes requested',
          'The Run result remains evidence; a new attempt is required for review.'
        )
      }

    case 'COMPLETE_TASK':
      if (state.task.status !== 'WAITING_REVIEW') {
        return runCommandFailure(
          state,
          'Task is not awaiting review',
          'A succeeded Run must enter Waiting review first.'
        )
      }
      if (state.run.outcome !== 'SUCCEEDED') {
        return runCommandFailure(
          state,
          'Run evidence required',
          'A succeeded Run is required to complete the Task.'
        )
      }
      if (state.artifact.reviewStatus !== 'ACCEPTED') {
        return runCommandFailure(
          state,
          'Task completion blocked',
          'Accept the Artifact before completing the Task.'
        )
      }
      if (!canTaskTransition(state.task.status, 'COMPLETED')) {
        return runCommandFailure(
          state,
          'Task transition blocked',
          'The domain transition does not allow completion here.'
        )
      }
      return {
        ...state,
        task: {
          ...state.task,
          status: 'COMPLETED',
          acceptanceEvaluated: true,
          completionRunId: state.run.id,
          criteria: state.task.criteria.map((criterion) => ({ ...criterion, passed: true }))
        },
        route: 'baseline',
        notice: notice(
          'success',
          'Task completed',
          'Acceptance evaluated and the Task is completed. Baseline 1.1 remains Draft until its own activation confirmation.'
        )
      }

    case 'ACTIVATE_BASELINE':
      if (state.task.status !== 'COMPLETED') {
        return runCommandFailure(
          state,
          'Task completion required',
          'Complete the accepted Task before activating a Baseline.'
        )
      }
      if (
        state.baseline.status !== 'DRAFT' ||
        !canBaselineTransition(state.baseline.status, 'ACTIVE')
      ) {
        return runCommandFailure(
          state,
          'Baseline is not activatable',
          'Only a Draft Baseline can be activated once.'
        )
      }
      return {
        ...state,
        baseline: { ...state.baseline, status: 'ACTIVE' },
        notice: notice(
          'success',
          'Baseline activated',
          'Baseline 1.1 is now the active project anchor.'
        )
      }

    case 'CLEAR_NOTICE':
      return { ...state, notice: null }

    case 'RESET_FLOW':
      return createInitialCoreFlowState(state.locale)
  }
}
