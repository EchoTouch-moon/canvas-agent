import { createHash } from 'node:crypto'
import { join } from 'node:path'

export function workspaceIdentity(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath, 'utf8').digest('hex')
}

export interface WorkspaceStorageRoots {
  workspaceDir: string
  databasePath: string
  runtimeDirectory: string
}

export function workspaceStorageRoots(userData: string, identity: string): WorkspaceStorageRoots {
  const workspaceDir = join(userData, 'workspaces', identity)
  return {
    workspaceDir,
    databasePath: join(workspaceDir, 'canvas-agent.db'),
    runtimeDirectory: join(workspaceDir, 'runtime')
  }
}

export function repositoryName(canonicalPath: string): string {
  const trimmed = canonicalPath.replace(/[\\/]+$/, '')
  const name = trimmed.split(/[\\/]/).pop()
  return name !== undefined && name.length > 0 ? name : canonicalPath
}
