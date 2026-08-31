import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionFactory,
  SessionShutdownEvent
} from '@earendil-works/pi-coding-agent'
import type { PiMessageView } from '../pi-message-mapper'
import {
  Lc1ProductionRepositoryMapper,
  type Lc1RepositoryMappingRequest,
  type Lc1RepositoryRevision
} from './lc1-production-mapping'
import type { Lc1RuntimeAdmissionComposition as Lc1RuntimeAdmissionCompositionContract } from './lc1-runtime-admission-composition'

export interface Lc1RuntimeAdmissionPiExtensionOptions {
  /** Must be the explicitly enabled runtime-owned composition. */
  readonly composition: Lc1RuntimeAdmissionCompositionContract
  /** Mapper instances are replaceable; runtime ownership remains in composition. */
  readonly mapper: Lc1ProductionRepositoryMapper
  readonly runtimeSessionId: string
  readonly repositoryId: string
  readonly namespace: string
  readonly authorityStreamId: string
  /** Reads the caller-bound repository revision for each Pi context event. */
  readonly getExpectedRevision: () => Lc1RepositoryRevision | Promise<Lc1RepositoryRevision>
  readonly observedAt?: () => string
}

const PI_EXTENSION_STOP_REASONS = {
  invalidConfiguration: 'LC1_RUNTIME_ADMISSION_PI_EXTENSION_CONFIGURATION_INVALID',
  revisionFailure: 'LC1_RUNTIME_ADMISSION_REVISION_READ_FAILURE',
  timestampFailure: 'LC1_RUNTIME_ADMISSION_TIMESTAMP_FAILURE',
  mappingRejected: 'LC1_RUNTIME_ADMISSION_MAPPING_GUARD_REJECTED',
  compositionFailure: 'LC1_RUNTIME_ADMISSION_PI_COMPOSITION_FAILURE',
  sessionShutdown: 'LC1_RUNTIME_ADMISSION_PI_SESSION_SHUTDOWN'
} as const

function requireNonEmpty(value: string, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code)
  return value
}

function validateOptions(options: Lc1RuntimeAdmissionPiExtensionOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw new Error(PI_EXTENSION_STOP_REASONS.invalidConfiguration)
  }
  const composition = options.composition
  if (
    typeof composition !== 'object' ||
    composition === null ||
    !composition.enabled ||
    composition.mode !== 'RUNTIME_OWNED' ||
    typeof composition.mapRepositoryObservations !== 'function' ||
    typeof composition.handleContext !== 'function'
  ) {
    throw new Error('lc1_runtime_admission_pi_extension_requires_runtime_owned')
  }
  if (
    typeof options.mapper !== 'object' ||
    options.mapper === null ||
    typeof options.mapper.observeAndQueue !== 'function'
  ) {
    throw new Error(PI_EXTENSION_STOP_REASONS.invalidConfiguration)
  }
  requireNonEmpty(options.runtimeSessionId, 'lc1_runtime_admission_pi_session_required')
  requireNonEmpty(options.repositoryId, 'lc1_runtime_admission_pi_repository_id_required')
  requireNonEmpty(options.namespace, 'lc1_runtime_admission_pi_namespace_required')
  requireNonEmpty(options.authorityStreamId, 'lc1_runtime_admission_pi_stream_required')
  if (typeof options.getExpectedRevision !== 'function') {
    throw new Error('lc1_runtime_admission_pi_revision_supplier_required')
  }
  if (typeof options.observedAt !== 'undefined' && typeof options.observedAt !== 'function') {
    throw new Error(PI_EXTENSION_STOP_REASONS.invalidConfiguration)
  }
  const killSwitch = composition.killSwitch
  if (
    typeof killSwitch !== 'object' ||
    killSwitch === null ||
    typeof killSwitch.trip !== 'function' ||
    typeof killSwitch.isTripped !== 'boolean'
  ) {
    throw new Error(PI_EXTENSION_STOP_REASONS.invalidConfiguration)
  }
}

/**
 * Compose one explicit runtime-owned LC1 boundary into Pi's context hook.
 * Mapping runs before observation so verified repository authority is queued
 * for the same boundary; any failure returns Pi's original messages and trips
 * the per-Run switch. The extension never rewrites messages or calls a model.
 */
export function createLc1RuntimeAdmissionPiExtension(
  options: Lc1RuntimeAdmissionPiExtensionOptions
): ExtensionFactory {
  validateOptions(options)
  let nextModelCallSequence = 1
  const observedAt = options.observedAt ?? (() => new Date().toISOString())
  const killSwitch = options.composition.killSwitch!

  return (pi: ExtensionAPI) => {
    pi.on('session_shutdown', (event: SessionShutdownEvent) => {
      killSwitch.trip(`${PI_EXTENSION_STOP_REASONS.sessionShutdown}:${event.reason}`)
    })
    pi.on('context', async (event: ContextEvent) => {
      const messages = event.messages as readonly PiMessageView[]
      if (killSwitch.isTripped) {
        return { messages: event.messages }
      }

      const modelCallSequence = nextModelCallSequence++
      let expectedRevision: Lc1RepositoryRevision
      try {
        expectedRevision = await options.getExpectedRevision()
      } catch {
        killSwitch.trip(PI_EXTENSION_STOP_REASONS.revisionFailure)
        return { messages: event.messages }
      }

      let timestamp: string
      try {
        timestamp = observedAt()
      } catch {
        killSwitch.trip(PI_EXTENSION_STOP_REASONS.timestampFailure)
        return { messages: event.messages }
      }
      if (typeof timestamp !== 'string' || timestamp.trim().length === 0) {
        killSwitch.trip(PI_EXTENSION_STOP_REASONS.timestampFailure)
        return { messages: event.messages }
      }

      const request: Lc1RepositoryMappingRequest = {
        messages,
        runtimeSessionId: options.runtimeSessionId,
        modelCallSequence,
        repositoryId: options.repositoryId,
        namespace: options.namespace,
        expectedRevision,
        authorityOrder: {
          streamId: options.authorityStreamId,
          sequence: modelCallSequence
        },
        observedAt: timestamp
      }
      try {
        const mapped = await options.composition.mapRepositoryObservations(options.mapper, request)
        if (mapped.rejected.length > 0 || mapped.quarantined.length > 0) {
          killSwitch.trip(PI_EXTENSION_STOP_REASONS.mappingRejected)
          return { messages: event.messages }
        }
        const result = options.composition.handleContext(messages)
        return { messages: result.messages as ContextEvent['messages'] }
      } catch {
        killSwitch.trip(PI_EXTENSION_STOP_REASONS.compositionFailure)
        return { messages: event.messages }
      }
    })
  }
}
