import { useCallback, useEffect, useRef, useState } from 'react'
import type { SourceReference } from '@canvas-agent/contracts'
import {
  InternalError,
  WorkspaceError,
  type WorkspaceClient,
  type SnapshotFreezeInput,
  type NodeDraftUpsertInput,
  createWorkspaceClient
} from '@/lib/workspace-client'
import type {
  DispatchResult,
  FrozenSnapshotView,
  NodeDraftRecord,
  ProjectRecord,
  ProjectStateView,
  RepositoryRevisionRecord,
  ResolvedContextItem
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
  ) => Promise<FrozenSnapshotView>
  readonly saveNodeDraft: (input: NodeDraftUpsertInput) => Promise<NodeDraftRecord>
  readonly resolveContext: (input: {
    readonly projectId: string
    readonly taskId: string
    readonly taskSpecVersionId: string
    readonly baseBaselineId: string
    readonly selections: readonly SourceReference[]
  }) => Promise<{ readonly items: readonly ResolvedContextItem[] }>
  readonly execute: (input: {
    readonly executionRequestId: string
    readonly contextSnapshotId: string
  }) => Promise<DispatchResult>
  readonly cancel: (executionRequestId: string) => Promise<{ readonly cancelled: boolean }>
}

const defaultClient = createWorkspaceClient()

export function useWorkspace(
  requestedProjectId: string | null = null,
  client: WorkspaceClient = defaultClient
): UseWorkspaceResult {
  const [projects, setProjects] = useState<readonly ProjectRecord[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(requestedProjectId)
  const [workspace, setWorkspace] = useState<ProjectStateView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<WorkspaceError | null>(null)
  const refreshGeneration = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++refreshGeneration.current
    setLoading(true)
    setError(null)
    try {
      const result = await hydrateWorkspace(client, requestedProjectId ?? selectedProjectId)
      if (generation !== refreshGeneration.current) {
        return
      }
      setProjects(result.projects)
      setSelectedProjectId(result.selectedProjectId)
      setWorkspace(result.workspace)
    } catch (caught) {
      if (generation !== refreshGeneration.current) {
        return
      }
      setWorkspace(null)
      setError(
        caught instanceof WorkspaceError
          ? caught
          : new InternalError(
              caught instanceof Error ? caught.message : 'Workspace hydration failed'
            )
      )
    } finally {
      if (generation === refreshGeneration.current) {
        setLoading(false)
      }
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
    ): Promise<FrozenSnapshotView> => {
      const revision: RepositoryRevisionRecord = await client.command('revision.current', {})
      const result = await client.command('snapshot.freeze', {
        ...input,
        expectedRepositoryRevisionId: revision.id
      })
      await refresh()
      return { ...result.snapshot, items: result.items }
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

  const resolveContext = useCallback(
    async (input: {
      readonly projectId: string
      readonly taskId: string
      readonly taskSpecVersionId: string
      readonly baseBaselineId: string
      readonly selections: readonly SourceReference[]
    }): Promise<{ readonly items: readonly ResolvedContextItem[] }> => {
      const revision: RepositoryRevisionRecord = await client.command('revision.current', {})
      return client.command('context.resolve', {
        projectId: input.projectId,
        taskId: input.taskId,
        taskSpecVersionId: input.taskSpecVersionId,
        baseBaselineId: input.baseBaselineId,
        expectedRepositoryRevisionId: revision.id,
        selections: [...input.selections]
      })
    },
    [client]
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
    resolveContext,
    execute,
    cancel
  }
}
