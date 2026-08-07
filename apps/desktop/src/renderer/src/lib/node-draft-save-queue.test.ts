import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConcurrencyError } from './workspace-client'
import { NodeDraftSaveQueue, type NodeDraftSaveRequest } from './node-draft-save-queue'
import type { NodeDraftRecord } from './workspace-types'

function saved(request: NodeDraftSaveRequest, revision: number): NodeDraftRecord {
  return {
    id: `draft-${request.nodeId}`,
    nodeId: request.nodeId,
    title: request.title,
    body: request.body,
    revision,
    updatedAt: new Date().toISOString()
  }
}

describe('NodeDraftSaveQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces edits and allows only one request in flight per node', async () => {
    vi.useFakeTimers()
    let resolveFirst: ((value: NodeDraftRecord) => void) | undefined
    const save = vi.fn<(request: NodeDraftSaveRequest) => Promise<NodeDraftRecord>>(
      () =>
        new Promise<NodeDraftRecord>((resolve) => {
          resolveFirst = resolve
        })
    )
    const queue = new NodeDraftSaveQueue({ save, debounceMs: 25 })

    queue.schedule({ nodeId: 'node-1', title: 'A', body: 'A', expectedRevision: 5 })
    await vi.advanceTimersByTimeAsync(24)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)

    queue.schedule({ nodeId: 'node-1', title: 'B', body: 'B', expectedRevision: 5 })
    queue.schedule({ nodeId: 'node-1', title: 'C', body: 'C', expectedRevision: 5 })
    expect(save).toHaveBeenCalledTimes(1)

    resolveFirst?.(saved({ nodeId: 'node-1', title: 'A', body: 'A', expectedRevision: 5 }, 6))
    await vi.runOnlyPendingTimersAsync()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      title: 'C',
      body: 'C',
      expectedRevision: 6
    })
    queue.dispose()
  })

  it('feeds the returned revision into the coalesced save', async () => {
    vi.useFakeTimers()
    const requests: NodeDraftSaveRequest[] = []
    const save = vi.fn(async (request: NodeDraftSaveRequest) => {
      requests.push(request)
      return saved(request, (request.expectedRevision ?? 0) + 1)
    })
    const queue = new NodeDraftSaveQueue({ save, debounceMs: 1 })

    queue.schedule({ nodeId: 'node-1', title: 'A', body: 'A', expectedRevision: 5 })
    await vi.runOnlyPendingTimersAsync()
    queue.schedule({ nodeId: 'node-1', title: 'B', body: 'B', expectedRevision: 5 })
    await vi.runOnlyPendingTimersAsync()

    expect(requests.map((request) => request.expectedRevision)).toEqual([5, 6])
    queue.dispose()
  })

  it('preserves the buffer and exposes server value on external concurrency error', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {
      throw new ConcurrencyError('NodeDraft changed', {
        serverRevision: 7,
        serverValue: { title: 'Server title', body: 'Server body' }
      })
    })
    let latestState
    const queue = new NodeDraftSaveQueue({
      save,
      debounceMs: 1,
      onStateChange: (_nodeId, state) => {
        latestState = state
      }
    })

    queue.schedule({
      nodeId: 'node-1',
      title: 'User title',
      body: 'User body',
      expectedRevision: 5
    })
    await vi.runOnlyPendingTimersAsync()

    expect(latestState?.conflict).toEqual({
      serverRevision: 7,
      serverValue: { title: 'Server title', body: 'Server body' }
    })
    expect(latestState?.dirty).toBe(false)
    queue.dispose()
  })

  it('uses the returned server revision only after a new explicit edit', async () => {
    vi.useFakeTimers()
    let firstRequest = true
    const save = vi.fn(async (request: NodeDraftSaveRequest) => {
      if (firstRequest) {
        firstRequest = false
        throw new ConcurrencyError('NodeDraft changed', {
          serverRevision: 7,
          serverValue: { title: 'Server title', body: 'Server body' }
        })
      }
      return saved(request, 8)
    })
    const queue = new NodeDraftSaveQueue({ save, debounceMs: 1 })

    queue.schedule({
      nodeId: 'node-1',
      title: 'User title',
      body: 'User body',
      expectedRevision: 5
    })
    await vi.runOnlyPendingTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)

    queue.schedule({
      nodeId: 'node-1',
      title: 'Resolved title',
      body: 'Resolved body',
      expectedRevision: 5
    })
    await vi.runOnlyPendingTimersAsync()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      title: 'Resolved title',
      expectedRevision: 7
    })
    queue.dispose()
  })
})
