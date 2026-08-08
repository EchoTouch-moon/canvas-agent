import { desc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { withTransaction } from '../db'
import { NotFoundError, ValidationError } from '../errors'
import {
  artifactApplicationEventTable,
  artifactApplicationTable,
  baselineCandidateSourceTable,
  type ApplicationEventKind,
  type ArtifactApplicationEventRow,
  type ArtifactApplicationRow,
  type BaselineCandidateSourceRow,
  type BaselineItemRow,
  type ProjectBaselineRow,
  type RepositoryRevisionRow
} from '../schema'
import {
  getActiveBaseline,
  getBaseline,
  insertBaselineDraft,
  listBaselineItems
} from './baseline'
import { requireRepositoryRevision, upsertRepositoryRevision } from './repository-revision'
import { appendAudit } from './audit'

export interface ArtifactApplicationAggregate {
  application: ArtifactApplicationRow
  events: ArtifactApplicationEventRow[]
  effectiveStatus: ApplicationEventKind
  repositoryRevision: RepositoryRevisionRow | null
}

export interface CreateArtifactApplicationInput {
  id: string
  projectId: string
  taskId: string
  evaluationId: string
  runId: string
  executionRequestId: string
  artifactId: string
  baseBaselineId: string
  baseRepositoryRevisionId: string
  patchHash: string
  authorizedAt: string
}

function appendApplicationEvent(
  p: Persistence,
  input: {
    applicationId: string
    kind: ApplicationEventKind
    repositoryRevisionId?: string | null
    reasonCode?: string | null
    detail?: string | null
    createdAt: string
  }
): ArtifactApplicationEventRow {
  const last = p.drizzle
    .select()
    .from(artifactApplicationEventTable)
    .where(eq(artifactApplicationEventTable.applicationId, input.applicationId))
    .orderBy(desc(artifactApplicationEventTable.sequence))
    .limit(1)
    .get()
  const inserted = p.drizzle
    .insert(artifactApplicationEventTable)
    .values({
      id: p.services.nextId('artifact_application_event'),
      applicationId: input.applicationId,
      sequence: (last?.sequence ?? -1) + 1,
      kind: input.kind,
      repositoryRevisionId: input.repositoryRevisionId ?? null,
      reasonCode: input.reasonCode ?? null,
      detail: input.detail ?? null,
      createdAt: input.createdAt
    })
    .returning()
    .all()[0]
  if (inserted === undefined) {
    throw new Error('artifact_application_event insert returned no row')
  }
  return inserted
}

export function requireArtifactApplication(p: Persistence, applicationId: string): ArtifactApplicationRow {
  const row = p.drizzle
    .select()
    .from(artifactApplicationTable)
    .where(eq(artifactApplicationTable.id, applicationId))
    .get()
  if (row === undefined) {
    throw new NotFoundError('ArtifactApplication', applicationId)
  }
  return row
}

export function getArtifactApplicationAggregate(
  p: Persistence,
  applicationId: string
): ArtifactApplicationAggregate {
  const application = requireArtifactApplication(p, applicationId)
  return buildAggregate(p, application)
}

export function listArtifactApplicationAggregates(
  p: Persistence,
  taskId: string
): ArtifactApplicationAggregate[] {
  return p.drizzle
    .select()
    .from(artifactApplicationTable)
    .where(eq(artifactApplicationTable.taskId, taskId))
    .all()
    .map((application) => buildAggregate(p, application))
}

function buildAggregate(p: Persistence, application: ArtifactApplicationRow): ArtifactApplicationAggregate {
  const events = p.drizzle
    .select()
    .from(artifactApplicationEventTable)
    .where(eq(artifactApplicationEventTable.applicationId, application.id))
    .orderBy(artifactApplicationEventTable.sequence)
    .all()
  const latest = events[events.length - 1]
  const repositoryRevision =
    latest?.repositoryRevisionId === null || latest?.repositoryRevisionId === undefined
      ? null
      : requireRepositoryRevision(p, latest.repositoryRevisionId)
  return {
    application,
    events,
    effectiveStatus: (latest?.kind ?? 'AUTHORIZED') as ApplicationEventKind,
    repositoryRevision
  }
}

// Immutable authorization binding + AUTHORIZED event, one transaction. One
// logical application per Task and per PATCH (DB uniqueness is the backstop).
export function createArtifactApplication(
  p: Persistence,
  input: CreateArtifactApplicationInput
): ArtifactApplicationAggregate {
  return withTransaction(p, () => {
    const inserted = p.drizzle
      .insert(artifactApplicationTable)
      .values({
        id: input.id,
        projectId: input.projectId,
        taskId: input.taskId,
        evaluationId: input.evaluationId,
        runId: input.runId,
        executionRequestId: input.executionRequestId,
        artifactId: input.artifactId,
        baseBaselineId: input.baseBaselineId,
        baseRepositoryRevisionId: input.baseRepositoryRevisionId,
        patchHash: input.patchHash,
        authorizedAt: input.authorizedAt
      })
      .returning()
      .all()[0]
    if (inserted === undefined) {
      throw new Error('artifact_application insert returned no row')
    }
    appendApplicationEvent(p, {
      applicationId: inserted.id,
      kind: 'AUTHORIZED',
      createdAt: input.authorizedAt
    })
    appendAudit(p, {
      projectId: input.projectId,
      entityType: 'ArtifactApplication',
      entityId: inserted.id,
      action: 'ARTIFACT_APPLY_AUTHORIZED',
      payload: {
        taskId: input.taskId,
        evaluationId: input.evaluationId,
        runId: input.runId,
        artifactId: input.artifactId,
        patchHash: input.patchHash
      }
    })
    return buildAggregate(p, inserted)
  })
}

export function markApplicationApplying(p: Persistence, applicationId: string, now: string): void {
  appendApplicationEvent(p, { applicationId, kind: 'APPLYING', createdAt: now })
}

export interface FinalizeApplicationInput {
  applicationId: string
  baseCommit: string
  treeHash: string
  workingTreePatchHash: string | null
  now: string
}

// Upsert the resulting RepositoryRevision and append APPLIED in one transaction.
export function finalizeApplicationApplied(
  p: Persistence,
  input: FinalizeApplicationInput
): ArtifactApplicationAggregate {
  return withTransaction(p, () => {
    const revisionRow = upsertRepositoryRevision(p, {
      id: p.services.nextId('rev_'),
      baseCommit: input.baseCommit,
      treeHash: input.treeHash,
      workingTreePatchHash: input.workingTreePatchHash ?? null
    })
    const application = requireArtifactApplication(p, input.applicationId)
    appendApplicationEvent(p, {
      applicationId: input.applicationId,
      kind: 'APPLIED',
      repositoryRevisionId: revisionRow.id,
      createdAt: input.now
    })
    appendAudit(p, {
      projectId: application.projectId,
      entityType: 'ArtifactApplication',
      entityId: input.applicationId,
      action: 'ARTIFACT_APPLY_APPLIED',
      payload: { repositoryRevisionId: revisionRow.id }
    })
    return buildAggregate(p, application)
  })
}

export interface FailApplicationInput {
  applicationId: string
  reasonCode: string
  detail?: string | null
  now: string
}

export function failApplication(p: Persistence, input: FailApplicationInput): void {
  appendApplicationEvent(p, {
    applicationId: input.applicationId,
    kind: 'FAILED',
    reasonCode: input.reasonCode,
    detail: input.detail ?? null,
    createdAt: input.now
  })
}

export interface InterruptApplicationInput {
  applicationId: string
  reasonCode: string
  detail?: string | null
  now: string
}

export function interruptApplication(p: Persistence, input: InterruptApplicationInput): void {
  appendApplicationEvent(p, {
    applicationId: input.applicationId,
    kind: 'INTERRUPTED',
    reasonCode: input.reasonCode,
    detail: input.detail ?? null,
    createdAt: input.now
  })
}

// --- Baseline candidate -------------------------------------------------------

export interface BaselineCandidateAggregate {
  baseline: ProjectBaselineRow
  source: BaselineCandidateSourceRow
  items: BaselineItemRow[]
}

export interface CreateBaselineCandidateInput {
  applicationId: string
  name: string
  description?: string | null
}

export function requireBaselineCandidateSource(
  p: Persistence,
  baselineId: string
): BaselineCandidateSourceRow | undefined {
  return p.drizzle
    .select()
    .from(baselineCandidateSourceTable)
    .where(eq(baselineCandidateSourceTable.baselineId, baselineId))
    .get()
}

// One candidate per application (idempotent); an APPLIED application whose base
// baseline is still ACTIVE; the parent NodeVersion set is copied exactly.
export function createBaselineCandidate(
  p: Persistence,
  input: CreateBaselineCandidateInput
): BaselineCandidateAggregate {
  return withTransaction(p, () => {
    const existing = p.drizzle
      .select()
      .from(baselineCandidateSourceTable)
      .where(eq(baselineCandidateSourceTable.artifactApplicationId, input.applicationId))
      .get()
    if (existing !== undefined) {
      const baseline = getBaseline(p, existing.baselineId)
      if (input.name !== baseline.name) {
        throw new ValidationError(
          `candidate already exists for application ${input.applicationId} with a different name`
        )
      }
      return { baseline, source: existing, items: listBaselineItems(p, baseline.id) }
    }

    const application = requireArtifactApplication(p, input.applicationId)
    const events = p.drizzle
      .select()
      .from(artifactApplicationEventTable)
      .where(eq(artifactApplicationEventTable.applicationId, input.applicationId))
      .orderBy(desc(artifactApplicationEventTable.sequence))
      .limit(1)
      .get()
    if (events?.kind !== 'APPLIED') {
      throw new ValidationError('baseline candidate requires an APPLIED artifact application')
    }
    if (events.repositoryRevisionId === null || events.repositoryRevisionId === undefined) {
      throw new ValidationError('APPLIED application has no resulting repository revision')
    }
    const active = getActiveBaseline(p, application.projectId)
    if (active === undefined || active.id !== application.baseBaselineId) {
      throw new ValidationError('application base baseline is no longer the active baseline')
    }

    const parentItems = listBaselineItems(p, application.baseBaselineId)
    const baseline = insertBaselineDraft(p, {
      id: p.services.nextId('baseline_'),
      projectId: application.projectId,
      name: input.name,
      description: input.description ?? null,
      repositoryRevisionId: events.repositoryRevisionId,
      nodeVersionIds: parentItems.map((item) => item.nodeVersionId)
    })
    const source = p.drizzle
      .insert(baselineCandidateSourceTable)
      .values({
        baselineId: baseline.id,
        parentBaselineId: application.baseBaselineId,
        taskId: application.taskId,
        artifactApplicationId: application.id
      })
      .returning()
      .all()[0]
    if (source === undefined) {
      throw new Error('baseline_candidate_source insert returned no row')
    }
    return { baseline, source, items: listBaselineItems(p, baseline.id) }
  })
}

// Guard for a candidate baseline before activation: the current ACTIVE baseline
// must still be the candidate's parent (stale-candidate rejection).
export function assertCandidateActivationValid(p: Persistence, baselineId: string): void {
  const source = requireBaselineCandidateSource(p, baselineId)
  if (source === undefined) {
    return
  }
  const active = getActiveBaseline(p, requireBaselineParentProject(p, baselineId))
  if (active === undefined || active.id !== source.parentBaselineId) {
    throw new ValidationError('baseline_candidate_parent_is_stale')
  }
}

function requireBaselineParentProject(p: Persistence, baselineId: string): string {
  const baseline = getBaseline(p, baselineId)
  return baseline.projectId
}
