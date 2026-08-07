import { afterEach, describe, expect, it } from 'vitest'
import {
  activateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  publishNodeVersion,
  publishTaskSpecVersion,
  ValidationError,
  type Persistence,
  type SystemServices
} from '@canvas-agent/persistence'
import { openWorkspaceDatabase, closeWorkspaceDatabase } from './database'
import { ContextResolver, type ContextResolutionScope } from './context-resolver'
import { cleanupTempDirs } from './testing/git-fixture'

function fixedServices(): SystemServices {
  let counter = 0
  return {
    now: () => '2026-08-07T00:00:00.000Z',
    nextId: (prefix: string) => `${prefix}${++counter}`
  }
}

interface Seeded {
  p: Persistence
  scope: ContextResolutionScope
  projectId: string
  baselineId: string
  taskSpecVersionId: string
  baselineVersionId: string
  outOfBaselineVersionId: string
  foreignVersionId: string
}

function seed(): Seeded {
  const p = openWorkspaceDatabase(':memory:', fixedServices())
  const projectId = 'proj_main'
  const foreignProjectId = 'proj_foreign'

  createProject(p, { id: projectId, name: 'Main' })
  createProject(p, { id: foreignProjectId, name: 'Foreign' })

  const baselineNode = createNode(p, { id: 'node_baseline', projectId, type: 'GOAL' })
  const baselineVersion = publishNodeVersion(p, {
    id: 'nv_baseline',
    nodeId: baselineNode.id,
    title: 'Baseline fact',
    body: 'A fact accepted by the baseline.'
  })

  const looseNode = createNode(p, { id: 'node_loose', projectId, type: 'DESIGN' })
  const looseVersion = publishNodeVersion(p, {
    id: 'nv_loose',
    nodeId: looseNode.id,
    title: 'Loose fact',
    body: 'Not in the baseline.'
  })

  const foreignNode = createNode(p, {
    id: 'node_foreign',
    projectId: foreignProjectId,
    type: 'GOAL'
  })
  const foreignVersion = publishNodeVersion(p, {
    id: 'nv_foreign',
    nodeId: foreignNode.id,
    title: 'Foreign',
    body: 'Other project.'
  })

  const task = createTask(p, { id: 'task_1', projectId, type: 'IMPLEMENT_CHANGE', title: 'T' })
  const spec = publishTaskSpecVersion(p, {
    id: 'spec_1',
    taskId: task.id,
    description: 'dispatch',
    scope: 'demo',
    criteria: [
      { description: 'c0', position: 0 },
      { description: 'c1', position: 1 }
    ],
    targets: [{ nodeId: baselineNode.id, nodeVersionId: null, position: 0 }]
  })

  const baseline = createBaselineDraft(p, {
    id: 'baseline_1',
    projectId,
    name: '0.1',
    nodeVersionIds: [baselineVersion.id]
  })
  activateBaseline(p, { baselineId: baseline.id })

  return {
    p,
    projectId,
    baselineId: baseline.id,
    taskSpecVersionId: spec.spec.id,
    baselineVersionId: baselineVersion.id,
    outOfBaselineVersionId: looseVersion.id,
    foreignVersionId: foreignVersion.id,
    scope: {
      projectId,
      taskId: task.id,
      taskSpecVersionId: spec.spec.id,
      baseBaselineId: baseline.id,
      expectedRepositoryRevisionId: 'rev_placeholder'
    }
  }
}

