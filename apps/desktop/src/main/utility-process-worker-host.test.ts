import { describe, expect, it } from 'vitest'
import type { ExecutionRequestContract } from '@canvas-agent/contracts'
import { HostUnavailableError } from './command-errors'
import { UtilityProcessWorkerHost, type UtilityProcessLike } from './utility-process-worker-host'

function request(id: string): ExecutionRequestContract {
  return { executionRequestId: id } as ExecutionRequestContract
}

class FakeChild implements UtilityProcessLike {
  readonly posted: unknown[] = []
  killed = false
  private readonly messageHandlers: Array<(message: unknown) => void> = []
  private readonly exitHandlers: Array<(code: number) => void> = []

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  on(
    event: 'message' | 'exit',
    listener: ((message: unknown) => void) | ((code: number) => void)
  ): this {
    if (event === 'message') {
      this.messageHandlers.push(listener as (message: unknown) => void)
    } else {
      this.exitHandlers.push(listener as (code: number) => void)
    }
    return this
  }

  kill(): void {
    this.killed = true
  }

  emitMessage(message: unknown): void {
    for (const handler of this.messageHandlers) handler(message)
  }

  emitExit(code: number): void {
    for (const handler of this.exitHandlers) handler(code)
  }
}

const CONFIG = { sourceRepositoryPath: '/repo', runtimeDirectory: '/runtime' }

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function postedType(child: FakeChild, type: string): unknown | undefined {
  return (child.posted as Array<{ type: string }>).find((frame) => frame.type === type)
}

describe('UtilityProcessWorkerHost', () => {
  it('lazily forks once and completes the init handshake before dispatch', async () => {
    const child = new FakeChild()
    let forks = 0
    const host = new UtilityProcessWorkerHost(CONFIG, () => {
      forks += 1
      return child
    })

    const dispatchA = host.dispatch(request('exec-a'))
    const dispatchB = host.dispatch(request('exec-b'))
    expect(forks).toBe(1)

    child.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()

    const frames = (
      child.posted as Array<{ type: string; messageId: string; executionRequestId: string }>
    ).filter((frame) => frame.type === 'dispatch')
    expect(frames).toHaveLength(2)

    child.emitMessage({
      protocolVersion: 1,
      type: 'dispatch:result',
      messageId: frames[0].messageId,
      executionRequestId: frames[0].executionRequestId,
      result: { outcome: 'SUCCEEDED', claimGranted: true }
    })
    child.emitMessage({
      protocolVersion: 1,
      type: 'dispatch:result',
      messageId: frames[1].messageId,
      executionRequestId: frames[1].executionRequestId,
      result: { outcome: 'SUCCEEDED', claimGranted: true }
    })

    const resultA = await dispatchA
    const resultB = await dispatchB
    expect(resultA.outcome).toBe('SUCCEEDED')
    expect(resultB.outcome).toBe('SUCCEEDED')
    expect(forks).toBe(1)
  })

  it('correlates a concurrent dispatch + cancel on the same execution', async () => {
    const child = new FakeChild()
    const host = new UtilityProcessWorkerHost(CONFIG, () => child, { initTimeoutMs: 1000 })

    const executionRequestId = 'exec-1'
    const dispatch = host.dispatch(request(executionRequestId))
    const cancel = host.cancel(executionRequestId)
    child.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()

    const cancelFrame = postedType(child, 'cancel') as { messageId: string }
    child.emitMessage({
      protocolVersion: 1,
      type: 'cancel:result',
      messageId: cancelFrame.messageId,
      executionRequestId,
      cancelled: true
    })
    await expect(cancel).resolves.toBe(true)

    const dispatchFrame = postedType(child, 'dispatch') as { messageId: string }
    child.emitMessage({
      protocolVersion: 1,
      type: 'dispatch:result',
      messageId: dispatchFrame.messageId,
      executionRequestId,
      result: { outcome: 'CANCELLED', claimGranted: true }
    })
    await expect(dispatch).resolves.toMatchObject({ outcome: 'CANCELLED' })
  })

  it('rejects pending requests on child exit and restarts for the next dispatch', async () => {
    const first = new FakeChild()
    let forks = 0
    const host = new UtilityProcessWorkerHost(
      CONFIG,
      () => {
        forks += 1
        return forks === 1 ? first : second
      },
      { initTimeoutMs: 1000 }
    )
    const second = new FakeChild()

    const pending = host.dispatch(request('exec-1'))
    first.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()
    first.emitExit(1)
    await expect(pending).rejects.toThrow(HostUnavailableError)

    const next = host.dispatch(request('exec-2'))
    expect(forks).toBe(2)
    second.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()
    const frame = postedType(second, 'dispatch') as { messageId: string }
    second.emitMessage({
      protocolVersion: 1,
      type: 'dispatch:result',
      messageId: frame.messageId,
      executionRequestId: 'exec-2',
      result: { outcome: 'SUCCEEDED', claimGranted: true }
    })
    await expect(next).resolves.toMatchObject({ outcome: 'SUCCEEDED' })
  })

  it('never auto-replays an already submitted executionRequestId', async () => {
    const child = new FakeChild()
    const host = new UtilityProcessWorkerHost(CONFIG, () => child, { initTimeoutMs: 1000 })

    const first = host.dispatch(request('exec-1'))
    child.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()
    await expect(host.dispatch(request('exec-1'))).rejects.toThrow(HostUnavailableError)

    const frame = postedType(child, 'dispatch') as { messageId: string }
    child.emitMessage({
      protocolVersion: 1,
      type: 'dispatch:result',
      messageId: frame.messageId,
      executionRequestId: 'exec-1',
      result: { outcome: 'SUCCEEDED', claimGranted: true }
    })
    await expect(first).resolves.toMatchObject({ outcome: 'SUCCEEDED' })
  })

  it('dispose waits for ack then kills, or times out', async () => {
    const child = new FakeChild()
    const host = new UtilityProcessWorkerHost(CONFIG, () => child, { disposeTimeoutMs: 50 })
    void host.dispatch(request('exec-1'))
    child.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()

    const dispose = host.dispose()
    child.emitMessage({ protocolVersion: 1, type: 'dispose:ack' })
    await dispose
    expect(child.killed).toBe(true)

    const child2 = new FakeChild()
    const host2 = new UtilityProcessWorkerHost(CONFIG, () => child2, {
      disposeTimeoutMs: 50,
      initTimeoutMs: 1000
    })
    void host2.dispatch(request('exec-2'))
    child2.emitMessage({ protocolVersion: 1, type: 'init:ack' })
    await flush()
    await host2.dispose()
    expect(child2.killed).toBe(true)
  })
})
