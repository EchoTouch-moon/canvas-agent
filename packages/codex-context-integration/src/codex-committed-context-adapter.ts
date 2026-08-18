import {
  sha256Hex,
  type CommittedWorkingSet,
  type CommittedWorkingSetEntry,
  type ContextRepresentation
} from '@canvas-agent/context-runtime'
import type { ExecutionContextBundleV2, ExecutionContextItemV2 } from '@canvas-agent/contracts'
import {
  CONTEXT_AUTHORITIES,
  CONTEXT_ITEM_TYPES,
  type ContextAuthority,
  type ContextItemType
} from '@canvas-agent/domain'
import {
  assertValidExecutionContextBundle,
  computeExecutionContextBundle
} from '@canvas-agent/worker-runtime'

export type CodexTranslationFailureCode =
  | 'UNRESOLVED_CONTENT'
  | 'INVALID_POSITION'
  | 'INVALID_REPRESENTATION'
  | 'INVALID_METADATA'
  | 'INVALID_BUNDLE'

export class CodexContextTranslationError extends Error {
  readonly category = 'TRANSLATION_FAILURE' as const
  readonly code: CodexTranslationFailureCode
  readonly sourceId: string | null

  constructor(
    code: CodexTranslationFailureCode,
    message: string,
    sourceId: string | null = null
  ) {
    super(message)
    this.name = 'CodexContextTranslationError'
    this.code = code
    this.sourceId = sourceId
  }
}

export interface CodexContextMetadata {
  readonly itemType: ContextItemType
  readonly authority: ContextAuthority
  readonly sourceRef: string
}

export type CodexContextMetadataResolver = (
  entry: CommittedWorkingSetEntry
) => CodexContextMetadata

/**
 * Verification-side provenance for one materialized Codex prompt section.
 * None of these fields are injected into the model-visible content.
 */
export interface CodexContextRenderTrace {
  readonly sourceId: string
  readonly sourceVersionId: string
  readonly representationId: string
  readonly representationKind: ContextRepresentation['kind']
  readonly renderedHash: string
  readonly contentHash: string
  readonly renderedContentHash: string
  readonly resolvedContentHash: string
  readonly position: number
  readonly itemType: ContextItemType
  readonly authority: ContextAuthority
  readonly priority: CommittedWorkingSetEntry['priority']
  readonly tokenEstimate: number
  readonly sourceRef: string
}

export interface CodexContextRenderPlan {
  readonly bundle: ExecutionContextBundleV2
  readonly traces: readonly CodexContextRenderTrace[]
}

function materializedContent(entry: CommittedWorkingSetEntry): string {
  if (entry.representation.contentRef !== undefined) {
    throw new CodexContextTranslationError(
      'UNRESOLVED_CONTENT',
      `Committed entry ${entry.sourceId} uses unresolved contentRef`,
      entry.sourceId
    )
  }
  if (entry.representation.content === undefined) {
    throw new CodexContextTranslationError(
      'UNRESOLVED_CONTENT',
      `Committed entry ${entry.sourceId} has no materialized representation content`,
      entry.sourceId
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
      throw new CodexContextTranslationError(
        'INVALID_POSITION',
        `Committed entry ${entry.sourceId} has invalid position ${String(entry.position)}`,
        entry.sourceId
      )
    }
    if (seenPositions.has(entry.position)) {
      throw new CodexContextTranslationError(
        'INVALID_POSITION',
        `CommittedWorkingSet contains duplicate position ${String(entry.position)}`,
        entry.sourceId
      )
    }
    seenPositions.add(entry.position)
  }
  return entries.map(({ entry }) => entry)
}

function metadataFor(
  resolver: CodexContextMetadataResolver,
  entry: CommittedWorkingSetEntry
): CodexContextMetadata {
  let metadata: CodexContextMetadata
  try {
    metadata = resolver(entry)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new CodexContextTranslationError('INVALID_METADATA', message, entry.sourceId)
  }
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    typeof metadata.itemType !== 'string' ||
    typeof metadata.authority !== 'string' ||
    typeof metadata.sourceRef !== 'string' ||
    metadata.sourceRef.length === 0 ||
    !(CONTEXT_ITEM_TYPES as readonly string[]).includes(metadata.itemType) ||
    !(CONTEXT_AUTHORITIES as readonly string[]).includes(metadata.authority)
  ) {
    throw new CodexContextTranslationError(
      'INVALID_METADATA',
      `Codex metadata resolver returned an invalid result for ${entry.sourceId}`,
      entry.sourceId
    )
  }
  return metadata
}

function toBundleItem(
  entry: CommittedWorkingSetEntry,
  metadata: CodexContextMetadata,
  content: string
): ExecutionContextItemV2 {
  return {
    position: entry.position,
    itemType: metadata.itemType,
    sourceRef: metadata.sourceRef,
    resolvedContent: content,
    contentHash: sha256Hex(content),
    authority: metadata.authority,
    priority: entry.priority,
    tokenEstimate: entry.representation.tokenEstimate
  }
}

/**
 * Translates the frozen Runtime state into the existing worker-runtime v2
 * bundle consumed by `createCodexAgentAdapter`. The adapter owns no planning,
 * filtering, compression, or version selection.
 */
export class CodexCommittedContextAdapter {
  private readonly metadataResolver: CodexContextMetadataResolver

  constructor(options: { metadataResolver: CodexContextMetadataResolver }) {
    this.metadataResolver = options.metadataResolver
  }

  render(committed: CommittedWorkingSet): CodexContextRenderPlan {
    const items: ExecutionContextItemV2[] = []
    const traces: CodexContextRenderTrace[] = []

    for (const entry of sortedEntries(committed)) {
      if (!entry.representation.sourceVersionIds.includes(entry.sourceVersionId)) {
        throw new CodexContextTranslationError(
          'INVALID_REPRESENTATION',
          `Representation ${entry.representation.id} does not contain ${entry.sourceVersionId}`,
          entry.sourceId
        )
      }
      const content = materializedContent(entry)
      const metadata = metadataFor(this.metadataResolver, entry)
      items.push(toBundleItem(entry, metadata, content))
      traces.push({
        sourceId: entry.sourceId,
        sourceVersionId: entry.sourceVersionId,
        representationId: entry.representation.id,
        representationKind: entry.representation.kind,
        renderedHash: entry.renderedHash,
        contentHash: entry.representation.contentHash,
        renderedContentHash: sha256Hex(`rendered-content-v1|${content}`),
        resolvedContentHash: sha256Hex(content),
        position: entry.position,
        itemType: metadata.itemType,
        authority: metadata.authority,
        priority: entry.priority,
        tokenEstimate: entry.representation.tokenEstimate,
        sourceRef: metadata.sourceRef
      })
    }

    const computed = computeExecutionContextBundle(items)
    const bundle: ExecutionContextBundleV2 = {
      items,
      contentHash: computed.contentHash,
      totalBytes: computed.totalBytes
    }
    try {
      assertValidExecutionContextBundle(bundle)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CodexContextTranslationError('INVALID_BUNDLE', message)
    }

    return {
      bundle: Object.freeze(bundle),
      traces: Object.freeze(traces)
    }
  }
}
