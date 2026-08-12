import {
  createRepresentation,
  sha256Hex,
  type ContextRepresentation,
  type ContextRepresentationNeed
} from '@canvas-agent/context-runtime'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import {
  readRepositoryRevision,
  type GitRunOptions
} from '@canvas-agent/worker-runtime'
import { readGitBlob, MAX_REPOSITORY_CONTENT_BYTES } from './git-blob-reader'
import { repositorySourceKey } from './repository-observer'
import type { RepositoryUnavailableReason } from './types'

// EXPERIMENTAL file representation provider (DS-012 / CR-003B). It materializes
// an exact model-usable file representation from an ADMITTED Repository
// SourceVersion, binding the representation to the exact SourceVersion and
// repository revision. It never derives file truth from Pi tool results.
//
// Design (async integration phase, synchronous Planner):
//   pre-verify exact revision
//   → read bounded file
//   → verify full-content hash == admitted SourceVersion contentHash
//   → post-verify exact revision
//   → derive FULL / LINE_RANGE / REFERENCE
//
// The resulting FULL / LINE_RANGE representation carries the exact ephemeral
// bounded content (model-usable), never persisted by default.

export type RepresentationMaterializeFailureReason =
  | RepositoryUnavailableReason
  | 'REVISION_MISMATCH'
  | 'REVISION_CHANGED_DURING_OBSERVATION'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_BINARY'
  | 'READ_FAILED'
  | 'CONTENT_HASH_MISMATCH'
  | 'DIRTY_REVISION_UNSUPPORTED'
  | 'LINE_RANGE_OUT_OF_BOUNDS'
  | 'UNSUPPORTED_KIND'

export type RepresentationMaterializeResult =
  | { readonly kind: 'representation'; readonly representation: ContextRepresentation }
  | { readonly kind: 'failed'; readonly reason: RepresentationMaterializeFailureReason }

export interface RepositoryRepresentationRequest {
  readonly repositoryPath: string
  readonly expectedRevision: RepositoryRevisionContract
  readonly sourceKey: string
  readonly sourceVersionId: string
  readonly sourceVersionContentHash: string
  readonly need: ContextRepresentationNeed
}

// Injectable revision reader seam so deterministic tests can drive a
// before/after revision sequence without a real concurrent mutation.
export interface RevisionReader {
  read(repositoryPath: string, options: GitRunOptions): Promise<RepositoryRevisionContract>
}

const realRevisionReader: RevisionReader = {
  async read(repositoryPath, options): Promise<RepositoryRevisionContract> {
    let actual: {
      baseCommit: string | null
      treeHash: string | null
      workingTreePatchHash: string | null
    }
    try {
      actual = await readRepositoryRevision(repositoryPath, options)
    } catch {
      return { baseCommit: '', treeHash: '', workingTreePatchHash: null }
    }
    if (actual.baseCommit === null || actual.treeHash === null) {
      return { baseCommit: '', treeHash: '', workingTreePatchHash: null }
    }
    return {
      baseCommit: actual.baseCommit,
      treeHash: actual.treeHash,
      workingTreePatchHash: actual.workingTreePatchHash
    }
  }
}

export class FileRepresentationProvider {
  private readonly revisionReader: RevisionReader

  constructor(options: { revisionReader?: RevisionReader } = {}) {
    this.revisionReader = options.revisionReader ?? realRevisionReader
  }

