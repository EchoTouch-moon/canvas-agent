import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionFactory,
  SessionShutdownEvent
} from '@earendil-works/pi-coding-agent'
import type { PiMessageView } from '../pi-message-mapper'
import {
  Lc1ProductionRepositoryMapper,
  type Lc1ProductionMappingResult,
  type Lc1RepositoryMappingRequest
} from './lc1-production-mapping'
import {
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RuntimeRepositoryAdmissionCandidate,
  type Lc1RuntimeRepositoryAdmissionResult,
  type Lc1RuntimeRepositoryAdmissionSink
} from './lc1-runtime-repository-admission'
import type { RunKillSwitch } from './kill-switch'

// The Pi adapter is a safety boundary, so structural compatibility alone is
// insufficient. Keep first-party composition identity private to this module;
// the symbol is deliberately not part of the experimental public surface.
const trustedCompositions = new WeakSet<object>()

export function isTrustedLc1RuntimeAdmissionComposition(
  value: unknown
): value is Lc1RuntimeAdmissionComposition {
  return typeof value === 'object' && value !== null && trustedCompositions.has(value)
}

/** Explicit opt-in state for the runtime-owned LC1 production composition. */
export type Lc1RuntimeAdmissionCompositionMode = 'DISABLED' | 'RUNTIME_OWNED'

export interface Lc1RuntimeAdmissionCompositionOptions {
  /** Defaults to `DISABLED`; no runtime-owned path is selected implicitly. */
  readonly mode?: Lc1RuntimeAdmissionCompositionMode
  /** Required when `mode` is `RUNTIME_OWNED`. */
  readonly host?: Lc1RuntimeRepositoryAdmissionHost
  /** Required when `mode` is `RUNTIME_OWNED`; one switch belongs to one Run. */
  readonly killSwitch?: RunKillSwitch
}

export interface Lc1RuntimeAdmissionComposition {
  readonly mode: Lc1RuntimeAdmissionCompositionMode
  readonly enabled: boolean
  /** The only repository-admission port exposed by the composition. */
  readonly repositoryAdmissionSink: Lc1RuntimeRepositoryAdmissionSink | null
  readonly killSwitch: RunKillSwitch | null
  /** Observe one Pi boundary and always return the original messages. */
  handleContext(messages: readonly PiMessageView[]): {
    readonly messages: readonly PiMessageView[]
  }
  /** Run the repository mapper through this composition's guarded sink. */
  mapRepositoryObservations(
    mapper: Lc1ProductionRepositoryMapper,
    request: Lc1RepositoryMappingRequest
  ): Promise<Lc1ProductionMappingResult>
  /** Register the guarded, observational-only composition with Pi. */
  createExtension(): ExtensionFactory
}

const KILL_SWITCHED_RESULT_DETAIL = 'runtime admission composition kill switch is tripped'

class Lc1RuntimeAdmissionCompositionImpl implements Lc1RuntimeAdmissionComposition {
  readonly mode: Lc1RuntimeAdmissionCompositionMode
  readonly enabled: boolean
  readonly repositoryAdmissionSink: Lc1RuntimeRepositoryAdmissionSink | null
  readonly killSwitch: RunKillSwitch | null
  readonly #host: Lc1RuntimeRepositoryAdmissionHost | null

  constructor(options: Lc1RuntimeAdmissionCompositionOptions) {
    const mode = options.mode ?? 'DISABLED'
    if (mode !== 'DISABLED' && mode !== 'RUNTIME_OWNED') {
      throw new Error('lc1_runtime_admission_mode_invalid')
    }
    this.mode = mode
    if (this.mode === 'DISABLED') {
      if (options.host !== undefined || options.killSwitch !== undefined) {
        throw new Error('lc1_runtime_admission_disabled_options_present')
      }
      this.enabled = false
      this.#host = null
      this.killSwitch = null
      this.repositoryAdmissionSink = null
      trustedCompositions.add(this)
      Object.freeze(this)
      return
    }

    if (options.host === undefined) {
      throw new Error('lc1_runtime_admission_host_required')
    }
    if (options.killSwitch === undefined) {
      throw new Error('lc1_runtime_admission_kill_switch_required')
    }
    this.enabled = true
    this.#host = options.host
    this.killSwitch = options.killSwitch
    this.repositoryAdmissionSink = Object.freeze(
      new KillSwitchAdmissionSink(options.host, options.killSwitch)
    )
    trustedCompositions.add(this)
    Object.freeze(this)
  }

  handleContext(messages: readonly PiMessageView[]): {
    readonly messages: readonly PiMessageView[]
  } {
    if (!this.enabled || this.killSwitch?.isTripped === true) return { messages }

    const snapshot = this.#host!.snapshotForTransaction()
    try {
      this.#host!.observeModelCall(messages)
    } catch {
      try {
        this.#host!.restoreTransaction(snapshot)
      } catch {
        // The switch remains the fail-closed control even if rollback itself
        // cannot be completed. Pi still receives the untouched messages.
      }
      this.killSwitch!.trip('LC1_RUNTIME_ADMISSION_OBSERVER_FAILURE')
    }
    return { messages }
  }

