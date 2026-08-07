import { describe, expect, it } from 'vitest'
import {
  freezeSelectionSchema,
  parseSourceRef,
  sourceRefToString,
  sourceReferenceSchema,
  type SourceReference
} from '../src/source-reference'

describe('sourceReferenceSchema', () => {
  it('accepts TASK_SPEC_VERSION and NODE_VERSION', () => {
    const taskSpec = sourceReferenceSchema.parse({
      kind: 'TASK_SPEC_VERSION',
      taskSpecVersionId: 'spec_1'
    })
    const nodeVersion = sourceReferenceSchema.parse({
      kind: 'NODE_VERSION',
      nodeVersionId: 'nv_1'
    })
    expect(taskSpec.kind).toBe('TASK_SPEC_VERSION')
    expect(nodeVersion.kind).toBe('NODE_VERSION')
  })

  it('rejects unknown kinds, extra fields and empty ids', () => {
    expect(() =>
      sourceReferenceSchema.parse({ kind: 'REPOSITORY_CONTENT', path: 'src/a.ts' })
    ).toThrow()
    expect(() =>
      sourceReferenceSchema.parse({ kind: 'NODE_VERSION', nodeVersionId: 'nv_1', extra: true })
    ).toThrow()
    expect(() => sourceReferenceSchema.parse({ kind: 'NODE_VERSION', nodeVersionId: '' })).toThrow()
  })
})

describe('freezeSelectionSchema', () => {
  it('accepts only a NODE_VERSION source plus an optional selectionReason', () => {
    const selection = freezeSelectionSchema.parse({
      source: { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' },
      selectionReason: 'primary requirement'
    })
    expect(selection.selectionReason).toBe('primary requirement')
    expect(
      freezeSelectionSchema.parse({ source: { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' } })
    ).toBeTruthy()
  })

  it('rejects a TASK_SPEC_VERSION source structurally', () => {
    expect(() =>
      freezeSelectionSchema.parse({
        source: { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 'spec_1' }
      })
    ).toThrow()
  })

  it('rejects metadata-bearing selections', () => {
    expect(() =>
      freezeSelectionSchema.parse({
        source: { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' },
        itemType: 'NODE_VERSION',
        authority: 'PROJECT_FACT',
        priority: 'P1',
        tokenEstimate: 12,
        resolvedContent: 'fabricated'
      })
    ).toThrow()
  })
})

describe('sourceRefToString / parseSourceRef', () => {
  const refs: SourceReference[] = [
    { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 'spec_1' },
    { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' }
  ]

  for (const ref of refs) {
    it(`round-trips ${ref.kind}`, () => {
      const encoded = sourceRefToString(ref)
      expect(parseSourceRef(encoded)).toEqual(ref)
    })
  }

  it('encodes to canonical forms only', () => {
    expect(sourceRefToString({ kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 'spec_1' })).toBe(
      'task-spec://spec_1'
    )
    expect(sourceRefToString({ kind: 'NODE_VERSION', nodeVersionId: 'nv_1' })).toBe('node://nv_1')
  })

  it('rejects raw ids and unknown schemes', () => {
    expect(() => parseSourceRef('nv_1')).toThrow()
    expect(() => parseSourceRef('spec_1')).toThrow()
    expect(() => parseSourceRef('repo://src/a.ts')).toThrow()
    expect(() => parseSourceRef('')).toThrow()
  })
})
