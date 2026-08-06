import type { ApprovalStatus, BaselineStatus, RunState, RunStatus, TaskStatus } from './model'

export class DomainInvariantError extends Error {
  override readonly name = 'DomainInvariantError'
}

const taskTransitions = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_REVIEW', 'CANCELLED'],
  WAITING_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: []
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>

const baselineTransitions = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['SUPERSEDED'],
  SUPERSEDED: []
} as const satisfies Record<BaselineStatus, readonly BaselineStatus[]>

const approvalTransitions = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['CONSUMED', 'EXPIRED', 'CANCELLED'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  CONSUMED: []
} as const satisfies Record<ApprovalStatus, readonly ApprovalStatus[]>

const runTransitions = {
  CREATED: ['QUEUED', 'FINISHED'],
  QUEUED: ['PREPARING', 'INTERRUPTED', 'FINISHED'],
  PREPARING: ['RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'INTERRUPTED', 'FINISHED'],
  RUNNING: ['WAITING_INPUT', 'WAITING_APPROVAL', 'PAUSED', 'INTERRUPTED', 'FINISHED'],
  WAITING_INPUT: ['RUNNING', 'INTERRUPTED', 'FINISHED'],
  WAITING_APPROVAL: ['RUNNING', 'INTERRUPTED', 'FINISHED'],
  PAUSED: ['RUNNING', 'INTERRUPTED', 'FINISHED'],
  INTERRUPTED: ['PREPARING', 'FINISHED'],
  FINISHED: []
} as const satisfies Record<RunStatus, readonly RunStatus[]>

function assertTransition<State extends string>(
  entity: string,
  transitions: Record<State, readonly State[]>,
  from: State,
  to: State
): void {
  if (!transitions[from].includes(to)) {
    throw new DomainInvariantError(`Illegal ${entity} transition: ${from} -> ${to}`)
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  assertTransition('Task', taskTransitions, from, to)
}

export function assertBaselineTransition(from: BaselineStatus, to: BaselineStatus): void {
  assertTransition('ProjectBaseline', baselineTransitions, from, to)
}

export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  assertTransition('Approval', approvalTransitions, from, to)
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  assertTransition('Run', runTransitions, from, to)
}

export function assertRunState(state: RunState): void {
  const hasOutcome = state.outcome !== null
  if (state.status === 'FINISHED' && !hasOutcome) {
    throw new DomainInvariantError('A FINISHED Run must have an outcome')
  }
  if (state.status !== 'FINISHED' && hasOutcome) {
    throw new DomainInvariantError('Only a FINISHED Run may have an outcome')
  }
}
