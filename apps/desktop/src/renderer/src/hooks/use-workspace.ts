import { useCallback, useEffect, useState } from 'react'
import {
  InternalError,
  WorkspaceError,
  type WorkspaceClient,
  type SnapshotFreezeInput,
  type NodeDraftUpsertInput
} from '@/lib/workspace-client'
import { createDefaultRendererWorkspaceClient } from '@/data/fake-workspace'
import type {
  ContextSnapshotRecord,
  DispatchResult,
  NodeDraftRecord,
  ProjectRecord,
  ProjectStateView,
  RepositoryRevisionRecord
} from '@/lib/workspace-types'

export interface HydratedWorkspace {
  readonly projects: readonly ProjectRecord[]
  readonly selectedProjectId: string | null
  readonly workspace: ProjectStateView | null
}

export async function hydrateWorkspace(
  client: WorkspaceClient,
  requestedProjectId: string | null = null
): Promise<HydratedWorkspace> {
  const projects = await client.command('project.list', {})
  const selectedProjectId =
    requestedProjectId !== null && projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : (projects[0]?.id ?? null)
  const workspace = selectedProjectId
    ? await client.command('project.state', { projectId: selectedProjectId })
    : null
  return { projects, selectedProjectId, workspace }
}

export interface UseWorkspaceResult {
  readonly projects: readonly ProjectRecord[]
  readonly selectedProjectId: string | null
  readonly workspace: ProjectStateView | null
  readonly loading: boolean
  readonly error: WorkspaceError | null
  readonly selectProject: (projectId: string) => void
  readonly refresh: () => Promise<void>
  readonly freeze: (
    input: Omit<SnapshotFreezeInput, 'expectedRepositoryRevisionId'>
  ) => Promise<ContextSnapshotRecord>
  readonly saveNodeDraft: (input: NodeDraftUpsertInput) => Promise<NodeDraftRecord>
  readonly execute: (input: {
    readonly executionRequestId: string
    readonly contextSnapshotId: string
  }) => Promise<DispatchResult>
  readonly cancel: (executionRequestId: string) => Promise<{ readonly cancelled: boolean }>
}

const defaultClient = createDefaultRendererWorkspaceClient()

export function useWorkspace(
  requestedProjectId: string | null = null,
  client: WorkspaceClient = defaultClient
): UseWorkspaceResult {
  const [projects, setProjects] = useState<readonly ProjectRecord[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(requestedProjectId)
  const [workspace, setWorkspace] = useState<ProjectStateView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<WorkspaceError | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await hydrateWorkspace(client, requestedProjectId ?? selectedProjectId)
      setProjects(result.projects)
      setSelectedProjectId(result.selectedProjectId)
      setWorkspace(result.workspace)
    } catch (caught) {
      setWorkspace(null)
      setError(
        caught instanceof WorkspaceError
          ? caught
          : new InternalError(
              caught instanceof Error ? caught.message : 'Workspace hydration failed'
            )
      )
    } finally {
      setLoading(false)
    }
  }, [client, requestedProjectId, selectedProjectId])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void refresh()
    })
    return () => {
      active = false
    }
  }, [refresh])

  const selectProject = useCallback((projectId: string): void => {
    setSelectedProjectId(projectId)
    setWorkspace(null)
    setError(null)
  }, [])

  const freeze = useCallback(
    async (
      input: Omit<SnapshotFreezeInput, 'expectedRepositoryRevisionId'>
    ): Promise<ContextSnapshotRecord> => {
      const revision: RepositoryRevisionRecord = await client.command('revision.current', {})
      const snapshot = await client.command('snapshot.freeze', {
        ...input,
        expectedRepositoryRevisionId: revision.id
      })
      await refresh()
      return snapshot
    },
    [client, refresh]
  )

  const saveNodeDraft = useCallback(
    async (input: NodeDraftUpsertInput): Promise<NodeDraftRecord> => {
      const draft = await client.command('nodeDraft.upsert', input)
      await refresh()
      return draft
    },
    [client, refresh]
  )

  const execute = useCallback(
    (input: {
      readonly executionRequestId: string
      readonly contextSnapshotId: string
    }): Promise<DispatchResult> => client.command('execution.dispatch', input),
    [client]
  )

  const cancel = useCallback(
    (executionRequestId: string): Promise<{ readonly cancelled: boolean }> =>
      client.command('execution.cancel', { executionRequestId }),
    [client]
  )

  return {
    projects,
    selectedProjectId,
    workspace,
    loading,
    error,
    selectProject,
    refresh,
    freeze,
    saveNodeDraft,
    execute,
    cancel
  }
}