  async materialize(
    request: RepositoryRepresentationRequest
  ): Promise<RepresentationMaterializeResult> {
    // Dirty revisions fail closed (DS-011 rule preserved).
    if (request.expectedRevision.workingTreePatchHash !== null) {
      return { kind: 'failed', reason: 'DIRTY_REVISION_UNSUPPORTED' }
    }

    // REFERENCE carries no file-content claim: no read required, no revision
    // binding needed beyond the admitted SourceVersion provenance.
    if (request.need.preferredKind === 'REFERENCE') {
      const representation = createRepresentation({
        kind: 'REFERENCE',
        sourceVersionIds: [request.sourceVersionId],
        contentHash: sha256Hex(`reference:${request.sourceKey}:${request.sourceVersionId}`),
        tokenEstimate: 1,
        lossiness: 'NONE',
        derivation: {
          sourceKey: request.sourceKey,
          sourceVersionId: request.sourceVersionId
        }
      })
      return { kind: 'representation', representation }
    }

    if (
      request.need.preferredKind !== 'FULL' &&
      request.need.preferredKind !== 'LINE_RANGE'
    ) {
      return { kind: 'failed', reason: 'UNSUPPORTED_KIND' }
    }

    // Pre-verify exact revision.
    if (!(await this.revisionMatches(request))) {
      return { kind: 'failed', reason: 'REVISION_MISMATCH' }
    }

    const path = sourceKeyToPath(request.sourceKey)
    if (path === null) {
      return { kind: 'failed', reason: 'READ_FAILED' }
    }

    const blob = await readGitBlob(request.repositoryPath, request.expectedRevision.baseCommit, path)
    if (blob.kind === 'too-large') {
      return { kind: 'failed', reason: 'FILE_TOO_LARGE' }
    }
    if (blob.kind === 'not-utf8') {
      return { kind: 'failed', reason: 'UNSUPPORTED_BINARY' }
    }
    if (blob.kind !== 'content') {
      return { kind: 'failed', reason: 'READ_FAILED' }
    }

    // Exact SourceVersion binding: materialized full content must hash to the
    // admitted SourceVersion contentHash. Fail closed otherwise.
    const fullContentHash = sha256Hex(blob.content)
    if (fullContentHash !== request.sourceVersionContentHash) {
      return { kind: 'failed', reason: 'CONTENT_HASH_MISMATCH' }
    }

    // Post-verify exact revision (race safety).
    if (!(await this.revisionMatches(request))) {
      return { kind: 'failed', reason: 'REVISION_CHANGED_DURING_OBSERVATION' }
    }

    if (request.need.preferredKind === 'FULL') {
      const representation = createRepresentation({
        kind: 'FULL',
        sourceVersionIds: [request.sourceVersionId],
        contentHash: fullContentHash,
        tokenEstimate: tokenEstimate(blob.content),
        lossiness: 'NONE',
        content: blob.content,
        derivation: {
          sourceKey: request.sourceKey,
          sourceVersionId: request.sourceVersionId,
          materialization: 'FULL'
        }
      })
      return { kind: 'representation', representation }
    }

    // LINE_RANGE: 1-based, inclusive-inclusive, deterministic, fail-closed on
    // out-of-range.
    const lineRange = request.need.lineRange
    if (lineRange === undefined) {
      return { kind: 'failed', reason: 'LINE_RANGE_OUT_OF_BOUNDS' }
    }
    const lines = blob.content.split('\n')
    if (
      lineRange.startLine < 1 ||
      lineRange.endLine < lineRange.startLine ||
      lineRange.endLine > lines.length
    ) {
      return { kind: 'failed', reason: 'LINE_RANGE_OUT_OF_BOUNDS' }
    }
    const selected = lines.slice(lineRange.startLine - 1, lineRange.endLine).join('\n')
    const rangeContentHash = sha256Hex(selected)
    const representation = createRepresentation({
      kind: 'LINE_RANGE',
      sourceVersionIds: [request.sourceVersionId],
      contentHash: rangeContentHash,
      tokenEstimate: tokenEstimate(selected),
      lossiness: 'BOUNDED',
      content: selected,
      derivation: {
        sourceKey: request.sourceKey,
        sourceVersionId: request.sourceVersionId,
        materialization: 'LINE_RANGE',
        requestedRange: { startLine: lineRange.startLine, endLine: lineRange.endLine },
        effectiveRange: { startLine: lineRange.startLine, endLine: lineRange.endLine }
      }
    })
    return { kind: 'representation', representation }
  }

  private async revisionMatches(
    request: RepositoryRepresentationRequest
  ): Promise<boolean> {
    const options: GitRunOptions = {
      cwd: request.repositoryPath,
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      commandAllowlist: ['git'],
      signal: undefined
    }
    const actual = await this.revisionReader.read(request.repositoryPath, options)
    return (
      actual.baseCommit === request.expectedRevision.baseCommit &&
      actual.treeHash === request.expectedRevision.treeHash &&
      actual.workingTreePatchHash === request.expectedRevision.workingTreePatchHash
    )
  }
}

// repository/file://<path> -> repository-relative path.
export function sourceKeyToPath(sourceKey: string): string | null {
  const prefix = 'repository/file://'
  if (!sourceKey.startsWith(prefix)) return null
  const path = sourceKey.slice(prefix.length)
  return path.length > 0 ? path : null
}

// Whitespace-collapsed 4-char token heuristic (matches the Runtime estimator
// semantics so Native vs proposed estimates stay comparable).
function tokenEstimate(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return Math.max(1, Math.ceil(normalized.length / 4))
}

export { MAX_REPOSITORY_CONTENT_BYTES, repositorySourceKey }
