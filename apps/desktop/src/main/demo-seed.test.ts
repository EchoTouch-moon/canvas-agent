import { describe, expect, it } from 'vitest'
import {
  applyMigrations,
  closeDatabase,
  createProject,
  openDatabase,
  type Persistence
} from '@canvas-agent/persistence'
import type { ProjectStateView } from '@canvas-agent/contracts'
import { seedDemoWorkspace } from './demo-seed'
import { WorkspaceService } from './workspace-service'
import { GitRevisionReader } from './git-revision-reader'

function makeService(): { p: Persistence; service: WorkspaceService } {
  const p = openDatabase({ path: ':memory:' })
  applyMigrations(p)
  const service = new WorkspaceService(
    p,
    new GitRevisionReader({ sourceRepositoryPath: '/unused', runtimeDirectory: '/unused' })
  )
  return { p, service }
}
function stateOf(service: WorkspaceService, projectId: string): ProjectStateView {
  return service.projectState(projectId)
}

describe('demo seed (dev tooling)', () => {
  it('seeds a complete runnable graph visible through project.state', async () => {
    const { p, service } = makeService()
    const projectId = await seedDemoWorkspace(p)

    const view = stateOf(service, projectId)
    expect(view.project.name).toBe('MUSICDB Demo')
    expect(view.nodes).toHaveLength(1)
    expect(view.nodeVersions).toHaveLength(1)
    expect(view.tasks).toHaveLength(1)
    expect(view.taskSpecs).toHaveLength(1)
    expect(view.taskSpecs[0]?.criteria).toHaveLength(1)
    expect(view.activeBaseline).not.toBeNull()
    expect(view.baselines).toHaveLength(1)
    expect(view.baselines[0]?.items).toHaveLength(1)
    closeDatabase(p)
  })

  it('is idempotent across launches', async () => {
    const { p, service } = makeService()
    const first = await seedDemoWorkspace(p)
    const second = await seedDemoWorkspace(p)
    expect(second).toBe(first)
    expect(stateOf(service, first).tasks).toHaveLength(1)
    closeDatabase(p)
  })

  it('does not disturb existing projects', async () => {
    const { p, service } = makeService()
    createProject(p, { id: 'proj_own', name: 'Own project' })
    await seedDemoWorkspace(p)
    expect(
      service
        .listProjects()
        .map((project) => project.id)
        .sort()
    ).toEqual(['proj_demo', 'proj_own'])
    closeDatabase(p)
  })
})
