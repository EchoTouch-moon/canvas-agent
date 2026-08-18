import {
  sha256Hex,
  type CommittedWorkingSet,
  type CommittedWorkingSetEntry,
  type ContextRepresentation
} from '@canvas-agent/context-runtime'

export const PI_COMMITTED_CONTEXT_CUSTOM_TYPE = 'canvas-committed-context'

export type TranslationFailureCode =
  | 'UNRESOLVED_CONTENT'
  | 'UNRESOLVED_CONTENT_REF'
  | 'INVALID_POSITION'
  | 'INVALID_REPRESENTATION'

export class PiContextTranslationError extends Error {
  readonly category = 'TRANSLATION_FAILURE' as const
  readonly code: TranslationFailureCode
  readonly sourceId: string

  constructor(code: TranslationFailureCode, sourceId: string, message: string) {
    super(message)
    this.name = 'PiContextTranslationError'
    this.code = code
    this.sourceId = sourceId
  }
}

export interface ContextRenderTrace {
  readonly sourceId: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: ContextRepresentation['kind']
  readonly renderedHash: string
  readonly contentHash: string
  readonly renderedContentHash: string
  readonly position: number
}

export interface PiCommittedContextMessage {
  readonly role: 'custom'
  readonly customType: typeof PI_COMMITTED_CONTEXT_CUSTOM_TYPE
  readonly content: string
  readonly display: false
  readonly details: ContextRenderTrace
  readonly timestamp: number
}

export interface PiContextRenderPlan {
  readonly messages: readonly PiCommittedContextMessage[]
  readonly traces: readonly ContextRenderTrace[]
}

export interface PiContextRenderOptions {
  readonly timestamp?: number
}

export function renderedContentHash(content: string): string {
  return sha256Hex(`rendered-content-v1|${content}`)
}

export function materializedRepresentationContent(
  entry: CommittedWorkingSetEntry
): string {
  if (entry.representation.contentRef !== undefined) {
    throw new PiContextTranslationError(
      'UNRESOLVED_CONTENT_REF',
      entry.sourceId,
      `Committed entry ${entry.sourceId} uses unresolved contentRef`
    )
  }
  if (entry.representation.content === undefined) {
    throw new PiContextTranslationError(
      'UNRESOLVED_CONTENT',
      entry.sourceId,
      `Committed entry ${entry.sourceId} has no materialized representation content`
    )
  }
  return entry.representation.content
}

function sortedEntries(committed: CommittedWorkingSet): readonly CommittedWorkingSetEntry[] {
  const entries = committed.entries.map((entry, index) => ({ entry, index }))
  entries.sort((left, right) => {
    const positionDelta = left.entry.position - right.entry.position
    return positionDelta === 0 ? left.index - right.index : positionDelta
  })

  const seenPositions = new Set<number>()
  for (const { entry } of entries) {
    if (!Number.isInteger(entry.position) || entry.position < 0) {
      throw new PiContextTranslationError(
        'INVALID_POSITION',
        entry.sourceId,
        `Committed entry ${entry.sourceId} has invalid position ${String(entry.position)}`
      )
    }
    if (seenPositions.has(entry.position)) {
      throw new PiContextTranslationError(
        'INVALID_POSITION',
        entry.sourceId,
        `CommittedWorkingSet contains duplicate position ${String(entry.position)}`
      )
    }
    seenPositions.add(entry.position)
  }
  return entries.map(({ entry }) => entry)
}

/**
 * Deterministically translates a committed Runtime state into Pi custom
 * messages. The custom message details are verification-side metadata; Pi's
 * model conversion sends only the materialized text as a user message.
 */
export class PiCommittedContextAdapter {
  render(
    committed: CommittedWorkingSet,
    options: PiContextRenderOptions = {}
  ): PiContextRenderPlan {
    const timestamp = options.timestamp ?? 0
    if (!Number.isFinite(timestamp)) {
      throw new Error('PiContextRenderOptions.timestamp must be finite')
    }

    const traces: ContextRenderTrace[] = []
    const messages: PiCommittedContextMessage[] = []
    for (const entry of sortedEntries(committed)) {
      if (!entry.representation.sourceVersionIds.includes(entry.sourceVersionId)) {
        throw new PiContextTranslationError(
          'INVALID_REPRESENTATION',
          entry.sourceId,
          `Representation ${entry.representation.id} does not contain ${entry.sourceVersionId}`
        )
      }
      const content = materializedRepresentationContent(entry)
      const trace: ContextRenderTrace = {
        sourceId: entry.sourceId,
        sourceVersionId: entry.sourceVersionId,
        representationId: entry.representation.id,
        representationKind: entry.representation.kind,
        renderedHash: entry.renderedHash,
        contentHash: entry.representation.contentHash,
        renderedContentHash: renderedContentHash(content),
        position: entry.position
      }
      traces.push(trace)
      messages.push({
        role: 'custom',
        customType: PI_COMMITTED_CONTEXT_CUSTOM_TYPE,
        content,
        display: false,
        details: trace,
        timestamp
      })
    }
    return {
      messages: Object.freeze(messages),
      traces: Object.freeze(traces)
    }
  }
}
