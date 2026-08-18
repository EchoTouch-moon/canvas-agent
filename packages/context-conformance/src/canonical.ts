import { sha256Hex, type CommittedWorkingSet } from '@canvas-agent/context-runtime'

export const PARITY_MISMATCH_KINDS = [
  'MISSING',
  'EXTRA',
  'VERSION_MISMATCH',
  'REPRESENTATION_MISMATCH',
  'ORDER_MISMATCH',
  'CONTENT_HASH_MISMATCH'
] as const

export type ParityMismatchKind = (typeof PARITY_MISMATCH_KINDS)[number]

export type ConformancePlacement = 'MODEL_CONTEXT'

export class ConformanceTranslationError extends Error {
  readonly category = 'TRANSLATION_FAILURE' as const
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ConformanceTranslationError'
    this.code = code
  }
}

/**
 * This is the shared semantic representation used by every harness. The
 * normalized role is deliberately retained for backward compatibility with
 * CR-010; `placement` is the provider-neutral meaning of the entry.
 */
export interface CanonicalContextEntry {
  readonly position: number
  readonly sourceId: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: string
  readonly renderedHash: string
  readonly renderedContentHash: string
  readonly placement: ConformancePlacement
  readonly role: string
}

export interface CanonicalContext {
  readonly entries: readonly CanonicalContextEntry[]
  readonly logicalHash: string
  readonly payloadMessageCount?: number
  readonly expectedPayloadMessageCount?: number
}

export interface ConformanceObservedEntry {
  readonly position: number
  readonly sourceId: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: string
  readonly renderedHash: string
  readonly role: string
  readonly content: string
}

export interface ConformanceObservedMetadata {
  readonly payloadMessageCount?: number
  readonly expectedPayloadMessageCount?: number
}

function materializedRepresentationContent(entry: CommittedWorkingSet['entries'][number]): string {
  if (entry.representation.contentRef !== undefined) {
    throw new ConformanceTranslationError(
      'UNRESOLVED_CONTENT',
      `Committed entry ${entry.sourceId}@${entry.sourceVersionId} references unresolved content`
    )
  }
  if (entry.representation.content === undefined) {
    throw new ConformanceTranslationError(
      'UNRESOLVED_CONTENT',
      `Committed entry ${entry.sourceId}@${entry.sourceVersionId} has no materialized content`
    )
  }
  return entry.representation.content
}

function canonicalEntry(entry: CanonicalContextEntry): string {
  // Keep the CR-010 hash inputs stable. `placement` is fixed to MODEL_CONTEXT
  // in this layer and is therefore a semantic label, not another hash axis.
  return [
    String(entry.position),
    entry.sourceId,
    entry.sourceVersionId,
    entry.representationId,
    entry.representationKind,
    entry.renderedHash,
    entry.renderedContentHash,
    entry.role
  ].join('|')
}

function canonicalContextHash(entries: readonly CanonicalContextEntry[]): string {
  return sha256Hex(
    ['canonical-model-visible-context-v1', ...entries.map(canonicalEntry)].join('\u241F')
  )
}

function sortCanonicalEntries(
  entries: readonly CanonicalContextEntry[]
): readonly CanonicalContextEntry[] {
  return [...entries].sort((left, right) => left.position - right.position)
}

export function canonicalizeIntendedContext(
  committed: CommittedWorkingSet
): CanonicalContext {
  const entries = committed.entries.map((entry) => {
    const content = materializedRepresentationContent(entry)
    return {
      position: entry.position,
      sourceId: entry.sourceId,
      sourceVersionId: entry.sourceVersionId,
      representationId: entry.representation.id,
      representationKind: entry.representation.kind,
      renderedHash: entry.renderedHash,
      renderedContentHash: sha256Hex(`rendered-content-v1|${content}`),
      placement: 'MODEL_CONTEXT' as const,
      role: 'user'
    }
  })
  const sorted = sortCanonicalEntries(entries)
  return {
    entries: Object.freeze(sorted),
    logicalHash: canonicalContextHash(sorted)
  }
}

export function canonicalizeObservedContext(
  entries: readonly ConformanceObservedEntry[],
  metadata: ConformanceObservedMetadata = {}
): CanonicalContext {
  const canonicalEntries = entries.map((entry) => ({
    position: entry.position,
    sourceId: entry.sourceId,
    sourceVersionId: entry.sourceVersionId,
    representationId: entry.representationId,
    representationKind: entry.representationKind,
    renderedHash: entry.renderedHash,
    renderedContentHash: sha256Hex(`rendered-content-v1|${entry.content}`),
    placement: 'MODEL_CONTEXT' as const,
    role: entry.role
  }))
  const sorted = sortCanonicalEntries(canonicalEntries)
  return {
    entries: Object.freeze(sorted),
    logicalHash: canonicalContextHash(sorted),
    ...metadata
  }
}

