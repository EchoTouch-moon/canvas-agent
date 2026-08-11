import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import type { SourceObservation } from '@canvas-agent/context-runtime'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.

// Reason codes for UNAVAILABLE repository observations. Exact literals are
// experimental; their semantics are deterministic and documented in the
// DS-011 verification artifact.
export const REPOSITORY_UNAVAILABLE_REASONS = [
  'REPOSITORY_UNAVAILABLE',
  'REVISION_MISMATCH',
  'REVISION_CHANGED_DURING_OBSERVATION',
  'PATH_OUTSIDE_REPOSITORY',
  'NON_CANONICAL_PATH',
  'READ_FAILED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_BINARY',
  'DIRTY_REVISION_UNSUPPORTED'
] as const
export type RepositoryUnavailableReason = (typeof REPOSITORY_UNAVAILABLE_REASONS)[number]

// Provider-neutral descriptor for repository/file sources, supplied by this
// integration layer. The Runtime core never special-cases these literals.
export const REPOSITORY_SOURCE_KIND = 'REPOSITORY_FILE'
export const REPOSITORY_SOURCE_PROVENANCE = 'REPOSITORY_OBSERVER'

// Bounded observation request: exact expected RepositoryRevision + a canonical
// path set. No repository crawler / indexer.
export interface RepositoryObservationRequest {
  readonly repositoryPath: string
  readonly expectedRevision: RepositoryRevisionContract
  readonly paths: readonly string[]
  readonly observedAt: string
}

// One observation result for one canonical path. The SourceObservation is the
// normal CR-002 discriminated union; verifiedRevision records what was actually
// confirmed during the bounded observation window.
export interface RepositoryFileObservation {
  readonly sourceKey: string
  readonly sourceKind: typeof REPOSITORY_SOURCE_KIND
  readonly provenance: typeof REPOSITORY_SOURCE_PROVENANCE
  readonly observation: SourceObservation
  readonly expectedRevision: RepositoryRevisionContract
  readonly verifiedRevision: RepositoryRevisionContract
}
