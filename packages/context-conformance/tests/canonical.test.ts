import { describe, expect, it } from 'vitest'
import {
  compareContextParity,
  type CanonicalContext,
  type CanonicalContextEntry
} from '../src/index'

function entry(overrides: Partial<CanonicalContextEntry> = {}): CanonicalContextEntry {
  return {
    position: 0,
    sourceId: 'source-a',
    sourceVersionId: 'version-1',
    representationId: 'representation-full',
    representationKind: 'FULL',
    renderedHash: 'rendered-a',
    renderedContentHash: 'content-a',
    placement: 'MODEL_CONTEXT',
    role: 'user',
    ...overrides
  }
}

function context(entries: readonly CanonicalContextEntry[]): CanonicalContext {
  return { entries, logicalHash: 'fixture-hash' }
}

describe('provider-neutral context conformance canonical', () => {
  it('accepts semantically equivalent entries', () => {
    expect(compareContextParity(context([entry()]), context([entry()]))).toEqual({
      status: 'PASS',
      mismatches: [],
      errorCategory: null
    })
  })

  it('diagnoses a version mismatch without depending on a harness', () => {
    const result = compareContextParity(
      context([entry()]),
      context([entry({ sourceVersionId: 'version-2' })])
    )
    expect(result.status).toBe('FAIL')
    expect(result.mismatches[0]?.kind).toBe('VERSION_MISMATCH')
  })
})
