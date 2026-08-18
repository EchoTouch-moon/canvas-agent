import { sha256Hex } from '@canvas-agent/context-runtime'
import {
  canonicalizeObservedContext,
  type CanonicalContext,
  type ContextParityResult
} from '@canvas-agent/context-conformance'
import type { CodexContextRenderTrace } from './codex-committed-context-adapter'

export type CodexCaptureStage = 'codex_cli_stdin'

export interface CapturedCodexPrompt {
  readonly prompt: string
  readonly promptHash: string
  readonly traces: readonly CodexContextRenderTrace[]
  readonly captureStage: CodexCaptureStage
}

export interface ReconstructedCodexContextEntry {
  readonly trace: CodexContextRenderTrace
  readonly role: 'user'
  readonly content: string
}

export interface ReconstructedCodexModelVisibleContext {
  readonly entries: readonly ReconstructedCodexContextEntry[]
  readonly logicalHash: string
  readonly payloadMessageCount: number
  readonly expectedPayloadMessageCount: number
}

export class CodexReconstructionError extends Error {
  readonly category = 'RECONSTRUCTION_FAILURE' as const
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CodexReconstructionError'
    this.code = code
  }
}

export function captureCodexPrompt(
  prompt: string,
  traces: readonly CodexContextRenderTrace[]
): CapturedCodexPrompt {
  return Object.freeze({
    prompt,
    promptHash: sha256Hex(prompt),
    traces: Object.freeze([...traces]),
    captureStage: 'codex_cli_stdin' as const
  })
}

interface ParsedPromptSegment {
  readonly position: number
  readonly itemType: string
  readonly authority: string
  readonly priority: string
  readonly sourceRef: string
  readonly content: string
}

function parseSegment(segment: string): ParsedPromptSegment {
  const newline = segment.indexOf('\n')
  if (newline < 0) {
    throw new CodexReconstructionError('INVALID_PROMPT_SECTION', 'Codex context section has no content line')
  }
  const header = segment.slice(0, newline)
  const contentLines = segment.slice(newline + 1).split('\n').filter((line) => line.length > 0)
  const match = /^--- position=(\d+) itemType=([^ ]+) authority=([^ ]+) priority=(P[0-3]) source=(.*) ---$/.exec(
    header
  )
  if (match === null || contentLines.length !== 1) {
    throw new CodexReconstructionError(
      'INVALID_PROMPT_SECTION',
      `Unable to parse Codex context section header: ${header}`
    )
  }
  let content: unknown
  try {
    content = JSON.parse(contentLines[0] ?? '')
  } catch {
    throw new CodexReconstructionError(
      'INVALID_PROMPT_CONTENT',
      `Codex context section at position ${match[1]} is not JSON-encoded text`
    )
  }
  if (typeof content !== 'string') {
    throw new CodexReconstructionError(
      'INVALID_PROMPT_CONTENT',
      `Codex context section at position ${match[1]} is not text`
    )
  }
  return {
    position: Number(match[1]),
    itemType: match[2] ?? '',
    authority: match[3] ?? '',
    priority: match[4] ?? '',
    sourceRef: match[5] ?? '',
    content
  }
}

function parsePrompt(prompt: string): readonly ParsedPromptSegment[] {
  const marker = 'Frozen context (in position order):\n'
  const start = prompt.indexOf(marker)
  const endMarker = '\n\nFinal output requirements:'
  const end = start < 0 ? -1 : prompt.indexOf(endMarker, start + marker.length)
  if (start < 0 || end < 0) {
    throw new CodexReconstructionError(
      'MISSING_CONTEXT_SECTION',
      'Captured Codex stdin does not contain the expected frozen context section'
    )
  }
  const body = prompt.slice(start + marker.length, end).trim()
  if (body.length === 0) {
    throw new CodexReconstructionError('MISSING_CONTEXT_SECTION', 'Captured Codex context is empty')
  }
  const segments = body.split(/\n(?=--- position=)/u)
  return Object.freeze(segments.map(parseSegment))
}

function reconstructedLogicalHash(entries: readonly ReconstructedCodexContextEntry[]): string {
  return sha256Hex(
    [
      'reconstructed-codex-model-visible-context-v1',
      ...entries.map((entry) =>
        [
          String(entry.trace.position),
          entry.trace.sourceId,
          entry.trace.sourceVersionId,
          entry.trace.representationId,
          entry.trace.representationKind,
          entry.trace.renderedHash,
          entry.role,
          entry.content
        ].join('|')
      )
    ].join('\u241F')
  )
}

/**
 * Reconstructs only from the captured Codex stdin and the verification-side
 * sidecar. The frozen Runtime object is intentionally not accepted here.
 */
export function reconstructCodexModelVisibleContext(
  captured: CapturedCodexPrompt
): ReconstructedCodexModelVisibleContext {
  const segments = parsePrompt(captured.prompt)
  const tracesByPosition = new Map(captured.traces.map((trace) => [trace.position, trace] as const))
  if (tracesByPosition.size !== captured.traces.length) {
    throw new CodexReconstructionError('DUPLICATE_TRACE_POSITION', 'Codex sidecar has duplicate positions')
  }

  const seenPositions = new Set<number>()
  const entries: ReconstructedCodexContextEntry[] = []
  for (const segment of segments) {
    if (seenPositions.has(segment.position)) {
      throw new CodexReconstructionError(
        'DUPLICATE_PROMPT_POSITION',
        `Codex stdin contains duplicate position ${String(segment.position)}`
      )
    }
    seenPositions.add(segment.position)
    const trace = tracesByPosition.get(segment.position)
    if (trace === undefined) {
      throw new CodexReconstructionError(
        'EXTRA_PROMPT_SECTION',
        `Codex stdin contains an untraced context section at position ${String(segment.position)}`
      )
    }
    if (
      trace.itemType !== segment.itemType ||
      trace.authority !== segment.authority ||
      trace.priority !== segment.priority ||
      trace.sourceRef !== segment.sourceRef
    ) {
      throw new CodexReconstructionError(
        'PROMPT_METADATA_MISMATCH',
        `Codex stdin metadata differs from sidecar at position ${String(segment.position)}`
      )
    }
    entries.push({ trace, role: 'user', content: segment.content })
  }
  if (entries.length !== captured.traces.length) {
    throw new CodexReconstructionError(
      'MISSING_PROMPT_SECTION',
      `Codex stdin contains ${String(entries.length)} traced sections; expected ${String(captured.traces.length)}`
    )
  }

  const sorted = [...entries].sort((left, right) => left.trace.position - right.trace.position)
  return {
    entries: Object.freeze(sorted),
    logicalHash: reconstructedLogicalHash(sorted),
    payloadMessageCount: sorted.length,
    expectedPayloadMessageCount: captured.traces.length
  }
}

export function canonicalizeCodexObservedContext(
  reconstructed: ReconstructedCodexModelVisibleContext
): CanonicalContext {
  return canonicalizeObservedContext(
    reconstructed.entries.map((entry) => ({
      position: entry.trace.position,
      sourceId: entry.trace.sourceId,
      sourceVersionId: entry.trace.sourceVersionId,
      representationId: entry.trace.representationId,
      representationKind: entry.trace.representationKind,
      renderedHash: entry.trace.renderedHash,
      role: entry.role,
      content: entry.content
    })),
    {
      payloadMessageCount: reconstructed.payloadMessageCount,
      expectedPayloadMessageCount: reconstructed.expectedPayloadMessageCount
    }
  )
}

export type { ContextParityResult }