  async mapRepositoryObservations(
    mapper: Lc1ProductionRepositoryMapper,
    request: Lc1RepositoryMappingRequest
  ): Promise<Lc1ProductionMappingResult> {
    if (!this.enabled) throw new Error('lc1_runtime_admission_disabled')
    if (this.killSwitch!.isTripped) return killSwitchedMappingResult()

    try {
      const result = await mapper.observeAndQueue(request, this.repositoryAdmissionSink!)
      if (result.rejected.length > 0 || result.quarantined.length > 0) {
        this.killSwitch!.trip('LC1_RUNTIME_ADMISSION_MAPPING_GUARD_REJECTED')
      }
      return result
    } catch {
      this.killSwitch!.trip('LC1_RUNTIME_ADMISSION_MAPPING_FAILURE')
      return killSwitchedMappingResult()
    }
  }

  createExtension(): ExtensionFactory {
    return (pi: ExtensionAPI) => {
      pi.on('context', async (event: ContextEvent) => {
        const result = this.handleContext(event.messages as readonly PiMessageView[])
        return { messages: result.messages as ContextEvent['messages'] }
      })
    }
  }
}

function killSwitchedMappingResult(): Lc1ProductionMappingResult {
  return {
    accepted: [],
    rejected: [
      {
        callIds: [],
        reason: 'KILL_SWITCH_TRIPPED',
        detail: KILL_SWITCHED_RESULT_DETAIL
      }
    ],
    quarantined: [],
    authoritativeObservations: []
  }
}

class KillSwitchAdmissionSink implements Lc1RuntimeRepositoryAdmissionSink {
  readonly lc1RepositoryAdmissionMode = 'RUNTIME_OWNED' as const
  readonly #host: Lc1RuntimeRepositoryAdmissionHost
  readonly #killSwitch: RunKillSwitch

  constructor(host: Lc1RuntimeRepositoryAdmissionHost, killSwitch: RunKillSwitch) {
    this.#host = host
    this.#killSwitch = killSwitch
  }

  admitLc1RepositoryObservations(
    candidates: readonly Lc1RuntimeRepositoryAdmissionCandidate[]
  ): Lc1RuntimeRepositoryAdmissionResult {
    if (this.#killSwitch.isTripped) {
      return {
        accepted: [],
        rejected: candidates.map((candidate) => ({
          callIds: [...candidate.callIds],
          sourceKey: candidate.sourceKey,
          reason: 'KILL_SWITCH_TRIPPED' as const,
          detail: KILL_SWITCHED_RESULT_DETAIL
        })),
        quarantined: []
      }
    }

    let result: Lc1RuntimeRepositoryAdmissionResult
    try {
      result = this.#host.admitLc1RepositoryObservations(candidates)
    } catch {
      this.#killSwitch.trip('LC1_RUNTIME_ADMISSION_SINK_FAILURE')
      return {
        accepted: [],
        rejected: candidates.map((candidate) => ({
          callIds: [...candidate.callIds],
          sourceKey: candidate.sourceKey,
          reason: 'KILL_SWITCH_TRIPPED' as const,
          detail: KILL_SWITCHED_RESULT_DETAIL
        })),
        quarantined: []
      }
    }
    if (result.rejected.length > 0 || result.quarantined.length > 0) {
      this.#killSwitch.trip('LC1_RUNTIME_ADMISSION_GUARD_REJECTED')
    }
    return result
  }
}

/**
 * Construct the explicitly selected LC1 composition. The default is inert;
 * enabling the runtime-owned path requires both a host and a per-Run switch.
 */
export function createLc1RuntimeAdmissionComposition(
  options: Lc1RuntimeAdmissionCompositionOptions = {}
): Lc1RuntimeAdmissionComposition {
  return new Lc1RuntimeAdmissionCompositionImpl(options)
}

/** Convenience factory for callers that already hold a composition object. */
export function createLc1RuntimeAdmissionExtension(
  composition: Lc1RuntimeAdmissionComposition
): ExtensionFactory {
  if (
    !isTrustedLc1RuntimeAdmissionComposition(composition) ||
    !composition.enabled ||
    composition.mode !== 'RUNTIME_OWNED'
  ) {
    throw new Error('lc1_runtime_admission_extension_requires_first_party_runtime_owned')
  }
  const contextExtension = composition.createExtension()
  return (pi: ExtensionAPI) => {
    pi.on('session_shutdown', (event: SessionShutdownEvent) => {
      composition.killSwitch!.trip(`LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN:${event.reason}`)
    })
    contextExtension(pi)
  }
}
