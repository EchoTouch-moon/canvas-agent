import { describe, expect, it } from 'vitest'
import type { CommandInput, CommandOutput, WorkspaceCommand } from '@canvas-agent/contracts'
import { createFakeWorkspaceClient, createFakeWorkspaceState } from '@/data/fake-workspace'
import { NotFoundError, type WorkspaceClient } from '@/lib/workspace-client'
import { hydrateWorkspace } from './use-workspace'

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
})
