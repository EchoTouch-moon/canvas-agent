import { describe, expect, it } from 'vitest'
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
      branch: 'develop'
    }
    const secondState = {
      ...createFakeWorkspaceState(),
      project: secondProject
    }
    const client = createFakeWorkspaceClient({
      projects: [
        {
          id: 'project-musicdb',
          name: 'MUSICDB',
          description: 'Primary',
          branch: 'main'
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
    const client: WorkspaceClient = {
      command: async (command, payload) => {
        if (command === 'project.list') {
          return [
            {
              id: 'project-1',
              name: 'Project 1',
              description: null
            }
          ]
        }
        if (command === 'project.state') {
          const projectId = (payload as { readonly projectId: string }).projectId
          throw new NotFoundError(`Cannot find Project ${projectId}`)
        }
        throw new Error(`Unexpected command ${command}`)
      }
    }

    await expect(hydrateWorkspace(client, null)).rejects.toMatchObject({
      name: 'NotFoundError'
    })
  })
})
