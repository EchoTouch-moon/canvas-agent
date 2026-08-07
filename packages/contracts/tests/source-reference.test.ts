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
      sourceReferenceSchema.parse({ kind: 'ARTIFACT', artifactId: 'a_1' })
    ).toThrow()
    expect(() =>
      sourceReferenceSchema.parse({ kind: 'NODE_VERSION', nodeVersionId: 'nv_1', extra: true })
    ).toThrow()
    expect(() => sourceReferenceSchema.parse({ kind: 'NODE_VERSION', nodeVersionId: '' })).toThrow()
  })

  it('accepts canonical REPOSITORY_CONTENT and rejects non-canonical paths', () => {
    expect(
      sourceReferenceSchema.parse({ kind: 'REPOSITORY_CONTENT', path: 'src/components/foo.ts' })
    ).toBeTruthy()
    expect(
      sourceReferenceSchema.parse({ kind: 'REPOSITORY_CONTENT', path: 'docs/a%20b.md' })
    ).toBeTruthy()
    for (const path of [
      '/abs/file',
      '../secret',
      'src/../secret',
      './foo',
      'src//foo',
      'a/',
      'a\\b',
      'C:/foo',
      'C:\\foo',
      ''
    ]) {
      expect(() =>
        sourceReferenceSchema.parse({ kind: 'REPOSITORY_CONTENT', path })
      ).toThrow()
    }
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

  it('accepts a canonical REPOSITORY_CONTENT source', () => {
    expect(
      freezeSelectionSchema.parse({
        source: { kind: 'REPOSITORY_CONTENT', path: 'README.md' }
      })
    ).toBeTruthy()
    expect(() =>
      freezeSelectionSchema.parse({
        source: { kind: 'REPOSITORY_CONTENT', path: '../secret' }
      })
    ).toThrow()
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
    { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' },
    { kind: 'REPOSITORY_CONTENT', path: 'src/components/foo bar.ts' },
    { kind: 'REPOSITORY_CONTENT', path: 'docs/设计.md' }
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
    expect(
      sourceRefToString({ kind: 'REPOSITORY_CONTENT', path: 'docs/foo bar.md' })
    ).toBe('repo://docs/foo%20bar.md')
    expect(
      parseSourceRef('repo://docs/foo%20bar.md')
    ).toEqual({ kind: 'REPOSITORY_CONTENT', path: 'docs/foo bar.md' })
  })

  it('rejects raw ids, unknown schemes and non-canonical repo encodings', () => {
    expect(() => parseSourceRef('nv_1')).toThrow()
    expect(() => parseSourceRef('spec_1')).toThrow()
    expect(() => parseSourceRef('blob://x')).toThrow()
    expect(() => parseSourceRef('repo://../secret')).toThrow()
    expect(() => parseSourceRef('repo://a%2Fb')).toThrow()
    expect(() => parseSourceRef('')).toThrow()
  })
})
