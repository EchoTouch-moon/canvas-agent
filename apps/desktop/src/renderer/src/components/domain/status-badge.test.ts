import { describe, expect, it } from 'vitest'
import { CheckCircle2, PlayCircle, XCircle } from 'lucide-react'
import { iconForStatus, readableStatus, toneForStatus } from './status-tone'

describe('toneForStatus', () => {
  it('uses one semantic mapping across task, run and snapshot states', () => {
    expect(toneForStatus('WAITING_REVIEW')).toBe('warning')
    expect(toneForStatus('FAILED')).toBe('danger')
    expect(toneForStatus('DIVERGED')).toBe('danger')
    expect(toneForStatus('SUCCEEDED')).toBe('success')
    expect(toneForStatus('FROZEN')).toBe('accent')
  })

  it('keeps status meaning visible beyond color', () => {
    expect(readableStatus('WAITING_APPROVAL')).toBe('waiting approval')
    expect(iconForStatus('RUNNING')).toBe(PlayCircle)
    expect(iconForStatus('SUCCEEDED')).toBe(CheckCircle2)
    expect(iconForStatus('FAILED')).toBe(XCircle)
  })
})
