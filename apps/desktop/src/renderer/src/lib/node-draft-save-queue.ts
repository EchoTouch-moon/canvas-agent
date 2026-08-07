import { isWorkspaceErrorCode, type WorkspaceClient } from './workspace-client'
import type { NodeDraftRecord } from './workspace-types'

export interface NodeDraftValue {
  readonly title: string
  readonly body: string
}

export interface NodeDraftSaveRequest extends NodeDraftValue {
  readonly nodeId: string
  readonly expectedRevision?: number
}

export interface NodeDraftConflict {
  readonly serverRevision: number
  readonly serverValue: NodeDraftValue
}

export interface NodeDraftQueueState {
  readonly pending: boolean
  readonly dirty: boolean
  readonly savedRevision: number | null
  readonly conflict: NodeDraftConflict | null
}

interface QueueEntry {
  latest: NodeDraftValue
  savedRevision: number | undefined
  dirty: boolean
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | null
  conflict: NodeDraftConflict | null
}

export interface NodeDraftSaveQueueOptions {
  readonly save: (request: NodeDraftSaveRequest) => Promise<NodeDraftRecord>
  readonly debounceMs?: number
  readonly onStateChange?: (nodeId: string, state: NodeDraftQueueState) => void
}

export class NodeDraftSaveQueue {
  private readonly entries = new Map<string, QueueEntry>()
  private readonly save: NodeDraftSaveQueueOptions['save']
  private readonly debounceMs: number
  private readonly onStateChange: NonNullable<NodeDraftSaveQueueOptions['onStateChange']>

  constructor(options: NodeDraftSaveQueueOptions) {
    this.save = options.save
    this.debounceMs = options.debounceMs ?? 350
    this.onStateChange = options.onStateChange ?? (() => undefined)
  }

  schedule(request: NodeDraftSaveRequest): void {
    const entry = this.entries.get(request.nodeId) ?? {
      latest: { title: request.title, body: request.body },
      savedRevision: request.expectedRevision,
      dirty: false,
      inFlight: false,
      timer: null,
      conflict: null
    }
    entry.latest = { title: request.title, body: request.body }
    entry.dirty = true
    entry.conflict = null
    if (!entry.inFlight) this.scheduleFlush(request.nodeId, entry)
    this.entries.set(request.nodeId, entry)
    this.emit(request.nodeId, entry)
  }

  state(nodeId: string): NodeDraftQueueState | null {
    const entry = this.entries.get(nodeId)
    return entry ? this.snapshot(entry) : null
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer)
    }
    this.entries.clear()
  }

  private scheduleFlush(nodeId: string, entry: QueueEntry): void {
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void this.flush(nodeId, entry)
    }, this.debounceMs)
  }

  private async flush(nodeId: string, entry: QueueEntry): Promise<void> {
    if (entry.inFlight || !entry.dirty || entry.conflict !== null) return

    entry.inFlight = true
    entry.dirty = false
    const value = entry.latest
    const expectedRevision = entry.savedRevision
    this.emit(nodeId, entry)

    try {
      const saved = await this.save({
        nodeId,
        ...value,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
      })
      entry.savedRevision = saved.revision
    } catch (error) {
      if (isWorkspaceErrorCode(error, 'ConcurrencyError')) {
        const details = error.details
        const record =
          typeof details === 'object' && details !== null
            ? (details as Record<string, unknown>)
            : undefined
        const serverValue =
          record && typeof record.serverValue === 'object' && record.serverValue !== null
            ? (record.serverValue as Record<string, unknown>)
            : undefined
        const serverRevision =
          typeof record?.serverRevision === 'number'
            ? record.serverRevision
            : (entry.savedRevision ?? 0)
        entry.savedRevision = serverRevision
        entry.conflict = {
          serverRevision,
          serverValue: {
            title: typeof serverValue?.title === 'string' ? serverValue.title : '',
            body: typeof serverValue?.body === 'string' ? serverValue.body : ''
          }
        }
      } else {
        entry.dirty = true
      }
    } finally {
      entry.inFlight = false
      this.emit(nodeId, entry)
      if (entry.dirty && entry.conflict === null) this.scheduleFlush(nodeId, entry)
    }
  }

  private snapshot(entry: QueueEntry): NodeDraftQueueState {
    return {
      pending: entry.inFlight || entry.timer !== null,
      dirty: entry.dirty,
      savedRevision: entry.savedRevision ?? null,
      conflict: entry.conflict
    }
  }

  private emit(nodeId: string, entry: QueueEntry): void {
    this.onStateChange(nodeId, this.snapshot(entry))
  }
}

export function createNodeDraftSaveQueue(
  client: WorkspaceClient,
  options: Omit<NodeDraftSaveQueueOptions, 'save'> = {}
): NodeDraftSaveQueue {
  return new NodeDraftSaveQueue({
    ...options,
    save: (request) => {
      const payload = {
        nodeId: request.nodeId,
        title: request.title,
        body: request.body,
        ...(request.expectedRevision === undefined
          ? {}
          : { expectedRevision: request.expectedRevision })
      }
      return client.command('nodeDraft.upsert', payload)
    }
  })
}
