import { desc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { ConcurrencyError, NotFoundError } from '../errors'
import { nodeDraftTable, nodeTable, nodeVersionTable } from '../schema'
import type { NodeDraftRow, NodeRow, NodeVersionRow } from '../schema'
import { canonicalContent, sha256Hex } from '../services'
import type { NodeLifecycle, NodeType } from '@canvas-agent/domain'
import { appendAudit } from './audit'

export interface CreateNodeInput {
  id: string
  projectId: string
  type: NodeType
  lifecycle?: NodeLifecycle
}

export function createNode(p: Persistence, input: CreateNodeInput): NodeRow {
  const now = p.services.now()
  const created = p.drizzle
    .insert(nodeTable)
    .values({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      lifecycle: input.lifecycle ?? 'ACTIVE',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`node insert returned no row for ${input.id}`)
  }

  appendAudit(p, {
    projectId: input.projectId,
    entityType: 'Node',
    entityId: input.id,
    action: 'NODE_CREATED',
    payload: { type: input.type }
  })

  return created
}

export function getNode(p: Persistence, id: string): NodeRow | undefined {
  return p.drizzle.select().from(nodeTable).where(eq(nodeTable.id, id)).get()
}

export function requireNode(p: Persistence, id: string): NodeRow {
  const row = getNode(p, id)
  if (row === undefined) {
    throw new NotFoundError('Node', id)
  }
  return row
}

export interface UpsertNodeDraftInput {
  draftId?: string
  nodeId: string
  title: string
  body?: string
  expectedRevision?: number
}

export function upsertNodeDraft(p: Persistence, input: UpsertNodeDraftInput): NodeDraftRow {
  requireNode(p, input.nodeId)
  const existing = p.drizzle
    .select()
    .from(nodeDraftTable)
    .where(eq(nodeDraftTable.nodeId, input.nodeId))
    .get()

  if (existing === undefined) {
    const created = p.drizzle
      .insert(nodeDraftTable)
      .values({
        id: input.draftId ?? p.services.nextId('node_draft'),
        nodeId: input.nodeId,
        title: input.title,
        body: input.body ?? '',
        revision: 1,
        updatedAt: p.services.now()
      })
      .returning()
      .all()[0]

    if (created === undefined) {
      throw new Error(`node_draft insert returned no row for ${input.nodeId}`)
    }

    touchNode(p, input.nodeId)
    appendAudit(p, {
      projectId: projectIdOfNode(p, input.nodeId) ?? null,
      entityType: 'NodeDraft',
      entityId: created.id,
      action: 'NODE_DRAFT_UPSERTED',
      payload: { revision: created.revision, nodeId: input.nodeId }
    })
    return created
  }

  const expected = input.expectedRevision ?? existing.revision
  if (expected !== existing.revision) {
    throw new ConcurrencyError('NodeDraft', existing.id, expected, existing.revision)
  }

  const updated = p.drizzle
    .update(nodeDraftTable)
    .set({
      title: input.title,
      body: input.body ?? existing.body,
      revision: existing.revision + 1,
      updatedAt: p.services.now()
    })
    .where(eq(nodeDraftTable.id, existing.id))
    .returning()
    .all()[0]

  if (updated === undefined) {
    throw new Error(`node_draft update returned no row for ${existing.id}`)
  }

  touchNode(p, input.nodeId)
  appendAudit(p, {
    projectId: projectIdOfNode(p, input.nodeId) ?? null,
    entityType: 'NodeDraft',
    entityId: updated.id,
    action: 'NODE_DRAFT_UPSERTED',
    payload: { revision: updated.revision, nodeId: input.nodeId }
  })

  return updated
}

export interface PublishNodeVersionInput {
  id: string
  nodeId: string
  title: string
  body: string
}

export function publishNodeVersion(p: Persistence, input: PublishNodeVersionInput): NodeVersionRow {
  const node = requireNode(p, input.nodeId)
  const lastSequence = p.drizzle
    .select()
    .from(nodeVersionTable)
    .where(eq(nodeVersionTable.nodeId, input.nodeId))
    .orderBy(desc(nodeVersionTable.sequence))
    .limit(1)
    .get()

  const sequence = (lastSequence?.sequence ?? 0) + 1
  const contentHash = sha256Hex(canonicalContent(input.title, input.body))

  const created = p.drizzle
    .insert(nodeVersionTable)
    .values({
      id: input.id,
      nodeId: input.nodeId,
      sequence,
      title: input.title,
      body: input.body,
      contentHash,
      createdAt: p.services.now()
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`node_version insert returned no row for ${input.id}`)
  }

  touchNode(p, input.nodeId)
  appendAudit(p, {
    projectId: node.projectId,
    entityType: 'NodeVersion',
    entityId: created.id,
    action: 'NODE_VERSION_PUBLISHED',
    payload: { nodeId: input.nodeId, sequence: created.sequence, contentHash: created.contentHash }
  })

  return created
}

export function requireNodeVersion(p: Persistence, id: string): NodeVersionRow {
  const row = p.drizzle.select().from(nodeVersionTable).where(eq(nodeVersionTable.id, id)).get()
  if (row === undefined) {
    throw new NotFoundError('NodeVersion', id)
  }
  return row
}

function touchNode(p: Persistence, nodeId: string): void {
  p.drizzle
    .update(nodeTable)
    .set({ updatedAt: p.services.now() })
    .where(eq(nodeTable.id, nodeId))
    .run()
}

function projectIdOfNode(p: Persistence, nodeId: string): string | undefined {
  const node = getNode(p, nodeId)
  return node?.projectId
}
