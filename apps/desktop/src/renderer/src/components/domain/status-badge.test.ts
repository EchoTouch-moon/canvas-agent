import { describe, expect, it } from 'vitest'
import { toneForStatus } from './status-tone'

describe('toneForStatus', () => {
  it('uses one semantic mapping across task, run and snapshot states', () => {
    expect(toneForStatus('WAITING_REVIEW')).toBe('warning')
    expect(toneForStatus('FAILED')).toBe('danger')
    expect(toneForStatus('DIVERGED')).toBe('danger')
    expect(toneForStatus('SUCCEEDED')).toBe('success')
  })
})
