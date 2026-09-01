import { describe, expect, it, vi } from 'vitest'
import {
  abortC0SessionWithinGrace,
  installC0OperatorKillSwitch,
  type C0OperatorSignal,
  type C0OperatorSignalSource
} from '../src/smoke/c0-kill-switch'

class FakeSignalSource implements C0OperatorSignalSource {
  private readonly listeners = new Map<C0OperatorSignal, Set<() => void>>()

  on(signal: C0OperatorSignal, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(signal, listeners)
  }

  off(signal: C0OperatorSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener)
  }

  emit(signal: C0OperatorSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) listener()
  }
}

describe('C0 operator kill-switch', () => {
  it('converts the first SIGINT into one terminal callback and supports cleanup', async () => {
    const source = new FakeSignalSource()
    const onKill = vi.fn()
    const killSwitch = installC0OperatorKillSwitch(onKill, source)

    source.emit('SIGINT')
    source.emit('SIGTERM')

    await expect(killSwitch.whenKilled).resolves.toBe('SIGINT')
    expect(killSwitch.killed).toBe(true)
    expect(killSwitch.signal).toBe('SIGINT')
    expect(onKill).toHaveBeenCalledOnce()
    expect(onKill).toHaveBeenCalledWith('SIGINT')

    killSwitch.dispose()
    source.emit('SIGTERM')
    expect(onKill).toHaveBeenCalledOnce()
  })

  it('returns a settled outcome when session abort completes', async () => {
    const abort = vi.fn(async () => undefined)

    await expect(abortC0SessionWithinGrace({ abort })).resolves.toEqual({
      status: 'SETTLED'
    })
    expect(abort).toHaveBeenCalledOnce()
  })

  it('records rejected and timed-out aborts without throwing', async () => {
    await expect(
      abortC0SessionWithinGrace({
        abort: async () => {
          throw new Error('abort failed')
        }
      })
    ).resolves.toEqual({ status: 'REJECTED', errorMessage: 'abort failed' })

    await expect(
      abortC0SessionWithinGrace({ abort: () => new Promise<void>(() => undefined) }, 1)
    ).resolves.toEqual({
      status: 'TIMED_OUT',
      errorMessage: 'C0 operator abort exceeded 1ms'
    })
  })
})
