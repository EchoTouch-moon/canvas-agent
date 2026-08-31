import { describe, expect, it } from 'vitest'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { PiMessageView } from '../src'
import {
  createLc1RuntimeAdmissionComposition,
  createRunKillSwitch,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RuntimeRepositoryAdmissionCandidate
} from '../src/experimental'

const FIXED_NOW = '2026-08-31T00:00:00.000Z'

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function register(factory: ExtensionFactory): (
  messages: readonly PiMessageView[]
) => Promise<{ messages: readonly PiMessageView[] }> {
  let handler:
    | ((event: ContextEvent) => Promise<{ messages: ContextEvent['messages'] } | undefined>)
    | undefined
  const pi = {
    on: (event: 'context', registered: typeof handler extends undefined ? never : NonNullable<typeof handler>) => {
      if (event === 'context') handler = registered
    }
  } as unknown as ExtensionAPI
  factory(pi)
  if (handler === undefined) throw new Error('factory registered no context handler')
  return async (messages) => {
    const result = await handler!({ type: 'context', messages: messages as ContextEvent['messages'] })
    if (result === undefined) throw new Error('context handler returned no result')
    return { messages: result.messages as readonly PiMessageView[] }
  }
}

function host(runtimeSessionId: string): Lc1RuntimeRepositoryAdmissionHost {
  return new Lc1RuntimeRepositoryAdmissionHost({
    observer: { runtimeSessionId, now: () => FIXED_NOW }
  })
}

function malformedCandidate(): Lc1RuntimeRepositoryAdmissionCandidate {
  return {
    callIds: ['malformed'],
    sourceKey: 'repository/file://src/malformed.ts'
  } as unknown as Lc1RuntimeRepositoryAdmissionCandidate
}

describe('LC1 runtime-owned admission composition', () => {
  it('is disabled by default and returns the exact native message list', () => {
    const messages = [userMessage('disabled')]
    const composition = createLc1RuntimeAdmissionComposition()

    expect(composition.mode).toBe('DISABLED')
    expect(composition.enabled).toBe(false)
    expect(composition.repositoryAdmissionSink).toBeNull()
    expect(composition.handleContext(messages).messages).toBe(messages)
  })

  it('rejects partial or contradictory composition configuration', () => {
    const runtimeHost = host('composition-config-host')
    const killSwitch = createRunKillSwitch('composition-config-run', { now: () => FIXED_NOW })

    expect(() =>
      createLc1RuntimeAdmissionComposition({ mode: 'RUNTIME_OWNED' })
    ).toThrow('lc1_runtime_admission_host_required')
    expect(() =>
      createLc1RuntimeAdmissionComposition({ mode: 'RUNTIME_OWNED', host: runtimeHost })
    ).toThrow('lc1_runtime_admission_kill_switch_required')
    expect(() =>
      createLc1RuntimeAdmissionComposition({ host: runtimeHost, killSwitch })
    ).toThrow('lc1_runtime_admission_disabled_options_present')
    expect(() =>
      createLc1RuntimeAdmissionComposition({ mode: 'UNKNOWN' as 'DISABLED' })
    ).toThrow('lc1_runtime_admission_mode_invalid')
  })

  it('selects the runtime-owned host only with explicit opt-in and preserves messages', async () => {
    const runtimeHost = host('composition-enabled-host')
    const killSwitch = createRunKillSwitch('composition-enabled-run', { now: () => FIXED_NOW })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host: runtimeHost,
      killSwitch
    })
    const messages = [userMessage('enabled')]

    expect(composition.enabled).toBe(true)
    expect(composition.repositoryAdmissionSink?.lc1RepositoryAdmissionMode).toBe('RUNTIME_OWNED')
    expect('queueExternalObservations' in composition.repositoryAdmissionSink!).toBe(false)
    expect('admitLc1RepositoryObservations' in composition.repositoryAdmissionSink!).toBe(true)
    expect(composition.handleContext(messages).messages).toBe(messages)
    expect(runtimeHost.callCount).toBe(1)

    const dispatch = register(composition.createExtension())
    const extensionResult = await dispatch(messages)
    expect(extensionResult.messages).toBe(messages)
    expect(runtimeHost.callCount).toBe(2)
  })

  it('permanently bypasses observation and admission after an operator trip', () => {
    const runtimeHost = host('composition-pretrip-host')
    const killSwitch = createRunKillSwitch('composition-pretrip-run', { now: () => FIXED_NOW })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host: runtimeHost,
      killSwitch
    })
    const messages = [userMessage('pretrip')]
    killSwitch.trip('operator stop')

    expect(composition.handleContext(messages).messages).toBe(messages)
    expect(runtimeHost.callCount).toBe(0)
    const result = composition.repositoryAdmissionSink!.admitLc1RepositoryObservations([
      malformedCandidate()
    ])
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'KILL_SWITCH_TRIPPED' })
    ])
  })

  it('trips and rolls back on an observer exception, then keeps returning native messages', () => {
    const runtimeHost = new Lc1RuntimeRepositoryAdmissionHost({
      observer: {
        runtimeSessionId: 'composition-observer-failure',
        now: () => {
          throw new Error('injected clock failure')
        }
      }
    })
    const killSwitch = createRunKillSwitch('composition-observer-failure-run', {
      now: () => FIXED_NOW
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host: runtimeHost,
      killSwitch
    })
    const messages = [userMessage('observer failure')]

    expect(composition.handleContext(messages).messages).toBe(messages)
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_OBSERVER_FAILURE',
      trippedAt: FIXED_NOW
    })
    expect(runtimeHost.callCount).toBe(0)
    expect(runtimeHost.universeRevision).toBeNull()

    const next = [userMessage('after failure')]
    expect(composition.handleContext(next).messages).toBe(next)
    expect(runtimeHost.callCount).toBe(0)
  })

  it('trips the same switch when the admission guard rejects a candidate', () => {
    const runtimeHost = host('composition-admission-failure')
    const killSwitch = createRunKillSwitch('composition-admission-failure-run', {
      now: () => FIXED_NOW
    })
    const composition = createLc1RuntimeAdmissionComposition({
      mode: 'RUNTIME_OWNED',
      host: runtimeHost,
      killSwitch
    })

    const first = composition.repositoryAdmissionSink!.admitLc1RepositoryObservations([
      malformedCandidate()
    ])
    expect(first.rejected).toEqual([expect.objectContaining({ reason: 'INVALID_REQUEST' })])
    expect(killSwitch.tripRecord).toEqual({
      reason: 'LC1_RUNTIME_ADMISSION_GUARD_REJECTED',
      trippedAt: FIXED_NOW
    })

    const second = composition.repositoryAdmissionSink!.admitLc1RepositoryObservations([
      malformedCandidate()
    ])
    expect(second.rejected).toEqual([
      expect.objectContaining({ reason: 'KILL_SWITCH_TRIPPED' })
    ])
  })
})
