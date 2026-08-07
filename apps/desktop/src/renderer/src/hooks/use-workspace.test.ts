// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { CommandInput, CommandOutput, WorkspaceCommand } from '@canvas-agent/contracts'
import { createFakeWorkspaceClient, createFakeWorkspaceState } from '@/data/fake-workspace'
import { NotFoundError, type WorkspaceClient } from '@/lib/workspace-client'
import { hydrateWorkspace, useWorkspace } from './use-workspace'

class DeferredStateClient implements WorkspaceClient {
  private readonly list: CommandOutput<'project.list'>
  private readonly stateResolvers: Array<(state: CommandOutput<'project.state'>) => void> = []
  private readonly resolverWaiters: Array<{
    resolve: (resolver: (state: CommandOutput<'project.state'>) => void) => void
  }> = []

  constructor(list: CommandOutput<'project.list'>) {
    this.list = list
  }

  async command<C extends WorkspaceCommand>(commandName: C): Promise<CommandOutput<C>> {
    if (commandName === 'project.list') {
      return this.list as CommandOutput<C>
    }
    if (commandName === 'project.state') {
      return new Promise<CommandOutput<C>>((resolve) => {
        const resolver = resolve as (state: CommandOutput<'project.state'>) => void
        const waiter = this.resolverWaiters.shift()
        if (waiter !== undefined) {
          waiter.resolve(resolver)
          return
        }
        this.stateResolvers.push(resolver)
      })
    }
    throw new Error(`Unexpected command ${commandName}`)
  }

  nextStateResolver(): Promise<(state: CommandOutput<'project.state'>) => void> {
    const existing = this.stateResolvers.shift()
    if (existing !== undefined) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve) => {
      this.resolverWaiters.push({ resolve })
    })
  }
}

describe('workspace hydration', () => {
  it('keeps the empty state when project.list returns no projects', async () => {
    const result = await hydrateWorkspace(
      createFakeWorkspaceClient({ projects: [], states: [] }),
      null
    )

    expect(result.projects).toEqual([])
    expect(result.selectedProjectId).toBeNull()
    expect(result.workspace).toBeNull()
  })

  it('selects the only project and loads project.state', async () => {
    const result = await hydrateWorkspace(createFakeWorkspaceClient(), null)

    expect(result.projects).toHaveLength(1)
    expect(result.selectedProjectId).toBe('project-musicdb')
    expect(result.workspace?.project.id).toBe('project-musicdb')
  })

  it('preserves a requested project when multiple projects exist', async () => {
    const secondProject = {
      id: 'project-second',
      name: 'Second project',
      description: 'Another workspace',
      createdAt: '2026-08-06T08:00:00.000Z',
      updatedAt: '2026-08-06T09:10:00.000Z'
    }
    const secondState = createFakeWorkspaceState(secondProject)
    const client = createFakeWorkspaceClient({
      projects: [
        {
          id: 'project-musicdb',
          name: 'MUSICDB',
          description: 'Primary',
          createdAt: '2026-08-06T08:00:00.000Z',
          updatedAt: '2026-08-06T09:10:00.000Z'
        },
        secondProject
      ],
      states: [createFakeWorkspaceState(), secondState]
    })

    const result = await hydrateWorkspace(client, 'project-second')

    expect(result.selectedProjectId).toBe('project-second')
    expect(result.workspace?.project.name).toBe('Second project')
  })

  it('surfaces project.state failure without fabricating a workspace', async () => {
    const command = async <C extends WorkspaceCommand>(
      commandName: C,
      payload: CommandInput<C>
    ): Promise<CommandOutput<C>> => {
      if (commandName === 'project.list') {
        return [
          {
            id: 'project-1',
            name: 'Project 1',
            description: null,
            createdAt: '2026-08-06T08:00:00.000Z',
            updatedAt: '2026-08-06T09:10:00.000Z'
          }
        ] as CommandOutput<C>
      }
      if (commandName === 'project.state') {
        const projectId = (payload as { readonly projectId: string }).projectId
        throw new NotFoundError(`Cannot find Project ${projectId}`)
      }
      throw new Error(`Unexpected command ${commandName}`)
    }
    const client: WorkspaceClient = {
      command
    }

    await expect(hydrateWorkspace(client, null)).rejects.toMatchObject({
      name: 'NotFoundError'
    })
  })

  it('keeps the newest workspace when an older refresh resolves last', async () => {
    const project = {
      id: 'project-1',
      name: 'Project 1',
      description: null,
      createdAt: '2026-08-06T08:00:00.000Z',
      updatedAt: '2026-08-06T09:10:00.000Z'
    }
    const client = new DeferredStateClient([project])
    const { result } = renderHook(() => useWorkspace('project-1', client))

    const resolveInitial = await client.nextStateResolver()
    await act(async () => {
      resolveInitial(createFakeWorkspaceState(project))
    })
    expect(result.current.workspace?.project.name).toBe('Project 1')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      void result.current.refresh()
    })
    const resolveStale = await client.nextStateResolver()
    await act(async () => {
      void result.current.refresh()
    })
    const resolveNewest = await client.nextStateResolver()

    await act(async () => {
      resolveNewest(createFakeWorkspaceState({ ...project, name: 'Project 2' }))
    })
    expect(result.current.workspace?.project.name).toBe('Project 2')

    await act(async () => {
      resolveStale(createFakeWorkspaceState(project))
    })
    expect(result.current.workspace?.project.name).toBe('Project 2')
    expect(result.current.loading).toBe(false)
  })
})
