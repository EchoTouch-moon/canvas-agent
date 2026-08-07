import {
  activateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  defaultServices,
  freezeContextSnapshot,
  getActiveBaseline,
  getProject,
  listBaselineItems,
  listBaselines,
  listCriteria,
  listEdges,
  listNodeDrafts,
  listNodes,
  listNodeVersions,
  listProjects,
  listTaskSpecVersions,
  listTasks,
  listTaskTargets,
  NotFoundError,
  publishNodeVersion,
  publishTaskSpecVersion,
  requireRepositoryRevision,
  upsertRepositoryRevision,
  upsertNodeDraft,
  type ActivateBaselineResult,
  type FreezeContextSnapshotResult,
  type NodeDraftRow,
  type NodeRow,
  type NodeVersionRow,
  type Persistence,
  type ProjectBaselineRow,
  type ProjectRow,
  type PublishTaskSpecVersionResult,
  type RepositoryRevisionRow,
  type SystemServices,
  type TaskRow
} from '@canvas-agent/persistence'
import type { CommandInput, ProjectStateView } from '@canvas-agent/contracts'
import { GitRevisionReader } from './git-revision-reader'

export class WorkspaceService {
  private readonly services: SystemServices

  constructor(
    private readonly p: Persistence,
    private readonly revisions: GitRevisionReader,
    services: SystemServices = defaultServices
  ) {
    this.services = services
  }

  createProject(payload: CommandInput<'project.create'>): ProjectRow {
    return createProject(this.p, {
      id: this.services.nextId('proj_'),
      name: payload.name,
      description: payload.description ?? null
    })
  }

  getProject(payload: CommandInput<'project.get'>): ProjectRow {
    const project = getProject(this.p, payload.projectId)
    if (project === undefined) {
      throw new NotFoundError('Project', payload.projectId)
    }
    return project
  }

  listProjects(): ProjectRow[] {
    return listProjects(this.p)
  }

  projectState(projectId: string): ProjectStateView {
    const project = getProject(this.p, projectId)
    if (project === undefined) {
      throw new NotFoundError('Project', projectId)
    }
    const tasks = listTasks(this.p, projectId)
    const taskSpecs = tasks.flatMap((task) =>
      listTaskSpecVersions(this.p, task.id).map((spec) => ({
        spec,
        targets: listTaskTargets(this.p, spec.id),
        criteria: listCriteria(this.p, spec.id)
      }))
    )
    const baselines = listBaselines(this.p, projectId).map((baseline) => ({
      baseline,
      items: listBaselineItems(this.p, baseline.id)
    }))

    return {
      project,
      nodes: listNodes(this.p, projectId),
      nodeDrafts: listNodeDrafts(this.p, projectId),
      nodeVersions: listNodeVersions(this.p, projectId),
      edges: listEdges(this.p, projectId),
      tasks,
      taskSpecs,
      baselines,
      activeBaseline: getActiveBaseline(this.p, projectId) ?? null
    }
  }

  createNode(payload: CommandInput<'node.create'>): NodeRow {
    return createNode(this.p, {
      id: this.services.nextId('node_'),
      projectId: payload.projectId,
      type: payload.type,
      lifecycle: payload.lifecycle
    })
  }

  upsertNodeDraft(payload: CommandInput<'nodeDraft.upsert'>): NodeDraftRow {
    return upsertNodeDraft(this.p, {
      nodeId: payload.nodeId,
      title: payload.title,
      body: payload.body,
      expectedRevision: payload.expectedRevision
    })
  }

  publishNodeVersion(payload: CommandInput<'nodeVersion.publish'>): NodeVersionRow {
    return publishNodeVersion(this.p, {
      id: this.services.nextId('nv_'),
      nodeId: payload.nodeId,
      title: payload.title,
      body: payload.body
    })
  }

  createTask(payload: CommandInput<'task.create'>): TaskRow {
    return createTask(this.p, {
      id: this.services.nextId('task_'),
      projectId: payload.projectId,
      type: payload.type,
      title: payload.title
    })
  }

  publishTaskSpec(payload: CommandInput<'taskSpec.publish'>): PublishTaskSpecVersionResult {
    return publishTaskSpecVersion(this.p, {
      id: this.services.nextId('spec_'),
      taskId: payload.taskId,
      description: payload.description,
      scope: payload.scope,
      targets: payload.targets,
      criteria: payload.criteria
    })
  }

  createBaselineDraft(payload: CommandInput<'baseline.createDraft'>): ProjectBaselineRow {
    return createBaselineDraft(this.p, {
      id: this.services.nextId('baseline_'),
      projectId: payload.projectId,
      name: payload.name,
      description: payload.description ?? null,
      repositoryRevisionId: payload.repositoryRevisionId ?? null,
      nodeVersionIds: payload.nodeVersionIds
    })
  }

  activateBaseline(payload: CommandInput<'baseline.activate'>): ActivateBaselineResult {
    return activateBaseline(this.p, { baselineId: payload.baselineId })
  }

  async revisionCurrent(): Promise<RepositoryRevisionRow> {
    const revision = await this.revisions.current()
    return upsertRepositoryRevision(this.p, {
      id: this.services.nextId('rev_'),
      baseCommit: revision.baseCommit,
      treeHash: revision.treeHash,
      workingTreePatchHash: revision.workingTreePatchHash
    })
  }

  freezeSnapshot(payload: CommandInput<'snapshot.freeze'>): FreezeContextSnapshotResult {
    requireRepositoryRevision(this.p, payload.expectedRepositoryRevisionId)
    return freezeContextSnapshot(this.p, {
      id: this.services.nextId('snap_'),
      projectId: payload.projectId,
      taskId: payload.taskId,
      taskSpecVersionId: payload.taskSpecVersionId,
      baseBaselineId: payload.baseBaselineId,
      expectedRepositoryRevisionId: payload.expectedRepositoryRevisionId,
      items: payload.items
    })
  }
}
