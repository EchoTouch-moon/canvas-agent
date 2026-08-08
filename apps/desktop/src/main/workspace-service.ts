import {
  activateBaseline,
  assertCandidateActivationValid,
  completeTask,
  createAcceptanceEvaluation,
  createArtifactApplication,
  createBaselineCandidate as createCandidateBaseline,
  createBaselineDraft,
  createNode,
  createProject,
  createTask,
  defaultServices,
  failApplication,
  finalizeApplicationApplied,
  freezeContextSnapshot,
  getActiveBaseline,
  getArtifactApplicationAggregate,
  getBaseline,
  getProject,
  getRunAggregate,
  getSnapshot,
  interruptApplication,
  latestAcceptanceEvaluationForTask,
  listAcceptanceEvaluations,
  listArtifactApplicationAggregates,
  listBaselineItems,
  listBaselines,
  listCriteria,
  listEdges,
  listNodeDrafts,
  listNodes,
  listNodeVersions,
  listProjects,
  listRuns,
  listTaskSpecVersions,
  listTasks,
  listTaskTargets,
  markApplicationApplying,
  NotFoundError,
  publishNodeVersion,
  publishTaskSpecVersion,
  requireAcceptanceEvaluation,
  requireBaselineCandidateSource,
  requireRepositoryRevision,
  requireRun,
  requireTask,
  sha256Hex,
  upsertRepositoryRevision,
  upsertNodeDraft,
  ValidationError,
  type AcceptanceEvaluationAggregate,
  type ActivateBaselineResult,
  type ArtifactApplicationAggregate,
  type BaselineCandidateAggregate,
  type FreezeContextSnapshotResult,
  type NodeDraftRow,
  type NodeRow,
  type NodeVersionRow,
  type Persistence,
  type ProjectBaselineRow,
  type ProjectRow,
  type PublishTaskSpecVersionResult,
  type RepositoryRevisionRow,
  type RunAggregateView,
  type RunSummaryRow,
  type SystemServices,
  type TaskRow
} from '@canvas-agent/persistence'
import type { CommandInput, ProjectStateView } from '@canvas-agent/contracts'
import { GitRevisionReader } from './git-revision-reader'
import { GitRepositoryWriter } from './git-repository-writer'
import { ContextResolver, type ResolvedContextItem } from './context-resolver'
export class WorkspaceService {
  private readonly services: SystemServices
  private readonly contextResolver: ContextResolver
  private readonly gitWriter: GitRepositoryWriter

