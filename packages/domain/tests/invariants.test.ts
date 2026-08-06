import { describe, expect, it } from 'vitest'
import {
  DomainInvariantError,
  assertApprovalTransition,
  assertBaselineTransition,
  assertRunState,
  assertRunTransition,
  assertTaskTransition
} from '../src'

describe('domain state invariants', () => {
  it('allows the canonical task completion path', () => {
    expect(() => assertTaskTransition('DRAFT', 'READY')).not.toThrow()
    expect(() => assertTaskTransition('READY', 'IN_PROGRESS')).not.toThrow()
    expect(() => assertTaskTransition('IN_PROGRESS', 'WAITING_REVIEW')).not.toThrow()
    expect(() => assertTaskTransition('WAITING_REVIEW', 'COMPLETED')).not.toThrow()
  })

  it('does not equate a successful run with task completion', () => {
    expect(() => assertTaskTransition('IN_PROGRESS', 'COMPLETED')).toThrow(DomainInvariantError)
  })

  it('requires an outcome exactly when a run is finished', () => {
    expect(() => assertRunState({ status: 'RUNNING', outcome: null })).not.toThrow()
    expect(() => assertRunState({ status: 'FINISHED', outcome: 'SUCCEEDED' })).not.toThrow()
    expect(() => assertRunState({ status: 'RUNNING', outcome: 'SUCCEEDED' })).toThrow(
      DomainInvariantError
    )
    expect(() => assertRunState({ status: 'FINISHED', outcome: null })).toThrow(
      DomainInvariantError
    )
  })

  it('keeps finished runs and active baselines immutable', () => {
    expect(() => assertRunTransition('FINISHED', 'RUNNING')).toThrow(DomainInvariantError)
    expect(() => assertBaselineTransition('ACTIVE', 'DRAFT')).toThrow(DomainInvariantError)
  })

  it('allows an approval to be consumed only after approval', () => {
    expect(() => assertApprovalTransition('APPROVED', 'CONSUMED')).not.toThrow()
    expect(() => assertApprovalTransition('PENDING', 'CONSUMED')).toThrow(DomainInvariantError)
  })
})
