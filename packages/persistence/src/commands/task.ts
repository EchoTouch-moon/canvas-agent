import { asc, desc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { withTransaction } from '../db'
import { ConcurrencyError, CycleError, NotFoundError, ValidationError } from '../errors'
import {
  acceptanceCriterionTable,
  taskDependencyTable,
  taskDraftTable,
  taskSpecVersionTable,
  taskTargetTable,
  taskTable,
  type VerificationMethod
} from '../schema'
import type {
  AcceptanceCriterionRow,
  TaskDependencyRow,
  TaskDraftRow,
  TaskRow,
  TaskSpecVersionRow,
  TaskTargetRow
} from '../schema'
import { taskSpecContentHash } from '../services'
import type { TaskType } from '@canvas-agent/domain'
import { appendAudit } from './audit'
import { requireNode, requireNodeVersion } from './node'

export interface CreateTaskInput {
  id: string
  projectId: string
  type: TaskType
  title: string
}

export function createTask(p: Persistence, input: CreateTaskInput): TaskRow {
  const now = p.services.now()
  const created = p.drizzle
    .insert(taskTable)
    .values({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      status: 'DRAFT',
      title: input.title,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`task insert returned no row for ${input.id}`)
  }

  appendAudit(p, {
    projectId: input.projectId,
    entityType: 'Task',
    entityId: input.id,
    action: 'TASK_CREATED',
    payload: { type: input.type, title: input.title }
  })

  return created
}

export interface UpsertTaskDraftInput {
  draftId?: string
  taskId: string
  description?: string
  scope?: string
  expectedRevision?: number
}

export function upsertTaskDraft(p: Persistence, input: UpsertTaskDraftInput): TaskDraftRow {
  const task = p.drizzle.select().from(taskTable).where(eq(taskTable.id, input.taskId)).get()
  if (task === undefined) {
    throw new NotFoundError('Task', input.taskId)
  }

  const existing = p.drizzle
    .select()
    .from(taskDraftTable)
    .where(eq(taskDraftTable.taskId, input.taskId))
    .get()

  if (existing === undefined) {
    const created = p.drizzle
      .insert(taskDraftTable)
      .values({
        id: input.draftId ?? p.services.nextId('task_draft'),
        taskId: input.taskId,
        description: input.description ?? '',
        scope: input.scope ?? '',
        revision: 1,
        updatedAt: p.services.now()
      })
      .returning()
      .all()[0]

    if (created === undefined) {
      throw new Error(`task_draft insert returned no row for ${input.taskId}`)
    }

    touchTask(p, input.taskId)
    appendAudit(p, {
      projectId: task.projectId,
      entityType: 'TaskDraft',
      entityId: created.id,
      action: 'TASK_DRAFT_UPSERTED',
      payload: { revision: created.revision, taskId: input.taskId }
    })
    return created
  }

  const expected = input.expectedRevision ?? existing.revision
  if (expected !== existing.revision) {
    throw new ConcurrencyError('TaskDraft', existing.id, expected, existing.revision)
  }

  const updated = p.drizzle
    .update(taskDraftTable)
    .set({
      description: input.description ?? existing.description,
      scope: input.scope ?? existing.scope,
      revision: existing.revision + 1,
      updatedAt: p.services.now()
    })
    .where(eq(taskDraftTable.id, existing.id))
    .returning()
    .all()[0]

  if (updated === undefined) {
    throw new Error(`task_draft update returned no row for ${existing.id}`)
  }

  touchTask(p, input.taskId)
  appendAudit(p, {
    projectId: task.projectId,
    entityType: 'TaskDraft',
    entityId: updated.id,
    action: 'TASK_DRAFT_UPSERTED',
    payload: { revision: updated.revision, taskId: input.taskId }
  })

  return updated
}

export interface TaskTargetInput {
  nodeId?: string | null
  nodeVersionId?: string | null
  position: number
}

export interface AcceptanceCriterionInput {
  description: string
  verificationMethod?: VerificationMethod
  position: number
}

export interface PublishTaskSpecVersionInput {
  id: string
  taskId: string
  description: string
  scope: string
  targets?: TaskTargetInput[]
  criteria: AcceptanceCriterionInput[]
}

export interface PublishTaskSpecVersionResult {
  spec: TaskSpecVersionRow
  criteria: AcceptanceCriterionRow[]
}

export function publishTaskSpecVersion(p: Persistence, input: PublishTaskSpecVersionInput): PublishTaskSpecVersionResult {
  if (input.criteria.length === 0) {
    throw new ValidationError('A TaskSpecVersion must carry at least one AcceptanceCriterion')
  }
  const task = p.drizzle.select().from(taskTable).where(eq(taskTable.id, input.taskId)).get()
  if (task === undefined) {
    throw new NotFoundError('Task', input.taskId)
  }
  for (const target of input.targets ?? []) {
    if (target.nodeId !== null && target.nodeId !== undefined) {
      requireNode(p, target.nodeId)
    }
    if (target.nodeVersionId !== null && target.nodeVersionId !== undefined) {
      requireNodeVersion(p, target.nodeVersionId)
    }
  }

  const lastSequence = p.drizzle
    .select()
    .from(taskSpecVersionTable)
    .where(eq(taskSpecVersionTable.taskId, input.taskId))
    .orderBy(desc(taskSpecVersionTable.sequence))
    .limit(1)
    .get()
  const sequence = (lastSequence?.sequence ?? 0) + 1

  const contentHash = taskSpecContentHash(
    input.description,
    input.scope,
    (input.targets ?? []).map((target) =>
      JSON.stringify({
        nodeId: target.nodeId ?? null,
        nodeVersionId: target.nodeVersionId ?? null,
        position: target.position
      })
    ),
    input.criteria.map((criterion) =>
      JSON.stringify({
        description: criterion.description,
        verificationMethod: criterion.verificationMethod ?? 'MANUAL_REVIEW',
        position: criterion.position
      })
    )
  )

  return withTransaction(p, () => {
    const spec = p.drizzle
      .insert(taskSpecVersionTable)
      .values({
        id: input.id,
        taskId: input.taskId,
        sequence,
        description: input.description,
        scope: input.scope,
        contentHash,
        createdAt: p.services.now()
      })
      .returning()
      .all()[0]

    if (spec === undefined) {
      throw new Error(`task_spec_version insert returned no row for ${input.id}`)
    }

    const criteria: AcceptanceCriterionRow[] = []
    for (const criterion of input.criteria) {
      const inserted = p.drizzle
        .insert(acceptanceCriterionTable)
        .values({
          id: p.services.nextId('acceptance_criterion'),
          taskSpecVersionId: spec.id,
          position: criterion.position,
          description: criterion.description,
          verificationMethod: criterion.verificationMethod ?? 'MANUAL_REVIEW'
        })
        .returning()
        .all()[0]
      if (inserted === undefined) {
        throw new Error(`acceptance_criterion insert returned no row for ${spec.id}`)
      }
      criteria.push(inserted)
    }

    for (const target of input.targets ?? []) {
      const inserted = p.drizzle
        .insert(taskTargetTable)
        .values({
          id: p.services.nextId('task_target'),
          taskSpecVersionId: spec.id,
          nodeId: target.nodeId ?? null,
          nodeVersionId: target.nodeVersionId ?? null,
          position: target.position
        })
        .returning()
        .all()[0]
      if (inserted === undefined) {
        throw new Error(`task_target insert returned no row for ${spec.id}`)
      }
    }

    touchTask(p, input.taskId)
    appendAudit(p, {
      projectId: task.projectId,
      entityType: 'TaskSpecVersion',
      entityId: spec.id,
      action: 'TASK_SPEC_VERSION_PUBLISHED',
      payload: { taskId: input.taskId, sequence, contentHash, criterionCount: criteria.length }
    })

    return { spec, criteria }
  })
}

export interface CreateTaskDependencyInput {
  id: string
  projectId: string
  taskId: string
  dependsOnTaskId: string
  type: 'HARD_BLOCK' | 'SOFT_ORDER'
}

export function createTaskDependency(p: Persistence, input: CreateTaskDependencyInput): TaskDependencyRow {
  const task = p.drizzle.select().from(taskTable).where(eq(taskTable.id, input.taskId)).get()
  if (task === undefined) {
    throw new NotFoundError('Task', input.taskId)
  }
  const dependsOn = p.drizzle.select().from(taskTable).where(eq(taskTable.id, input.dependsOnTaskId)).get()
  if (dependsOn === undefined) {
    throw new NotFoundError('Task', input.dependsOnTaskId)
  }

  if (input.taskId === input.dependsOnTaskId) {
    throw new CycleError('TaskDependency', input.taskId, input.dependsOnTaskId)
  }

  const dependencies = p.drizzle
    .select()
    .from(taskDependencyTable)
    .where(eq(taskDependencyTable.projectId, input.projectId))
    .all()
  const adjacency = new Map<string, string[]>()
  for (const dependency of dependencies) {
    const targets = adjacency.get(dependency.taskId) ?? []
    targets.push(dependency.dependsOnTaskId)
    adjacency.set(dependency.taskId, targets)
  }
  if (isReachable(adjacency, input.dependsOnTaskId, input.taskId)) {
    throw new CycleError('TaskDependency', input.taskId, input.dependsOnTaskId)
  }

  const created = p.drizzle
    .insert(taskDependencyTable)
    .values({
      id: input.id,
      projectId: input.projectId,
      taskId: input.taskId,
      dependsOnTaskId: input.dependsOnTaskId,
      type: input.type,
      createdAt: p.services.now()
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`task_dependency insert returned no row for ${input.id}`)
  }

  appendAudit(p, {
    projectId: input.projectId,
    entityType: 'TaskDependency',
    entityId: created.id,
    action: 'TASK_DEPENDENCY_CREATED',
    payload: { taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId, type: input.type }
  })

  return created
}

export function requireTaskSpecVersion(p: Persistence, id: string): TaskSpecVersionRow {
  const row = p.drizzle.select().from(taskSpecVersionTable).where(eq(taskSpecVersionTable.id, id)).get()
  if (row === undefined) {
    throw new NotFoundError('TaskSpecVersion', id)
  }
  return row
}

export function listTasks(p: Persistence, projectId: string): TaskRow[] {
  return p.drizzle
    .select()
    .from(taskTable)
    .where(eq(taskTable.projectId, projectId))
    .orderBy(asc(taskTable.createdAt), asc(taskTable.id))
    .all()
}

export function listTaskSpecVersions(p: Persistence, taskId: string): TaskSpecVersionRow[] {
  return p.drizzle
    .select()
    .from(taskSpecVersionTable)
    .where(eq(taskSpecVersionTable.taskId, taskId))
    .orderBy(asc(taskSpecVersionTable.sequence))
    .all()
}

export function listTaskTargets(p: Persistence, taskSpecVersionId: string): TaskTargetRow[] {
  return p.drizzle
    .select()
    .from(taskTargetTable)
    .where(eq(taskTargetTable.taskSpecVersionId, taskSpecVersionId))
    .orderBy(asc(taskTargetTable.position), asc(taskTargetTable.id))
    .all()
}

export function listCriteria(p: Persistence, taskSpecVersionId: string): AcceptanceCriterionRow[] {
  return p.drizzle
    .select()
    .from(acceptanceCriterionTable)
    .where(eq(acceptanceCriterionTable.taskSpecVersionId, taskSpecVersionId))
    .orderBy(asc(acceptanceCriterionTable.position), asc(acceptanceCriterionTable.id))
    .all()
}

function isReachable(adjacency: Map<string, string[]>, start: string, goal: string): boolean {
  const visited = new Set<string>()
  const stack: string[] = [start]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) {
      continue
    }
    if (current === goal) {
      return true
    }
    if (visited.has(current)) {
      continue
    }
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) {
      stack.push(next)
    }
  }
  return false
}

function touchTask(p: Persistence, taskId: string): void {
  p.drizzle
    .update(taskTable)
    .set({ updatedAt: p.services.now() })
    .where(eq(taskTable.id, taskId))
    .run()
}
