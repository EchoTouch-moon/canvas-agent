import { describe, expect, it } from 'vitest'
import {
  applyMigrations,
  closeDatabase,
  createBaselineDraft,
  createNode,
  createProject,
  openDatabase,
  publishNodeVersion,
  publishTaskSpecVersion,
  createTask,
  type Persistence
} from '@canvas-agent/persistence'
import { WorkspaceService } from './workspace-service'
import { GitRevisionReader } from './git-revision-reader'

function seedMediumProject(p: Persistence): string {
  createProject(p, { id: 'proj_big', name: 'Big' })
  const versionIds: string[] = []
  for (let index = 0; index < 40; index += 1) {
    createNode(p, { id: `node_${index}`, projectId: 'proj_big', type: 'COMPONENT' })
    const version = publishNodeVersion(p, {
      id: `nv_${index}`,
      nodeId: `node_${index}`,
      title: `Node ${index}`,
      body: 'body'
    })
    versionIds.push(version.id)
  }
  for (let index = 0; index < 8; index += 1) {
    createTask(p, {
      id: `task_${index}`,
      projectId: 'proj_big',
      type: 'IMPLEMENT_CHANGE',
      title: `T${index}`
    })
    publishTaskSpecVersion(p, {
      id: `spec_${index}_1`,
      taskId: `task_${index}`,
      description: 'd',
      scope: 's',
      criteria: [
        { description: 'c0', position: 0 },
        { description: 'c1', position: 1 },
        { description: 'c2', position: 2 }
      ]
    })
    publishTaskSpecVersion(p, {
      id: `spec_${index}_2`,
      taskId: `task_${index}`,
      description: 'd2',
      scope: 's',
      criteria: [{ description: 'c', position: 0 }]
    })
  }
  createBaselineDraft(p, {
    id: 'baseline_big',
    projectId: 'proj_big',
    name: '0.1',
    nodeVersionIds: versionIds.slice(0, 5)
  })
  return 'proj_big'
}

describe('project.state read projection', () => {
  it('materializes a medium graph within a loose local time bound', () => {
    const p = openDatabase({ path: ':memory:' })
    applyMigrations(p)
    const projectId = seedMediumProject(p)
    const service = new WorkspaceService(
      p,
      new GitRevisionReader({ sourceRepositoryPath: '/unused', runtimeDirectory: '/unused' })
    )

    const started = performance.now()
    const view = service.projectState(projectId)
    const elapsed = performance.now() - started

    expect(view.nodes).toHaveLength(40)
    expect(view.nodeVersions).toHaveLength(40)
    expect(view.tasks).toHaveLength(8)
    expect(view.taskSpecs).toHaveLength(16)
    expect(view.taskSpecs[0]?.criteria).toHaveLength(3)
    expect(view.baselines[0]?.items).toHaveLength(5)
    expect(elapsed).toBeLessThan(5_000)
    closeDatabase(p)
  })
})