  constructor(
    private readonly p: Persistence,
    private readonly revisions: GitRevisionReader,
    services: SystemServices = defaultServices
  ) {
    this.services = services
    this.contextResolver = new ContextResolver(p, revisions.sourceRepositoryPath)
    this.gitWriter = new GitRepositoryWriter(
      revisions.sourceRepositoryPath,
      revisions.runtimeDirectory
    )
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

  async revisionCurrent(): Promise<RepositoryRevisionRow> {
    const revision = await this.revisions.current()
    return upsertRepositoryRevision(this.p, {
      id: this.services.nextId('rev_'),
      baseCommit: revision.baseCommit,
      treeHash: revision.treeHash,
      workingTreePatchHash: revision.workingTreePatchHash
    })
  }

  async freezeSnapshot(
    payload: CommandInput<'snapshot.freeze'>
  ): Promise<FreezeContextSnapshotResult> {
    requireRepositoryRevision(this.p, payload.expectedRepositoryRevisionId)
    const scope = {
      projectId: payload.projectId,
      taskId: payload.taskId,
      taskSpecVersionId: payload.taskSpecVersionId,
      baseBaselineId: payload.baseBaselineId,
      expectedRepositoryRevisionId: payload.expectedRepositoryRevisionId
    }
    const resolved = await this.contextResolver.materialize(scope, payload.selections)
    return freezeContextSnapshot(this.p, {
      id: this.services.nextId('snap_'),
      projectId: scope.projectId,
      taskId: scope.taskId,
      taskSpecVersionId: scope.taskSpecVersionId,
      baseBaselineId: scope.baseBaselineId,
      expectedRepositoryRevisionId: scope.expectedRepositoryRevisionId,
      items: toFreezeItems(resolved)
    })
  }

  async resolveContext(
    payload: CommandInput<'context.resolve'>
  ): Promise<{ items: ResolvedContextItem[] }> {
    const scope = {
      projectId: payload.projectId,
      taskId: payload.taskId,
      taskSpecVersionId: payload.taskSpecVersionId,
      baseBaselineId: payload.baseBaselineId,
      expectedRepositoryRevisionId: payload.expectedRepositoryRevisionId
    }
    const items: ResolvedContextItem[] = []
    for (const ref of payload.selections) {
      items.push(await this.contextResolver.resolve(scope, ref))
    }
    return { items }
  }

  listRuns(payload: CommandInput<'run.list'>): RunSummaryRow[] {
    return listRuns(this.p, payload.projectId)
  }

  getRun(payload: CommandInput<'run.get'>): RunAggregateView {
    return getRunAggregate(this.p, payload.runId)
  }

  evaluateAcceptance(payload: CommandInput<'acceptance.evaluate'>): AcceptanceEvaluationAggregate {
    return createAcceptanceEvaluation(this.p, payload)
  }

  listAcceptance(payload: CommandInput<'acceptance.list'>): AcceptanceEvaluationAggregate[] {
    return listAcceptanceEvaluations(this.p, payload.taskId)
  }

  completeTask(payload: CommandInput<'task.complete'>): TaskRow {
    return completeTask(this.p, payload)
  }

  // --- Phase 4 #5: Result adoption + baseline candidate ------------------------

  async applyArtifact(
    payload: CommandInput<'artifact.apply'>
  ): Promise<ArtifactApplicationAggregate> {
    const existing = listArtifactApplicationAggregates(this.p, payload.taskId)[0]
    if (existing !== undefined) {
      // P0-2: a retry is only safe with the exact same binding.
      if (
        existing.application.evaluationId !== payload.evaluationId ||
        existing.application.artifactId !== payload.artifactId
      ) {
        throw new ValidationError('artifact_application_binding_conflict')
      }
      if (existing.effectiveStatus === 'APPLIED') {
        return existing
      }
      if (
        existing.effectiveStatus === 'AUTHORIZED' ||
        existing.effectiveStatus === 'APPLYING' ||
        existing.effectiveStatus === 'INTERRUPTED'
      ) {
        return this.reconcileApplication(existing)
      }
      throw new ValidationError(
        `application for task ${payload.taskId} is ${existing.effectiveStatus}`
      )
    }
    return this.authorizeAndApply(payload)
  }

  listArtifactApplications(
    payload: CommandInput<'artifactApplication.list'>
  ): ArtifactApplicationAggregate[] {
    return listArtifactApplicationAggregates(this.p, payload.taskId)
  }

  async createBaselineCandidate(
    payload: CommandInput<'baseline.createCandidateFromTask'>
  ): Promise<BaselineCandidateAggregate> {
    // P0-6: the candidate may only be materialized when the real repository is
    // still exactly the APPLIED application's result revision (and clean).
    const aggregate = getArtifactApplicationAggregate(this.p, payload.applicationId)
    if (aggregate.effectiveStatus !== 'APPLIED') {
      throw new ValidationError('baseline candidate requires an APPLIED artifact application')
    }
    const revision = aggregate.repositoryRevision
    if (revision === null) {
      throw new ValidationError('APPLIED application has no resulting repository revision')
    }
    const current = await this.revisions.current()
    if (
      current.baseCommit !== revision.baseCommit ||
      current.treeHash !== revision.treeHash ||
      current.workingTreePatchHash !== null
    ) {
      throw new ValidationError(
        'application result repository revision does not match the real repository'
      )
    }
    return createCandidateBaseline(this.p, payload)
  }

  async activateBaseline(
    payload: CommandInput<'baseline.activate'>
  ): Promise<ActivateBaselineResult> {
    assertCandidateActivationValid(this.p, payload.baselineId)
    const source = requireBaselineCandidateSource(this.p, payload.baselineId)
    if (source !== undefined) {
      const candidate = getBaseline(this.p, payload.baselineId)
      const revision =
        candidate.repositoryRevisionId === null
          ? null
          : requireRepositoryRevision(this.p, candidate.repositoryRevisionId)
      if (revision === null) {
        throw new ValidationError('candidate baseline has no repository revision')
      }
      const current = await this.revisions.current()
      if (
        current.baseCommit !== revision.baseCommit ||
        current.treeHash !== revision.treeHash ||
        current.workingTreePatchHash !== null
      ) {
        throw new ValidationError('baseline repository revision does not match the real repository')
      }
    }
    return activateBaseline(this.p, { baselineId: payload.baselineId })
  }

  private async authorizeAndApply(
    payload: CommandInput<'artifact.apply'>
  ): Promise<ArtifactApplicationAggregate> {
    const { taskId, evaluationId, artifactId } = payload
    const task = requireTask(this.p, taskId)
    if (task.status !== 'COMPLETED') {
      throw new ValidationError(`Task ${taskId} is not COMPLETED and cannot be adopted`)
    }
    const evaluation = requireAcceptanceEvaluation(this.p, evaluationId)
    if (evaluation.taskId !== taskId) {
      throw new ValidationError(
        `AcceptanceEvaluation ${evaluationId} does not belong to Task ${taskId}`
      )
    }
    const latestEvaluation = latestAcceptanceEvaluationForTask(this.p, taskId)
    if (latestEvaluation === undefined || latestEvaluation.id !== evaluationId) {
      throw new ValidationError('adoption requires the latest PASSED acceptance evaluation')
    }
    if (evaluation.status !== 'PASSED') {
      throw new ValidationError('adoption requires a PASSED acceptance evaluation')
    }
    const latestSpec = listTaskSpecVersions(this.p, taskId).at(-1)
    if (latestSpec === undefined || latestSpec.id !== evaluation.taskSpecVersionId) {
      throw new ValidationError('adoption evaluation must reference the latest TaskSpecVersion')
    }
    const run = requireRun(this.p, evaluation.runId)
    const usableOutcomes = new Set(['SUCCEEDED', 'PARTIAL', 'TIMED_OUT'])
    if (run.status !== 'FINISHED' || !usableOutcomes.has(run.outcome ?? '')) {
      throw new ValidationError(`Run ${run.id} is not a usable FINISHED run`)
    }
    if (run.taskId !== taskId || run.taskSpecVersionId !== evaluation.taskSpecVersionId) {
      throw new ValidationError('Run does not match the evaluated Task / TaskSpecVersion')
    }

    const aggregate = getRunAggregate(this.p, run.id)
    const artifact = aggregate.artifacts.find((item) => item.id === artifactId)
    if (artifact === undefined) {
      throw new NotFoundError('Artifact', artifactId)
    }
    if (artifact.kind !== 'PATCH') {
      throw new ValidationError('adoption requires a PATCH artifact')
    }
    if (artifact.runId !== run.id) {
      throw new ValidationError('artifact does not belong to the Run')
    }
    const request = aggregate.executionRequests.find(
      (candidate) => candidate.executionRequestId === artifact.executionRequestId
    )
    if (request === undefined) {
      throw new ValidationError('artifact does not belong to the Run execution')
    }
    if (sha256Hex(artifact.content) !== artifact.contentHash) {
      throw new ValidationError('artifact content hash mismatch')
    }
    if (artifact.sizeBytes !== Buffer.byteLength(artifact.content, 'utf8')) {
      throw new ValidationError('artifact size mismatch')
    }
    if (request.patchHash !== null && artifact.contentHash !== request.patchHash) {
      throw new ValidationError('artifact does not match the request patch hash')
    }
    if (artifact.content.length === 0) {
      throw new ValidationError('patch content is empty')
    }

    const runRevision = requireRepositoryRevision(this.p, run.repositoryRevisionId)
    if (runRevision.workingTreePatchHash !== null) {
      throw new ValidationError('dirty_run_revision_adoption_unsupported')
    }
    const current = await this.revisions.current()
    if (
      current.baseCommit !== runRevision.baseCommit ||
      current.treeHash !== runRevision.treeHash ||
      current.workingTreePatchHash !== null
    ) {
      throw new ValidationError('current repository does not match the Run revision')
    }
    const snapshot = getSnapshot(this.p, run.contextSnapshotId)
    const activeBaseline = getActiveBaseline(this.p, task.projectId)
    if (activeBaseline === undefined || activeBaseline.id !== snapshot.baseBaselineId) {
      throw new ValidationError('application base baseline is no longer the active baseline')
    }

    const authorizedAt = this.services.now()
    const applicationId = this.services.nextId('app_')
    createArtifactApplication(this.p, {
      id: applicationId,
      projectId: task.projectId,
      taskId,
      evaluationId,
      runId: run.id,
      executionRequestId: request.executionRequestId,
      artifactId: artifact.id,
      baseBaselineId: snapshot.baseBaselineId,
      baseRepositoryRevisionId: run.repositoryRevisionId,
      patchHash: artifact.contentHash,
      authorizedAt
    })
    markApplicationApplying(this.p, applicationId, this.services.now())

    let applied: AppliedRevisionResult
    try {
      applied = await this.gitWriter.applyAcceptedPatch({
        applicationId,
        baseCommit: runRevision.baseCommit,
        patchContent: artifact.content,
        patchHash: artifact.contentHash,
        taskId,
        runId: run.id,
        artifactId: artifact.id,
        authorizedAt
      })
    } catch (error) {
      return this.handleApplyFailure(applicationId, runRevision.baseCommit, error)
    }
    return finalizeApplicationApplied(this.p, {
      applicationId,
      baseCommit: applied.baseCommit,
      treeHash: applied.treeHash,
      workingTreePatchHash: applied.workingTreePatchHash,
      now: this.services.now()
    })
  }

  private async reconcileApplication(
    existing: ArtifactApplicationAggregate
  ): Promise<ArtifactApplicationAggregate> {
    const application = existing.application
    const baseRevision = requireRepositoryRevision(this.p, application.baseRepositoryRevisionId)
    const head = await this.gitWriter.inspectHead()

    const trailersMatch =
      head.message.includes(`Canvas-Agent-Application: ${application.id}`) &&
      head.message.includes(`Canvas-Agent-Artifact: ${application.artifactId}`) &&
      head.message.includes(`Canvas-Agent-Patch-SHA256: ${application.patchHash}`)

    if (head.baseCommit === baseRevision.baseCommit && head.clean) {
      // Case A: no side effect happened; retry the writer.
      markApplicationApplying(this.p, application.id, this.services.now())
      const artifactContent = this.readArtifactContent(application.runId, application.artifactId)
      let applied: AppliedRevisionResult
      try {
        applied = await this.gitWriter.applyAcceptedPatch({
          applicationId: application.id,
          baseCommit: baseRevision.baseCommit,
          patchContent: artifactContent,
          patchHash: application.patchHash,
          taskId: application.taskId,
          runId: application.runId,
          artifactId: application.artifactId,
          authorizedAt: application.authorizedAt
        })
      } catch (error) {
        return this.handleApplyFailure(application.id, baseRevision.baseCommit, error)
      }
      return finalizeApplicationApplied(this.p, {
        applicationId: application.id,
        baseCommit: applied.baseCommit,
        treeHash: applied.treeHash,
        workingTreePatchHash: applied.workingTreePatchHash,
        now: this.services.now()
      })
    }

    if (head.parent === baseRevision.baseCommit && head.clean && trailersMatch) {
      // Case B: the adoption commit already exists; finalize the DB, never reapply.
      const revision = await this.gitWriter.currentRevision()
      return finalizeApplicationApplied(this.p, {
        applicationId: application.id,
        baseCommit: revision.baseCommit,
        treeHash: revision.treeHash,
        workingTreePatchHash: revision.workingTreePatchHash,
        now: this.services.now()
      })
    }

    interruptApplication(this.p, {
      applicationId: application.id,
      reasonCode: 'application_recovery_conflict',
      detail: 'Git HEAD does not match the base or a recognized adoption commit',
      now: this.services.now()
    })
    throw new ValidationError('application_recovery_conflict')
  }

  private async handleApplyFailure(
    applicationId: string,
    baseCommit: string,
    error: unknown
  ): Promise<ArtifactApplicationAggregate> {
    const head = await this.gitWriter.inspectHead().catch(() => null)
    if (head !== null && head.baseCommit === baseCommit && head.clean) {
      failApplication(this.p, {
        applicationId,
        reasonCode: 'adoption_apply_failed',
        detail: error instanceof Error ? error.message : String(error),
        now: this.services.now()
      })
      throw error
    }
    interruptApplication(this.p, {
      applicationId,
      reasonCode: 'adoption_apply_interrupted',
      detail: error instanceof Error ? error.message : String(error),
      now: this.services.now()
    })
    throw error
  }

  private readArtifactContent(runId: string, artifactId: string): string {
    // Artifact content is always re-read from the persisted run aggregate,
    // never from an untrusted path.
    const aggregate = getRunAggregate(this.p, runId)
    const artifact = aggregate.artifacts.find((item) => item.id === artifactId)
    if (artifact === undefined) {
      throw new NotFoundError('Artifact', artifactId)
    }
    return artifact.content
  }
}

interface AppliedRevisionResult {
  baseCommit: string
  treeHash: string
  workingTreePatchHash: string | null
}

function toFreezeItems(items: readonly ResolvedContextItem[]): FreezeContextSnapshotInputItems {
  return items.map((item, position) => ({
    itemType: item.itemType,
    sourceRef: item.sourceRef,
    resolvedContent: item.resolvedContent,
    selectionReason: item.selectionReason ?? null,
    authority: item.authority,
    priority: item.priority,
    tokenEstimate: item.tokenEstimate,
    position
  }))
}

type FreezeContextSnapshotInputItems = Parameters<typeof freezeContextSnapshot>[1]['items']
