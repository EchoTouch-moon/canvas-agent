import {
  createRepresentation,
  sha256Hex,
  type ContextRepresentation,
  type ContextRepresentationNeed
} from '@canvas-agent/context-runtime'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'
import { readGitBlob, MAX_REPOSITORY_CONTENT_BYTES } from './git-blob-reader'
import { readPinnedTreeHash, type PinnedTreeReadResult } from './pinned-tree'
import { repositorySourceKey } from './repository-observer'
import type { RepositoryUnavailableReason } from './types'

// EXPERIMENTAL file representation provider (DS-012 / CR-003B + DS-014). It
// materializes an exact model-usable file representation from an ADMITTED
// Repository SourceVersion, binding the representation to the exact
// SourceVersion and repository revision. It never derives file truth from Pi
// tool results.
//
// DS-014 exact-historical materialization (design):
//   verify pinned baseCommit object exists
//   → verify baseCommit^{tree} == expectedRevision.treeHash
//   → read baseCommit:path as bounded raw bytes (existing Git-blob boundary)
//   → verify sha256(content) == admitted SourceVersion contentHash
//   → post-verify pinned tree (race safety)
//   → derive FULL / LINE_RANGE / REFERENCE
//
// The immutable pinned blob is the source of truth for an admitted clean
// SourceVersion. The current mutable worktree and HEAD are NEVER consulted, so
// a later dirty worktree or moved HEAD does not block exact historical
// materialization while the pinned object remains available and exact.

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

// Injectable pinned-tree reader seam so deterministic tests can drive a
// before/after pinned-tree sequence without a real concurrent mutation.
export interface PinnedTreeReader {
  readTreeHash(repositoryPath: string, baseCommit: string): Promise<PinnedTreeReadResult>
}

const realPinnedTreeReader: PinnedTreeReader = {
  readTreeHash(repositoryPath, baseCommit): Promise<PinnedTreeReadResult> {
    return readPinnedTreeHash(repositoryPath, baseCommit)
  }
}

export class FileRepresentationProvider {
  private readonly pinnedTreeReader: PinnedTreeReader

  constructor(options: { pinnedTreeReader?: PinnedTreeReader } = {}) {
    this.pinnedTreeReader = options.pinnedTreeReader ?? realPinnedTreeReader
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

    // Pre-verify the pinned tree. The pinned commit object must exist and
    // `baseCommit^{tree}` must equal the admitted SourceVersion's expected
    // treeHash. This reads ONLY the immutable pinned Git object, never the
    // mutable working tree or current HEAD.
    const preTree = await this.pinnedTreeReader.readTreeHash(
      request.repositoryPath,
      request.expectedRevision.baseCommit
    )
    if (preTree.kind !== 'tree-hash') {
      return { kind: 'failed', reason: 'REPOSITORY_UNAVAILABLE' }
    }
    if (preTree.treeHash !== request.expectedRevision.treeHash) {
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

    // Post-verify the pinned tree (race safety against destructive repository
    // mutation during the read window). The worktree is still never consulted.
    const postTree = await this.pinnedTreeReader.readTreeHash(
      request.repositoryPath,
      request.expectedRevision.baseCommit
    )
    if (postTree.kind !== 'tree-hash' || postTree.treeHash !== preTree.treeHash) {
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
