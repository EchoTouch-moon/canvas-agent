import { sha256Hex } from '../util/hash'
import type { ContextSourceVersion } from '../source/source-types'

// EXPERIMENTAL / NOT PUBLIC CONTRACT / NOT PERSISTED SCHEMA.
// A ContextSourceVersion is source truth; a ContextRepresentation is the
// model-usable form derived from one or more source versions. The first CR-003
// policy primarily uses REFERENCE / METADATA; FULL/SYMBOL/LINE_RANGE/DIFF/
// SUMMARY remain contract vocabulary until trustworthy file-level material
// exists.

export const REPRESENTATION_KINDS = [
  'REFERENCE',
  'METADATA',
  'FULL',
  'SYMBOL',
  'LINE_RANGE',
  'DIFF',
  'SUMMARY'
] as const
export type RepresentationKind = (typeof REPRESENTATION_KINDS)[number]

export const REPRESENTATION_LOSSINESS = ['NONE', 'BOUNDED', 'LOSSY'] as const
export type RepresentationLossiness = (typeof REPRESENTATION_LOSSINESS)[number]

// Immutable model-usable representation. `sourceVersionIds` must reference
// exact admitted ContextSourceVersion ids present in the planning Universe.
// `content` is EPHEMERAL bounded model-usable text (never persisted by default);
// it carries the exact FULL/LINE_RANGE payload so the representation is actually
// model-usable, not just metadata. `contentRef` may reference an ephemeral
// content handle. Both are research-only and must not be durable.
export interface ContextRepresentation {
  readonly id: string
  readonly kind: RepresentationKind
  readonly sourceVersionIds: readonly string[]
  readonly contentHash: string
  readonly tokenEstimate: number
  readonly lossiness: RepresentationLossiness
  readonly derivation: unknown
  readonly content?: string
  readonly contentRef?: string
}

export function createRepresentationId(input: {
  readonly kind: RepresentationKind
  readonly sourceVersionIds: readonly string[]
  readonly contentHash: string
}): string {
  const sorted = [...input.sourceVersionIds].sort()
  return sha256Hex(`repr-v1|${input.kind}|${sorted.join(',')}|${input.contentHash}`)
}

// Deterministic immutable representation. Identity is a pure function of kind +
// sorted source version ids + content hash; timestamps/session ids never enter
// the id.
export function createRepresentation(input: {
  readonly kind: RepresentationKind
  readonly sourceVersionIds: readonly string[]
  readonly contentHash: string
  readonly tokenEstimate: number
  readonly lossiness: RepresentationLossiness
  readonly derivation: unknown
  readonly content?: string
  readonly contentRef?: string
}): ContextRepresentation {
  if (input.sourceVersionIds.length === 0) {
    throw new Error('ContextRepresentation requires at least one source version id')
  }
  const id = createRepresentationId(input)
  return {
    id,
    kind: input.kind,
    sourceVersionIds: [...input.sourceVersionIds],
    contentHash: input.contentHash,
    tokenEstimate: input.tokenEstimate,
    lossiness: input.lossiness,
    derivation: input.derivation,
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.contentRef !== undefined ? { contentRef: input.contentRef } : {})
  }
}

// Freshness: a representation is valid only against the exact source versions
// from which it was derived. If any of those versions is no longer the current
// admitted version for its source, the representation is stale.
export function isRepresentationFresh(
  representation: ContextRepresentation,
  admittedVersions: readonly ContextSourceVersion[]
): boolean {
  const admittedByVersionId = new Map<string, ContextSourceVersion>()
  for (const version of admittedVersions) {
    admittedByVersionId.set(version.versionId, version)
  }
  return representation.sourceVersionIds.every((versionId) =>
    admittedByVersionId.has(versionId)
  )
}
