import { createContextSourceVersion, createSourceVersionId } from './source-types'
import type {
  ContextSourceState,
  ContextSourceVersion,
  SourceObservation,
  SourceReconciliationEvent
} from './source-types'

export interface ReconcileResult {
  readonly state: ContextSourceState
  readonly event: SourceReconciliationEvent
  // Admitted version when this observation produced/admitted one.
  readonly admittedVersion: ContextSourceVersion | null
}

// Deterministic PROPOSAL-030 reconciliation for one source observation.
//
//   AVAILABLE first            -> INITIALIZE
//   AVAILABLE same hash        -> NO_CHANGE
//   AVAILABLE changed          -> UPDATE
//   ABSENT (confirmed)         -> REMOVE
//   UNAVAILABLE                -> RETAIN_LAST_KNOWN
//
// UNAVAILABLE never becomes ABSENT and never clears the last available version.
export function reconcileSource(
  previous: ContextSourceState | null,
  observation: SourceObservation,
  sequence: number
): ReconcileResult {
  const timestamp = observation.observedAt

  if (previous === null) {
    if (observation.status === 'AVAILABLE' && observation.contentHash !== undefined) {
      const version = createContextSourceVersion(
        observation.sourceKey,
        observation.contentHash,
        timestamp
      )
      const state: ContextSourceState = {
        sourceKey: observation.sourceKey,
        observationStatus: 'AVAILABLE',
        admittedVersionId: version.versionId,
        lastAvailableVersionId: version.versionId,
        reconciliationSequence: sequence,
        lastObservedAt: timestamp
      }
      return {
        state,
        event: {
          sourceKey: observation.sourceKey,
          previousState: null,
          observation,
          action: 'INITIALIZE',
          previousVersionId: null,
          nextVersionId: version.versionId,
          sequence,
          timestamp
        },
        admittedVersion: version
      }
    }
    // First observation not AVAILABLE: no admitted version yet.
    const state: ContextSourceState = {
      sourceKey: observation.sourceKey,
      observationStatus: observation.status,
      admittedVersionId: null,
      lastAvailableVersionId: null,
      reconciliationSequence: sequence,
      lastObservedAt: timestamp
    }
    return {
      state,
      event: {
        sourceKey: observation.sourceKey,
        previousState: null,
        observation,
        action: 'INITIALIZE',
        previousVersionId: null,
        nextVersionId: null,
        sequence,
        timestamp
      },
      admittedVersion: null
    }
  }

  // Confirmed ABSENT.
  if (observation.status === 'ABSENT') {
    const state: ContextSourceState = {
      ...previous,
      observationStatus: 'ABSENT',
      admittedVersionId: null,
      reconciliationSequence: sequence,
      lastObservedAt: timestamp
    }
    return {
      state,
      event: {
        sourceKey: observation.sourceKey,
        previousState: previous,
        observation,
        action: 'REMOVE',
        previousVersionId: previous.admittedVersionId,
        nextVersionId: null,
        sequence,
        timestamp
      },
      admittedVersion: null
    }
  }

  // UNAVAILABLE: retain last known admitted state.
  if (observation.status === 'UNAVAILABLE') {
    const state: ContextSourceState = {
      ...previous,
      observationStatus: 'UNAVAILABLE',
      reconciliationSequence: sequence,
      lastObservedAt: timestamp
    }
    return {
      state,
      event: {
        sourceKey: observation.sourceKey,
        previousState: previous,
        observation,
        action: 'RETAIN_LAST_KNOWN',
        previousVersionId: previous.admittedVersionId,
        nextVersionId: previous.admittedVersionId,
        sequence,
        timestamp
      },
      admittedVersion: null
    }
  }

  // AVAILABLE with a content hash.
  const contentHash = observation.contentHash
  if (contentHash === undefined) {
    // AVAILABLE without content is a malformed observation; treat as NO_CHANGE
    // to stay deterministic rather than inventing a version.
    const state: ContextSourceState = {
      ...previous,
      observationStatus: 'AVAILABLE',
      reconciliationSequence: sequence,
      lastObservedAt: timestamp
    }
    return {
      state,
      event: {
        sourceKey: observation.sourceKey,
        previousState: previous,
        observation,
        action: 'NO_CHANGE',
        previousVersionId: previous.admittedVersionId,
        nextVersionId: previous.admittedVersionId,
        sequence,
        timestamp
      },
      admittedVersion: null
    }
  }

  // AVAILABLE with a content hash. Compare against the admitted version id:
  // same hash means the source content is unchanged, so do not create a new
  // version.
  const candidateVersionId = createSourceVersionId(observation.sourceKey, contentHash)
  if (previous.admittedVersionId === candidateVersionId) {
    const state: ContextSourceState = {
      ...previous,
      observationStatus: 'AVAILABLE',
      reconciliationSequence: sequence,
      lastObservedAt: timestamp
    }
    return {
      state,
      event: {
        sourceKey: observation.sourceKey,
        previousState: previous,
        observation,
        action: 'NO_CHANGE',
        previousVersionId: previous.admittedVersionId,
        nextVersionId: previous.admittedVersionId,
        sequence,
        timestamp
      },
      admittedVersion: null
    }
  }

  const version = createContextSourceVersion(observation.sourceKey, contentHash, timestamp)
  const state: ContextSourceState = {
    ...previous,
    observationStatus: 'AVAILABLE',
    admittedVersionId: version.versionId,
    lastAvailableVersionId: version.versionId,
    reconciliationSequence: sequence,
    lastObservedAt: timestamp
  }
  return {
    state,
    event: {
      sourceKey: observation.sourceKey,
      previousState: previous,
      observation,
      action: 'UPDATE',
      previousVersionId: previous.admittedVersionId,
      nextVersionId: version.versionId,
      sequence,
      timestamp
    },
    admittedVersion: version
  }
}