export interface ParityMismatch {
  readonly kind: ParityMismatchKind
  readonly position: number | null
  readonly expected?: string
  readonly observed?: string
}

export interface ContextParityResult {
  readonly status: 'PASS' | 'FAIL'
  readonly mismatches: readonly ParityMismatch[]
  readonly errorCategory: 'PARITY_FAILURE' | null
}

function identity(entry: CanonicalContextEntry): string {
  return [
    entry.sourceId,
    entry.sourceVersionId,
    entry.representationId,
    entry.representationKind
  ].join('|')
}

function mismatch(
  kind: ParityMismatchKind,
  position: number | null,
  expected?: string,
  observed?: string
): ParityMismatch {
  return {
    kind,
    position,
    ...(expected !== undefined ? { expected } : {}),
    ...(observed !== undefined ? { observed } : {})
  }
}

export function compareContextParity(
  intended: CanonicalContext,
  observed: CanonicalContext
): ContextParityResult {
  const mismatches: ParityMismatch[] = []

  if (
    observed.expectedPayloadMessageCount !== undefined &&
    observed.payloadMessageCount !== undefined &&
    observed.payloadMessageCount !== observed.expectedPayloadMessageCount
  ) {
    mismatches.push(
      mismatch(
        observed.payloadMessageCount > observed.expectedPayloadMessageCount ? 'EXTRA' : 'MISSING',
        null,
        String(observed.expectedPayloadMessageCount),
        String(observed.payloadMessageCount)
      )
    )
  }

  if (observed.entries.length < intended.entries.length) {
    mismatches.push(
      mismatch('MISSING', null, String(intended.entries.length), String(observed.entries.length))
    )
  } else if (observed.entries.length > intended.entries.length) {
    mismatches.push(
      mismatch('EXTRA', null, String(intended.entries.length), String(observed.entries.length))
    )
  }

  const intendedIdentities = intended.entries.map(identity)
  const observedIdentities = observed.entries.map(identity)
  if (
    intendedIdentities.length === observedIdentities.length &&
    [...intendedIdentities].sort().join('\u241F') === [...observedIdentities].sort().join('\u241F') &&
    intendedIdentities.join('\u241F') !== observedIdentities.join('\u241F')
  ) {
    mismatches.push(mismatch('ORDER_MISMATCH', null, intendedIdentities.join(','), observedIdentities.join(',')))
  }

  const comparableLength = Math.min(intended.entries.length, observed.entries.length)
  for (let index = 0; index < comparableLength; index += 1) {
    const expected = intended.entries[index]
    const actual = observed.entries[index]
    if (expected === undefined || actual === undefined) continue
    if (
      expected.sourceId !== actual.sourceId ||
      expected.sourceVersionId !== actual.sourceVersionId
    ) {
      mismatches.push(
        mismatch(
          'VERSION_MISMATCH',
          expected.position,
          `${expected.sourceId}@${expected.sourceVersionId}`,
          `${actual.sourceId}@${actual.sourceVersionId}`
        )
      )
      continue
    }
    if (
      expected.representationId !== actual.representationId ||
      expected.representationKind !== actual.representationKind
    ) {
      mismatches.push(
        mismatch(
          'REPRESENTATION_MISMATCH',
          expected.position,
          `${expected.representationId}:${expected.representationKind}`,
          `${actual.representationId}:${actual.representationKind}`
        )
      )
    }
    if (
      expected.position !== actual.position ||
      expected.renderedHash !== actual.renderedHash ||
      expected.renderedContentHash !== actual.renderedContentHash ||
      expected.role !== actual.role ||
      expected.placement !== actual.placement
    ) {
      mismatches.push(
        mismatch(
          expected.position !== actual.position ? 'ORDER_MISMATCH' : 'CONTENT_HASH_MISMATCH',
          expected.position,
          canonicalEntry(expected),
          canonicalEntry(actual)
        )
      )
    }
  }

  return {
    status: mismatches.length === 0 ? 'PASS' : 'FAIL',
    mismatches: Object.freeze(mismatches),
    errorCategory: mismatches.length === 0 ? null : 'PARITY_FAILURE'
  }
}
