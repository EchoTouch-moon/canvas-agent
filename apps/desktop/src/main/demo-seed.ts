import {
  activateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  getProject,
  publishNodeVersion,
  publishTaskSpecVersion,
  type Persistence
} from '@canvas-agent/persistence'

const DEMO_PROJECT_ID = 'proj_demo'

export async function seedDemoWorkspace(p: Persistence): Promise<string> {
  if (getProject(p, DEMO_PROJECT_ID) !== undefined) {
    return DEMO_PROJECT_ID
  }

  createProject(p, {
    id: DEMO_PROJECT_ID,
    name: 'MUSICDB Demo',
    description: 'Phase 3 demo workspace for the real core loop.'
  })
  createNode(p, { id: 'node_demo_1', projectId: DEMO_PROJECT_ID, type: 'GOAL' })
  const version = publishNodeVersion(p, {
    id: 'nv_demo_1',
    nodeId: 'node_demo_1',
    title: 'Prove the loop',
    body: 'Drive a worker dispatch from a frozen snapshot through the real backend.'
  })
  createTask(p, {
    id: 'task_demo_1',
    projectId: DEMO_PROJECT_ID,
    type: 'IMPLEMENT_CHANGE',
    title: 'Run the core loop'
  })
  publishTaskSpecVersion(p, {
    id: 'spec_demo_1',
    taskId: 'task_demo_1',
    description: 'Dispatch a worker from a frozen snapshot.',
    scope: 'demo',
    criteria: [{ description: 'worker returns execution evidence', position: 0 }]
  })
  const baseline = createBaselineDraft(p, {
    id: 'baseline_demo_1',
    projectId: DEMO_PROJECT_ID,
    name: 'Demo 0.1',
    nodeVersionIds: [version.id]
  })
  activateBaseline(p, { baselineId: baseline.id })

  return DEMO_PROJECT_ID
}
