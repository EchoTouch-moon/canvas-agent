import { and, asc, eq } from 'drizzle-orm'
import type { Persistence } from '../db'
import { CycleError, SelfEdgeError, ValidationError } from '../errors'
import { edgeTable } from '../schema'
import type { EdgeRow } from '../schema'
import type { EdgeStatus, EdgeType } from '@canvas-agent/domain'
import { appendAudit } from './audit'
import { requireNode, requireNodeVersion } from './node'

export function listEdges(p: Persistence, projectId: string): EdgeRow[] {
  return p.drizzle
    .select()
    .from(edgeTable)
    .where(eq(edgeTable.projectId, projectId))
    .orderBy(asc(edgeTable.createdAt), asc(edgeTable.id))
    .all()
}

export interface CreateEdgeInput {
  id: string
  projectId: string
  sourceNodeId: string
  targetNodeId: string
  type: EdgeType
  status?: EdgeStatus
  anchoredNodeVersionId?: string | null
  note?: string | null
}

export interface CreateEdgeResult {
  edge: EdgeRow
  warning?: string
}

export function createEdge(p: Persistence, input: CreateEdgeInput): CreateEdgeResult {
  const source = requireNode(p, input.sourceNodeId)
  const target = requireNode(p, input.targetNodeId)
  if (input.anchoredNodeVersionId !== null && input.anchoredNodeVersionId !== undefined) {
    requireNodeVersion(p, input.anchoredNodeVersionId)
  }

  if (source.projectId !== input.projectId || target.projectId !== input.projectId) {
    throw new ValidationError('Edge source and target nodes must belong to the same project')
  }

  if (input.sourceNodeId === input.targetNodeId) {
    throw new SelfEdgeError(input.sourceNodeId)
  }

  const cycleDetected = shouldCheckCycles(input.type) && wouldCreateCycle(p, input.projectId, input.type, input.sourceNodeId, input.targetNodeId)
  if (cycleDetected && input.type !== 'DEPENDS_ON') {
    throw new CycleError(input.type, input.sourceNodeId, input.targetNodeId)
  }

  const now = p.services.now()
  const created = p.drizzle
    .insert(edgeTable)
    .values({
      id: input.id,
      projectId: input.projectId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      type: input.type,
      status: input.status ?? 'PROPOSED',
      anchoredNodeVersionId: input.anchoredNodeVersionId ?? null,
      note: input.note ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .all()[0]

  if (created === undefined) {
    throw new Error(`edge insert returned no row for ${input.id}`)
  }

  appendAudit(p, {
    projectId: input.projectId,
    entityType: 'Edge',
    entityId: created.id,
    action: 'EDGE_CREATED',
    payload: {
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      type: input.type,
      status: created.status
    }
  })

  return cycleDetected ? { edge: created, warning: `DEPENDS_ON edge ${created.id} introduces a cycle and is stored with a warning` } : { edge: created }
}

function shouldCheckCycles(type: EdgeType): boolean {
  return type === 'PARENT_OF' || type === 'SUPERSEDES' || type === 'DEPENDS_ON'
}

function wouldCreateCycle(p: Persistence, projectId: string, type: EdgeType, source: string, target: string): boolean {
  const edges = p.drizzle
    .select()
    .from(edgeTable)
    .where(and(eq(edgeTable.projectId, projectId), eq(edgeTable.type, type)))
    .all()

  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = adjacency.get(edge.sourceNodeId) ?? []
    targets.push(edge.targetNodeId)
    adjacency.set(edge.sourceNodeId, targets)
  }

  return isReachable(adjacency, target, source)
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