describe('ContextResolver', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('materializes the pinned task spec first at position 0', () => {
    const { p, scope, taskSpecVersionId } = seed()
    const resolver = new ContextResolver(p)
    const items = resolver.materialize(scope, [])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      itemType: 'USER_INPUT',
      sourceRef: `task-spec://${taskSpecVersionId}`,
      authority: 'TASK_INSTRUCTION',
      priority: 'P0'
    })
    expect(items[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    closeWorkspaceDatabase(p)
  })

  it('resolves a baseline node version as PROJECT_FACT / P1 and matches its persisted hash', () => {
    const { p, scope, baselineVersionId } = seed()
    const resolver = new ContextResolver(p)
    const items = resolver.materialize(scope, [
      { source: { kind: 'NODE_VERSION', nodeVersionId: baselineVersionId } }
    ])

    expect(items).toHaveLength(2)
    const nodeItem = items[1]
    expect(nodeItem).toMatchObject({
      itemType: 'NODE_VERSION',
      sourceRef: `node://${baselineVersionId}`,
      authority: 'PROJECT_FACT',
      priority: 'P1'
    })
    expect(nodeItem?.tokenEstimate).toBeGreaterThan(0)
    expect(nodeItem?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    closeWorkspaceDatabase(p)
  })

  it('rejects a node version that is not a member of the base baseline', () => {
    const { p, scope, outOfBaselineVersionId } = seed()
    const resolver = new ContextResolver(p)
    expect(() =>
      resolver.materialize(scope, [
        { source: { kind: 'NODE_VERSION', nodeVersionId: outOfBaselineVersionId } }
      ])
    ).toThrow(ValidationError)
    closeWorkspaceDatabase(p)
  })

  it('rejects a node version from another project', () => {
    const { p, scope, foreignVersionId } = seed()
    const resolver = new ContextResolver(p)
    expect(() =>
      resolver.materialize(scope, [
        { source: { kind: 'NODE_VERSION', nodeVersionId: foreignVersionId } }
      ])
    ).toThrow(ValidationError)
    closeWorkspaceDatabase(p)
  })

  it('rejects duplicate selections via canonical sourceRef', () => {
    const { p, scope, baselineVersionId } = seed()
    const resolver = new ContextResolver(p)
    expect(() =>
      resolver.materialize(scope, [
        { source: { kind: 'NODE_VERSION', nodeVersionId: baselineVersionId } },
        { source: { kind: 'NODE_VERSION', nodeVersionId: baselineVersionId } }
      ])
    ).toThrow(/duplicate_context_source/)
    closeWorkspaceDatabase(p)
  })

  it('resolve() supports TASK_SPEC_VERSION refs bound to the task', () => {
    const { p, scope, taskSpecVersionId } = seed()
    const resolver = new ContextResolver(p)
    const item = resolver.resolve(scope, {
      kind: 'TASK_SPEC_VERSION',
      taskSpecVersionId
    })
    expect(item.itemType).toBe('USER_INPUT')
    closeWorkspaceDatabase(p)
  })

  it('resolve() requires the exact pinned task spec version', () => {
    const { p, scope } = seed()
    const laterSpec = publishTaskSpecVersion(p, {
      id: 'spec_later',
      taskId: scope.taskId,
      description: 'later',
      scope: 'demo',
      criteria: [{ description: 'c', position: 0 }]
    })
    const resolver = new ContextResolver(p)
    expect(() =>
      resolver.resolve(scope, {
        kind: 'TASK_SPEC_VERSION',
        taskSpecVersionId: laterSpec.spec.id
      })
    ).toThrow(/task_spec_binding_mismatch/)
    closeWorkspaceDatabase(p)
  })

  it('resolve() rejects a task spec bound to another task', () => {
    const { p, scope } = seed()
    const otherTask = createTask(p, {
      id: 'task_other',
      projectId: scope.projectId,
      type: 'IMPLEMENT_CHANGE',
      title: 'Other'
    })
    const otherSpec = publishTaskSpecVersion(p, {
      id: 'spec_other',
      taskId: otherTask.id,
      description: 'x',
      scope: 'y',
      criteria: [{ description: 'c', position: 0 }]
    })
    const resolver = new ContextResolver(p)
    expect(() =>
      resolver.resolve(scope, { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: otherSpec.spec.id })
    ).toThrow(ValidationError)
    closeWorkspaceDatabase(p)
  })
})
