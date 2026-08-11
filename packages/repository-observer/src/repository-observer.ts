import {
  createAbsentObservation,
  createAvailableObservation,
  createUnavailableObservation,
  sha256Hex,
  type ContextSourceDescriptor,
  type SourceObservation
} from '@canvas-agent/context-runtime'
import { isCanonicalRepositoryPath, sourceRefToString } from '@canvas-agent/contracts'
import {
  readRepositoryRevision,
  type GitRunOptions
} from '@canvas-agent/worker-runtime'
import { readGitBlob } from './git-blob-reader'
import {
  REPOSITORY_SOURCE_KIND,
  REPOSITORY_SOURCE_PROVENANCE,
  type RepositoryFileObservation,
  type RepositoryObservationRequest,
  type RepositoryUnavailableReason
} from './types'
import type { RepositoryRevisionContract } from '@canvas-agent/contracts'

// EXPERIMENTAL authoritative Repository Observer (DS-011). It answers "what
// repository file state is true at an exact expected RepositoryRevision" and
// emits normal CR-002 SourceObservations + descriptors. It never derives file
// truth from Pi messages, tool arguments, tool results, assistant claims or
// planner membership.

export interface RepositoryObserverOptions {
  readonly gitRunTimeoutMs?: number
  readonly gitMaxOutputBytes?: number
}

export class RepositoryObserver {
  private readonly options: Required<RepositoryObserverOptions>

  constructor(options: RepositoryObserverOptions = {}) {
    this.options = {
      gitRunTimeoutMs: options.gitRunTimeoutMs ?? 30_000,
      gitMaxOutputBytes: options.gitMaxOutputBytes ?? 2 * 1024 * 1024
    }
  }

  private gitOptions(repositoryPath: string): GitRunOptions {
    return {
      cwd: repositoryPath,
      timeoutMs: this.options.gitRunTimeoutMs,
      maxOutputBytes: this.options.gitMaxOutputBytes,
      commandAllowlist: ['git'],
      signal: undefined
    }
  }

  // Bounded observation of a path set against one exact expected revision.
  // Race-safe: revision is verified before AND after the file reads; any
  // mismatch yields UNAVAILABLE, never AVAILABLE.
  async observe(request: RepositoryObservationRequest): Promise<RepositoryFileObservation[]> {
    // Dirty revisions fail closed in this bounded implementation (DS-011
    // documented decision): a dirty RepositoryRevision represents commit +
    // working-tree delta, which this observer does not read as canonical
    // current file state.
    if (request.expectedRevision.workingTreePatchHash !== null) {
      return request.paths.map((path) =>
        this.unavailableObservation(request, path, 'DIRTY_REVISION_UNSUPPORTED')
      )
    }

    // Pre-read revision verification.
    let verifiedBefore: RepositoryRevisionContract
    try {
      verifiedBefore = await this.verifyRevision(request.repositoryPath, request.expectedRevision)
    } catch {
      return request.paths.map((path) =>
        this.unavailableObservation(request, path, 'REVISION_MISMATCH')
      )
    }

    const results: RepositoryFileObservation[] = []
    for (const path of request.paths) {
      if (!isCanonicalRepositoryPath(path)) {
        results.push(this.unavailableObservation(request, path, 'NON_CANONICAL_PATH'))
        continue
      }
      const sourceKey = repositorySourceKey(path)
      const blob = await readGitBlob(request.repositoryPath, request.expectedRevision.baseCommit, path)
      let observation: SourceObservation
      if (blob.kind === 'content') {
        const contentHash = sha256Hex(blob.content)
        observation = createAvailableObservation(sourceKey, contentHash, request.observedAt)
      } else if (blob.kind === 'absent') {
        // Authoritative git signal: the path does not exist at the pinned
        // revision. This is a confirmed ABSENT (verified revision), not a
        // read failure.
        observation = createAbsentObservation(sourceKey, request.observedAt)
      } else if (blob.kind === 'too-large') {
        observation = createUnavailableObservation(sourceKey, 'FILE_TOO_LARGE', request.observedAt)
      } else if (blob.kind === 'not-utf8') {
        observation = createUnavailableObservation(sourceKey, 'UNSUPPORTED_BINARY', request.observedAt)
      } else {
        observation = createUnavailableObservation(sourceKey, 'READ_FAILED', request.observedAt)
      }
      results.push({
        sourceKey,
        sourceKind: REPOSITORY_SOURCE_KIND,
        provenance: REPOSITORY_SOURCE_PROVENANCE,
        observation,
        expectedRevision: request.expectedRevision,
        verifiedRevision: verifiedBefore
      })
    }

    // Post-read revision verification (race detection). If the repository
    // changed during the observation window, the reads are not stable: emit
    // UNAVAILABLE for the whole batch rather than trusting stale AVAILABLE/ABSENT.
    try {
      await this.verifyRevision(request.repositoryPath, request.expectedRevision)
    } catch {
      return request.paths.map((path) =>
        this.unavailableObservation(request, path, 'REVISION_CHANGED_DURING_OBSERVATION')
      )
    }

    return results
  }

  private async verifyRevision(
    repositoryPath: string,
    expected: RepositoryRevisionContract
  ): Promise<RepositoryRevisionContract> {
    const actual = await readRepositoryRevision(repositoryPath, this.gitOptions(repositoryPath))
    if (actual.baseCommit !== expected.baseCommit) {
      throw new Error('repository_revision_mismatch:baseCommit')
    }
    if (actual.treeHash !== expected.treeHash) {
      throw new Error('repository_revision_mismatch:treeHash')
    }
    if (actual.workingTreePatchHash !== expected.workingTreePatchHash) {
      throw new Error('repository_revision_mismatch:workingTreePatchHash')
    }
    return expected
  }

  private unavailableObservation(
    request: RepositoryObservationRequest,
    path: string,
    reason: RepositoryUnavailableReason
  ): RepositoryFileObservation {
    const sourceKey = repositorySourceKey(path)
    return {
      sourceKey,
      sourceKind: REPOSITORY_SOURCE_KIND,
      provenance: REPOSITORY_SOURCE_PROVENANCE,
      observation: createUnavailableObservation(sourceKey, reason, request.observedAt),
      expectedRevision: request.expectedRevision,
      verifiedRevision: request.expectedRevision
    }
  }
}

// Canonical repository source identity, reusing the v0.2 source-ref codec so
// the observer's identity is consistent with the existing SourceReference model.
export function repositorySourceKey(path: string): string {
  return sourceRefToString({ kind: 'REPOSITORY_CONTENT', path })
}

// Provider-neutral descriptor for a repository/file observation. The Runtime
// core consumes this without parsing the key.
export function repositorySourceDescriptor(path: string): ContextSourceDescriptor {
  return {
    sourceKey: repositorySourceKey(path),
    sourceKind: REPOSITORY_SOURCE_KIND,
    provenance: REPOSITORY_SOURCE_PROVENANCE
  }
}
