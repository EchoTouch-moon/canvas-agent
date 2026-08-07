import { asc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { withTransaction } from '../db'
import { NotFoundError, ValidationError } from '../errors'
import { contextSnapshotItemTable, contextSnapshotTable, contentBlobTable } from '../schema'
import type { ContentBlobRow, ContextSnapshotItemRow, ContextSnapshotRow } from '../schema'
import { sha256Hex } from '../services'
import type { ContextAuthority, ContextItemType, ContextPriority } from '@canvas-agent/domain'
import { appendAudit } from './audit'
import { getBaseline } from './baseline'
import { requireRepositoryRevision } from './repository-revision'
import { requireTask, requireTaskSpecVersion } from './task'

export interface ContextSnapshotItemInput {
  itemType: ContextItemType
  sourceRef: string
  resolvedContent: string
  selectionReason?: string | null
  authority: ContextAuthority
  priority?: ContextPriority
  tokenEstimate: number
  blobId?: string | null
  position: number
}

export interface FreezeContextSnapshotInput {
  id: string
  projectId: string
  taskId: string
  taskSpecVersionId: string
  baseBaselineId: string
  expectedRepositoryRevisionId: string
  items: ContextSnapshotItemInput[]
}

export interface FreezeContextSnapshotResult {
  snapshot: ContextSnapshotRow
  items: ContextSnapshotItemRow[]
}

export function freezeContextSnapshot(p: Persistence, input: FreezeContextSnapshotInput): FreezeContextSnapshotResult {
  const task = requireTask(p, input.taskId)
  if (task.projectId !== input.projectId) {
    throw new ValidationError(`Task ${input.taskId} does not belong to Project ${input.projectId}`)
  }
  const spec = requireTaskSpecVersion(p, input.taskSpecVersionId)
  if (spec.taskId !== input.taskId) {
    throw new ValidationError(`TaskSpecVersion ${input.taskSpecVersionId} does not belong to Task ${input.taskId}`)
  }
  const baseline = getBaseline(p, input.baseBaselineId)
  if (baseline.projectId !== input.projectId) {
    throw new ValidationError(`ProjectBaseline ${input.baseBaselineId} does not belong to Project ${input.projectId}`)
  }
  if (baseline.status !== 'ACTIVE') {
    throw new ValidationError(`ProjectBaseline ${input.baseBaselineId} is not ACTIVE and cannot be pinned by a snapshot`)
  }
  requireRepositoryRevision(p, input.expectedRepositoryRevisionId)

  return withTransaction(p, () => {
    const now = p.services.now()
    const insertedDraft = p.drizzle
      .insert(contextSnapshotTable)
      .values({
        id: input.id,
        projectId: input.projectId,
        taskId: input.taskId,
        taskSpecVersionId: input.taskSpecVersionId,
        baseBaselineId: input.baseBaselineId,
        expectedRepositoryRevisionId: input.expectedRepositoryRevisionId,
        status: 'DRAFT',
        freshness: 'CURRENT',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .all()[0]

    if (insertedDraft === undefined) {
      throw new Error(`context_snapshot insert returned no row for ${input.id}`)
    }

    const items: ContextSnapshotItemRow[] = []
    for (const item of input.items) {
      const contentHash = sha256Hex(item.resolvedContent)
      const inserted = p.drizzle
        .insert(contextSnapshotItemTable)
        .values({
          id: p.services.nextId('context_snapshot_item'),
          contextSnapshotId: input.id,
          position: item.position,
          itemType: item.itemType,
          sourceRef: item.sourceRef,
          resolvedContent: item.resolvedContent,
          contentHash,
          selectionReason: item.selectionReason ?? null,
          authority: item.authority,
          priority: item.priority ?? 'P2',
          tokenEstimate: item.tokenEstimate,
          blobId: item.blobId ?? null
        })
        .returning()
        .all()[0]
      if (inserted === undefined) {
        throw new Error(`context_snapshot_item insert returned no row for ${input.id}`)
      }
      items.push(inserted)
    }

    const snapshot = p.drizzle
      .update(contextSnapshotTable)
      .set({ status: 'FROZEN', updatedAt: now })
      .where(eq(contextSnapshotTable.id, input.id))
      .returning()
      .all()[0]

    if (snapshot === undefined || snapshot.status !== 'FROZEN') {
      throw new Error(`context_snapshot freeze returned no row for ${input.id}`)
    }

    appendAudit(p, {
      projectId: input.projectId,
      entityType: 'ContextSnapshot',
      entityId: snapshot.id,
      action: 'SNAPSHOT_FROZEN',
      payload: {
        taskId: input.taskId,
        taskSpecVersionId: input.taskSpecVersionId,
        baseBaselineId: input.baseBaselineId,
        expectedRepositoryRevisionId: input.expectedRepositoryRevisionId,
        itemCount: items.length
      }
    })

    return { snapshot, items }
  })
}

export function getSnapshot(p: Persistence, id: string): ContextSnapshotRow {
  const row = p.drizzle.select().from(contextSnapshotTable).where(eq(contextSnapshotTable.id, id)).get()
  if (row === undefined) {
    throw new NotFoundError('ContextSnapshot', id)
  }
  return row
}

export function listSnapshotItems(p: Persistence, snapshotId: string): ContextSnapshotItemRow[] {
  return p.drizzle
    .select()
    .from(contextSnapshotItemTable)
    .where(eq(contextSnapshotItemTable.contextSnapshotId, snapshotId))
    .orderBy(asc(contextSnapshotItemTable.position))
    .all()
}

export interface RegisterContentBlobInput {
  id: string
  sizeBytes: number
  contentType: string
}

export function registerContentBlob(p: Persistence, input: RegisterContentBlobInput): ContentBlobRow {
  const inserted = p.drizzle
    .insert(contentBlobTable)
    .values({
      id: input.id,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      createdAt: p.services.now()
    })
    .returning()
    .all()[0]

  if (inserted === undefined) {
    throw new Error(`content_blob insert returned no row for ${input.id}`)
  }
  return inserted
}
