import { readRepositoryRevision } from '@canvas-agent/worker-runtime'
import type { AppConfig } from './config'
import { RepositoryUnavailableError } from './command-errors'

export interface ResolvedRepositoryRevision {
  baseCommit: string
  treeHash: string
  workingTreePatchHash: string | null
}

export class GitRevisionReader {
  constructor(private readonly appConfig: AppConfig) {}

  get sourceRepositoryPath(): string {
    return this.appConfig.sourceRepositoryPath
  }

  get runtimeDirectory(): string {
    return this.appConfig.runtimeDirectory
  }

  async current(): Promise<ResolvedRepositoryRevision> {
    const revision = await readRepositoryRevision(this.appConfig.sourceRepositoryPath, {
      cwd: this.appConfig.sourceRepositoryPath,
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      commandAllowlist: ['git'],
      signal: undefined
    })

    if (revision.baseCommit === null || revision.treeHash === null) {
      throw new RepositoryUnavailableError('repository_has_no_head')
    }

    return {
      baseCommit: revision.baseCommit,
      treeHash: revision.treeHash,
      workingTreePatchHash: revision.workingTreePatchHash
    }
  }
}
