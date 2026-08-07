import type { TParams } from '@/lib/i18n'
import type { CoreFlowState, FlowRoute } from '@/data/core-flow-fixture'

export type StageKey =
  'context' | 'start' | 'run' | 'artifact' | 'evaluate' | 'complete' | 'baseline'

export interface FlowStage {
  readonly index: number
  readonly total: number
  readonly key: StageKey
  readonly label: string
  readonly next: string | null
  readonly route: FlowRoute | null
}

export type TFunc = (key: string, params?: TParams) => string

const RUNNING_STATUSES: readonly string[] = ['QUEUED', 'PREPARING', 'RUNNING']

export function getFlowStage(state: CoreFlowState, t: TFunc): FlowStage {
  const total = 7
  const runNext =
    state.run.status === 'QUEUED'
      ? 'nextRunQueued'
      : state.run.status === 'PREPARING'
        ? 'nextRunPreparing'
        : 'nextRunRunning'

  const candidates: ReadonlyArray<{
    key: StageKey
    when: boolean
    nextKey: string
    route: FlowRoute
  }> = [
    {
      key: 'context',
      when: state.snapshot.status !== 'FROZEN',
      nextKey: 'nextFreeze',
      route: 'context'
    },
    {
      key: 'start',
      when: state.snapshot.status === 'FROZEN' && state.run.status === 'CREATED',
      nextKey: 'nextStart',
      route: 'run'
    },
    {
      key: 'run',
      when: RUNNING_STATUSES.includes(state.run.status),
      nextKey: runNext,
      route: 'run'
    },
    {
      key: 'artifact',
      when: state.run.outcome === 'SUCCEEDED' && state.artifact.reviewStatus !== 'ACCEPTED',
      nextKey: 'nextArtifact',
      route: 'artifact'
    },
    {
      key: 'evaluate',
      when: state.artifact.reviewStatus === 'ACCEPTED' && !state.task.acceptanceEvaluated,
      nextKey: 'nextEvaluate',
      route: 'task'
    },
    {
      key: 'complete',
      when: state.task.acceptanceEvaluated && state.task.status !== 'COMPLETED',
      nextKey: 'nextComplete',
      route: 'task'
    },
    {
      key: 'baseline',
      when: state.task.status === 'COMPLETED' && state.baseline.status !== 'ACTIVE',
      nextKey: 'nextBaseline',
      route: 'baseline'
    }
  ]

  const current = candidates.findIndex((candidate) => candidate.when)
  if (current === -1) {
    return {
      index: total,
      total,
      key: 'baseline',
      label: t('progress.done'),
      next: null,
      route: null
    }
  }

  const candidate = candidates[current]
  return {
    index: current + 1,
    total,
    key: candidate.key,
    label: t(`progress.${candidate.key}`),
    next: t(`progress.${candidate.nextKey}`),
    route: candidate.route
  }
}
