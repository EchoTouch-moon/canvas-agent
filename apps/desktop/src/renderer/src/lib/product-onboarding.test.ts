import { describe, expect, it } from 'vitest'
import type {
  CommandOutput,
  CommandRequest,
  CommandResponse,
  WorkspaceCommand
} from '@canvas-agent/contracts'
import {
  createWorkspaceClient,
  type CommandTransport,
  type WorkspaceClient
} from './workspace-client'
import {
  activateInitialBaseline,
  advanceProjectSetup,
  advanceTaskSetup,
  canDispatchProductRun,
  deriveProductSetupState,
  type ProductSetupCurrent,
  type ProjectSetupInput,
  type TaskSetupInput
} from './product-onboarding'
import type { ProjectStateView, RepositoryRevisionRecord } from './workspace-types'

const now = '2026-08-10T00:00:00.000Z'
const cleanRevision: RepositoryRevisionRecord = {
  id: 'revision-1',
  baseCommit: 'a'.repeat(40),
  treeHash: 'b'.repeat(40),
  workingTreePatchHash: null,
  createdAt: now
}

const projectInput: ProjectSetupInput = {
  projectName: 'Canvas',
  projectDescription: 'A local-first workspace.',
  charterTitle: 'Deliver the first loop',
  charterBody: 'Make the Project, Baseline, Task and execution flow explicit.',
  baselineName: 'Initial baseline',
  baselineDescription: 'The reviewed first workspace charter.'
}

const taskInput: TaskSetupInput = {
  title: 'Implement the first loop',
  description: 'Create the smallest safe implementation.',
  scope: 'Do not change public contracts.',
  criteria: [{ description: 'The command reports a useful result.' }]
}

function emptyCurrent(): ProductSetupCurrent {
  return { workspace: null, revision: null }
}

function response(request: CommandRequest, data: CommandOutput<WorkspaceCommand>): CommandResponse {
  return {
    requestId: request.requestId,
    schemaVersion: 1,
    command: request.command,
    ok: true,
    data
  }
}

function failed(request: CommandRequest): CommandResponse {
  return {
    requestId: request.requestId,
    schemaVersion: 1,
    command: request.command,
    ok: false,
    error: { name: 'PersistenceError', message: `Response lost after ${request.command} persisted` }
  }
}

class OnboardingTransport {
  readonly commands: WorkspaceCommand[] = []
  readonly lostResponses: WorkspaceCommand[] = []
  #project: CommandOutput<'project.create'> | null = null
  #nodes: ProjectStateView['nodes'] = []
  #nodeVersions: ProjectStateView['nodeVersions'] = []
  #tasks: ProjectStateView['tasks'] = []
  #taskSpecs: ProjectStateView['taskSpecs'] = []
  #baselines: ProjectStateView['baselines'] = []
  #activeBaseline: ProjectStateView['activeBaseline'] = null

  constructor(
    private readonly failAfter = new Set<WorkspaceCommand>(),
    private readonly revision: RepositoryRevisionRecord = cleanRevision
  ) {}

  client(): WorkspaceClient {
    const transport: CommandTransport = { command: (request) => this.command(request) }
    return createWorkspaceClient(transport)
  }

  private projectState(): ProjectStateView {
    if (this.#project === null) throw new Error('No Project exists')
    return {
      project: this.#project,
      nodes: [...this.#nodes],
      nodeDrafts: [],
      nodeVersions: [...this.#nodeVersions],
      edges: [],
      tasks: [...this.#tasks],
      taskSpecs: [...this.#taskSpecs],
      baselines: [...this.#baselines],
      activeBaseline: this.#activeBaseline
    }
  }

  private after(request: CommandRequest, data: CommandOutput<WorkspaceCommand>): CommandResponse {
    if (this.failAfter.delete(request.command)) {
      this.lostResponses.push(request.command)
      return failed(request)
    }
    return response(request, data)
  }

  async command(request: CommandRequest): Promise<CommandResponse> {
    this.commands.push(request.command)
    switch (request.command) {
      case 'project.list':
        return response(request, this.#project === null ? [] : [this.#project])
      case 'project.state':
        return response(request, this.projectState())
      case 'revision.current':
        return response(request, this.revision)
      case 'project.create': {
        this.#project = {
          id: 'project-1',
          name: request.payload.name,
          description: request.payload.description ?? null,
          createdAt: now,
          updatedAt: now
        }
        return this.after(request, this.#project)
      }
      case 'node.create': {
        const node: ProjectStateView['nodes'][number] = {
          id: `goal-${this.#nodes.length + 1}`,
          projectId: request.payload.projectId,
          type: request.payload.type,
          lifecycle: request.payload.lifecycle ?? 'ACTIVE',
          createdAt: now,
          updatedAt: now
        }
        this.#nodes.push(node)
        return this.after(request, node)
      }
      case 'nodeVersion.publish': {
        const version: ProjectStateView['nodeVersions'][number] = {
          id: `charter-${this.#nodeVersions.length + 1}`,
          nodeId: request.payload.nodeId,
          sequence: 1,
          title: request.payload.title,
          body: request.payload.body,
          contentHash: 'c'.repeat(64),
          createdAt: now
        }
        this.#nodeVersions.push(version)
        return this.after(request, version)
      }
      case 'baseline.createDraft': {
        const baseline: ProjectStateView['baselines'][number]['baseline'] = {
          id: `baseline-${this.#baselines.length + 1}`,
          projectId: request.payload.projectId,
          status: 'DRAFT',
          name: request.payload.name,
          description: request.payload.description ?? null,
          repositoryRevisionId: request.payload.repositoryRevisionId ?? null,
          activatedAt: null,
          supersededAt: null,
          createdAt: now,
          updatedAt: now
        }
        this.#baselines.push({
          baseline,
          items: request.payload.nodeVersionIds.map((nodeVersionId, position) => ({
            id: `${baseline.id}-item-${position}`,
            baselineId: baseline.id,
            nodeVersionId,
            position
          }))
        })
        return this.after(request, baseline)
      }
      case 'baseline.activate': {
        const aggregate = this.#baselines.find(
          (candidate) => candidate.baseline.id === request.payload.baselineId
        )
        if (aggregate === undefined) throw new Error('Unknown Baseline')
        const activated = {
          ...aggregate.baseline,
          status: 'ACTIVE' as const,
          activatedAt: now,
          updatedAt: now
        }
        this.#baselines = this.#baselines.map((candidate) =>
          candidate.baseline.id === activated.id ? { ...candidate, baseline: activated } : candidate
        )
        this.#activeBaseline = activated
        return this.after(request, { activated, superseded: null })
      }
      case 'task.create': {
        const task: ProjectStateView['tasks'][number] = {
          id: `task-${this.#tasks.length + 1}`,
          projectId: request.payload.projectId,
          type: request.payload.type,
          status: 'DRAFT',
          title: request.payload.title,
          createdAt: now,
          updatedAt: now
        }
        this.#tasks.push(task)
        return this.after(request, task)
      }
      case 'taskSpec.publish': {
        const spec: ProjectStateView['taskSpecs'][number]['spec'] = {
          id: `spec-${this.#taskSpecs.length + 1}`,
          taskId: request.payload.taskId,
          sequence: 1,
          description: request.payload.description,
          scope: request.payload.scope,
          contentHash: 'd'.repeat(64),
          createdAt: now
        }
        const criteria = request.payload.criteria.map((criterion) => ({
          id: `${spec.id}-criterion-${criterion.position}`,
          taskSpecVersionId: spec.id,
          position: criterion.position,
          description: criterion.description,
          verificationMethod: criterion.verificationMethod ?? 'MANUAL_REVIEW'
        }))
        this.#taskSpecs.push({
          spec,
          criteria,
          targets: (request.payload.targets ?? []).map((target) => ({
            id: `${spec.id}-target-${target.position}`,
            taskSpecVersionId: spec.id,
            nodeId: target.nodeId ?? null,
            nodeVersionId: target.nodeVersionId ?? null,
            position: target.position
          }))
        })
        return this.after(request, { spec, criteria })
      }
      default:
        throw new Error(`Unexpected command ${request.command}`)
    }
  }
}

async function advanceToBaselineDraft(client: WorkspaceClient): Promise<ProductSetupCurrent> {
  let result = await advanceProjectSetup(client, emptyCurrent(), projectInput)
  for (
    let step = 0;
    step < 5 && (result.state.kind !== 'BASELINE_DRAFT_REVIEW' || result.error !== null);
    step += 1
  ) {
    result = await advanceProjectSetup(client, result.current, projectInput)
  }
  expect(result.error).toBeNull()
  expect(result.state.kind).toBe('BASELINE_DRAFT_REVIEW')
  return result.current
}

async function advanceToTaskReady(client: WorkspaceClient): Promise<ProductSetupCurrent> {
  let current = await advanceToBaselineDraft(client)
  const baseline = current.workspace?.baselines[0]?.baseline
  if (baseline === undefined) throw new Error('Expected initial Baseline draft')
  await activateInitialBaseline(client, baseline.id)
  let result = await advanceTaskSetup(client, current, taskInput)
  for (
    let step = 0;
    step < 3 && (result.state.kind !== 'TASK_READY' || result.error !== null);
    step += 1
  ) {
    result = await advanceTaskSetup(client, result.current, taskInput)
  }
  expect(result.error).toBeNull()
  expect(result.state.kind).toBe('TASK_READY')
  current = result.current
  return current
}

describe('PROPOSAL-029 pure onboarding orchestration', () => {
  it.each([
    'project.create',
    'node.create',
    'nodeVersion.publish',
    'baseline.createDraft'
  ] as const)(
    'rehydrates after %s persists, then retries without Project/charter/Baseline duplicates',
    async (failedCommand) => {
      const transport = new OnboardingTransport(new Set([failedCommand]))
      const client = transport.client()
      const current = await advanceToBaselineDraft(client)

      expect(current.workspace?.baselines).toHaveLength(1)
      expect(current.workspace?.nodes).toHaveLength(1)
      expect(current.workspace?.nodeVersions).toHaveLength(1)
      expect(transport.lostResponses).toEqual([failedCommand])
      expect(transport.commands.filter((command) => command === 'project.create')).toHaveLength(1)
      expect(transport.commands.filter((command) => command === 'node.create')).toHaveLength(1)
      expect(
        transport.commands.filter((command) => command === 'nodeVersion.publish')
      ).toHaveLength(1)
      expect(
        transport.commands.filter((command) => command === 'baseline.createDraft')
      ).toHaveLength(1)
    }
  )

  it('keeps the initial Baseline DRAFT until the separate explicit activation action', async () => {
    const transport = new OnboardingTransport()
    const client = transport.client()
    const current = await advanceToBaselineDraft(client)
    const draft = current.workspace?.baselines[0]?.baseline

    expect(draft?.status).toBe('DRAFT')
    expect(current.workspace?.activeBaseline).toBeNull()
    if (draft === undefined) throw new Error('Expected initial Baseline draft')
    await activateInitialBaseline(client, draft.id)

    const afterActivation = await advanceTaskSetup(client, current, taskInput)
    expect(afterActivation.state.kind).toBe('TASK_DRAFT_NEEDS_SPEC')
    expect(afterActivation.current.workspace?.activeBaseline?.status).toBe('ACTIVE')
  })

  it.each(['task.create', 'taskSpec.publish'] as const)(
    'rehydrates after %s persists, then retries without Task or TaskSpec duplicates',
    async (failedCommand) => {
      const transport = new OnboardingTransport(new Set([failedCommand]))
      const client = transport.client()
      const current = await advanceToTaskReady(client)

      expect(current.workspace?.tasks).toHaveLength(1)
      expect(current.workspace?.taskSpecs).toHaveLength(1)
      expect(transport.lostResponses).toEqual([failedCommand])
      expect(transport.commands.filter((command) => command === 'task.create')).toHaveLength(1)
      expect(transport.commands.filter((command) => command === 'taskSpec.publish')).toHaveLength(1)
    }
  )

  it('surfaces the dirty overlay, blocks initial Baseline creation, and requires all dispatch facts', async () => {
    const dirtyRevision = { ...cleanRevision, workingTreePatchHash: 'e'.repeat(64) }
    const transport = new OnboardingTransport(new Set(), dirtyRevision)
    const client = transport.client()
    let result = await advanceProjectSetup(client, emptyCurrent(), projectInput)
    result = await advanceProjectSetup(client, result.current, projectInput)
    result = await advanceProjectSetup(client, result.current, projectInput)

    expect(result.state).toMatchObject({
      kind: 'REPOSITORY_DIRTY_BLOCKED',
      blockedState: { kind: 'PROJECT_NEEDS_BASELINE_DRAFT' }
    })
    result = await advanceProjectSetup(client, result.current, projectInput)
    expect(result.error?.message).toContain('Commit or stash')
    expect(transport.commands).not.toContain('baseline.createDraft')

    const draftTransport = new OnboardingTransport()
    const draftCurrent = await advanceToBaselineDraft(draftTransport.client())
    expect(deriveProductSetupState(draftCurrent.workspace, dirtyRevision)).toMatchObject({
      kind: 'REPOSITORY_DIRTY_BLOCKED',
      blockedState: { kind: 'BASELINE_DRAFT_REVIEW' }
    })

    const workspace = result.current.workspace
    if (workspace === null) throw new Error('Expected hydrated Project state')
    const cleanTaskReady = deriveProductSetupState(workspace, cleanRevision)
    expect(cleanTaskReady.kind).toBe('PROJECT_NEEDS_BASELINE_DRAFT')
    const inactiveBaseline = {
      id: 'baseline-active',
      projectId: workspace.project.id,
      status: 'ACTIVE' as const,
      name: 'Active',
      description: null,
      repositoryRevisionId: cleanRevision.id,
      activatedAt: now,
      supersededAt: null,
      createdAt: now,
      updatedAt: now
    }
    const taskSpec = {
      spec: {
        id: 'spec',
        taskId: 'task',
        sequence: 1,
        description: 'D',
        scope: 'S',
        contentHash: 'f'.repeat(64),
        createdAt: now
      },
      criteria: [],
      targets: []
    }
    const required = {
      workspace: { state: 'READY' as const },
      agent: { state: 'READY' as const },
      revision: cleanRevision,
      activeBaseline: inactiveBaseline,
      taskSpec,
      snapshot: { status: 'FROZEN' as const }
    }
    expect(canDispatchProductRun(required)).toBe(true)
    expect(canDispatchProductRun({ ...required, revision: dirtyRevision })).toBe(false)
    expect(canDispatchProductRun({ ...required, snapshot: { status: 'DRAFT' as const } })).toBe(
      false
    )
    expect(canDispatchProductRun({ ...required, agent: { state: 'AUTH_REQUIRED' as const } })).toBe(
      false
    )
  })
})
