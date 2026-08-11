import {
  DERIVED_HINT_ATTRIBUTION,
  OPAQUE_ATTRIBUTION,
  UNATTRIBUTED_ATTRIBUTION,
  elementSemanticHash,
  observationRef,
  type ObservedContextElement,
  type ResourceHint,
  type SourceAttribution
} from '@canvas-agent/context-runtime'
import type { PiContentBlockView, PiMessageView } from './pi-message-mapper'

export interface ElementWithAttribution {
  readonly element: ObservedContextElement
  readonly attribution: SourceAttribution
}

// Canonical repository path hint extraction from structured tool arguments.
// Only known path-bearing fields on known tools yield a DERIVED_HINT; free-form
// text is never parsed here. Read tools may apply offset/limit/formatting, so
// this is explicitly a hint, never canonical source identity.
const PATH_ARGUMENT_FIELDS = ['path', 'filePath'] as const
const PATH_BEARING_TOOLS = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls'])

function extractPathHint(toolName: string, args: unknown): string | null {
  if (!PATH_BEARING_TOOLS.has(toolName)) return null
  if (typeof args !== 'object' || args === null) return null
  const record = args as Record<string, unknown>
  for (const field of PATH_ARGUMENT_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.length > 0) {
      // Normalize a leading './' away for a stable hint key; keep everything
      // else as-is. This is a hint key, not a validated repository path.
      const normalized = value.startsWith('./') ? value.slice(2) : value
      if (!normalized.includes('..') && !normalized.startsWith('/')) {
        return normalized
      }
    }
  }
  return null
}

// Decompose one Pi message into observed context elements + deterministic
// attributions. 0..N elements per message. No provider-specific payload types
// leak into the Runtime core; only neutral strings/hashes are produced.
export function decomposePiMessage(
  message: PiMessageView,
  ctx: { runtimeSessionId: string; modelCallSequence: number; messagePosition: number }
): readonly ElementWithAttribution[] {
  const blocks = toBlocks(message.content)
  const result: ElementWithAttribution[] = []
  const role = message.role

  if (role === 'toolResult') {
    const callId = message.toolCallId
    if (callId === undefined) {
      // Tool result without a call id: opaque/unattributed.
      const element: ObservedContextElement = {
        observationRef: observationRef(ctx.runtimeSessionId, ctx.modelCallSequence, ctx.messagePosition),
        runtimeSessionId: ctx.runtimeSessionId,
        modelCallSequence: ctx.modelCallSequence,
        messagePosition: ctx.messagePosition,
        role,
        elementKind: 'TOOL_RESULT',
        semanticHash: elementSemanticHash(['toolResult', message.toolName ?? '', 'no-call-id']),
        ...(message.toolName !== undefined ? { toolName: message.toolName } : {})
      }
      result.push({
        element,
        attribution: OPAQUE_ATTRIBUTION([
          `modelCall=${ctx.modelCallSequence}`,
          `messageIndex=${ctx.messagePosition}`,
          'toolCallId=missing'
        ])
      })
      return result
    }
    const element: ObservedContextElement = {
      observationRef: observationRef(ctx.runtimeSessionId, ctx.modelCallSequence, ctx.messagePosition),
      runtimeSessionId: ctx.runtimeSessionId,
      modelCallSequence: ctx.modelCallSequence,
      messagePosition: ctx.messagePosition,
      role,
      elementKind: 'TOOL_RESULT',
      semanticHash: elementSemanticHash([
        'toolResult',
        callId,
        message.toolName ?? '',
        String(message.isError ?? false)
      ]),
      toolCallId: callId,
      ...(message.toolName !== undefined ? { toolName: message.toolName } : {})
    }
    result.push({
      element,
      attribution: {
        confidence: 'EXACT',
        sourceKey: `run/tool-result://${callId}`,
        method: 'PI_TOOL_RESULT_ID_EXACT',
        evidenceRefs: [
          `modelCall=${ctx.modelCallSequence}`,
          `messageIndex=${ctx.messagePosition}`,
          `toolCallId=${callId}`
        ]
      }
    })
    return result
  }

  // Non-toolResult messages decompose by content blocks.
  let blockIndex = 0
  for (const block of blocks) {
    const ref = observationRef(ctx.runtimeSessionId, ctx.modelCallSequence, ctx.messagePosition, blockIndex)
    const evidence = [
      `modelCall=${ctx.modelCallSequence}`,
      `messageIndex=${ctx.messagePosition}`,
      `block=${blockIndex}`
    ]

    if (block.type === 'text') {
      const text = block.text ?? ''
      const element: ObservedContextElement = {
        observationRef: ref,
        runtimeSessionId: ctx.runtimeSessionId,
        modelCallSequence: ctx.modelCallSequence,
        messagePosition: ctx.messagePosition,
        blockPosition: blockIndex,
        role,
        elementKind: role === 'user' ? 'USER_TEXT' : 'ASSISTANT_TEXT',
        semanticHash: elementSemanticHash([role, 'text', text])
      }
      result.push({
        element,
        // Free-form prose: never invent a source identity.
        attribution: UNATTRIBUTED_ATTRIBUTION([...evidence, 'elementKind=text'])
      })
    } else if (block.type === 'thinking') {
      const element: ObservedContextElement = {
        observationRef: ref,
        runtimeSessionId: ctx.runtimeSessionId,
        modelCallSequence: ctx.modelCallSequence,
        messagePosition: ctx.messagePosition,
        blockPosition: blockIndex,
        role,
        elementKind: 'ASSISTANT_THINKING',
        semanticHash: elementSemanticHash([role, 'thinking', block.thinking ?? ''])
      }
      result.push({
        element,
        attribution: UNATTRIBUTED_ATTRIBUTION([...evidence, 'elementKind=thinking'])
      })
    } else if (block.type === 'toolCall') {
      const callId = block.id ?? ''
      const name = block.name ?? ''
      const args = block.arguments
      const element: ObservedContextElement = {
        observationRef: ref,
        runtimeSessionId: ctx.runtimeSessionId,
        modelCallSequence: ctx.modelCallSequence,
        messagePosition: ctx.messagePosition,
        blockPosition: blockIndex,
        role,
        elementKind: 'TOOL_CALL',
        semanticHash: elementSemanticHash(['toolCall', name, callId, JSON.stringify(args ?? null)]),
        ...(callId !== '' ? { toolCallId: callId } : {}),
        ...(name !== '' ? { toolName: name } : {})
      }
      const pathHint = extractPathHint(name, args)
      const resourceHint: ResourceHint | undefined =
        pathHint !== null
          ? {
              sourceKey: `repository/file://${pathHint}`,
              method: 'PI_TOOL_ARGUMENT_PATH_HINT',
              evidenceRefs: [...evidence, `tool=${name}`, 'argumentField=path']
            }
          : undefined

      if (callId !== '') {
        // Primary EXACT run-event identity; path stays a derived resource hint.
        const attribution: SourceAttribution = {
          confidence: 'EXACT',
          sourceKey: `run/tool-call://${callId}`,
          method: 'PI_TOOL_CALL_ID_EXACT',
          evidenceRefs: [...evidence, `toolCallId=${callId}`, `tool=${name}`],
          ...(resourceHint !== undefined ? { resourceHints: [resourceHint] } : {})
        }
        result.push({ element, attribution })
      } else if (pathHint !== null) {
        // No exact event id, but a structured path gives a derived hint.
        result.push({
          element,
          attribution: DERIVED_HINT_ATTRIBUTION(
            [...evidence, `tool=${name}`, 'argumentField=path'],
            `repository/file://${pathHint}`,
            'PI_TOOL_ARGUMENT_PATH_HINT'
          )
        })
      } else {
        result.push({
          element,
          attribution: UNATTRIBUTED_ATTRIBUTION([...evidence, 'elementKind=toolCall'])
        })
      }
    } else if (block.type === 'image') {
      const element: ObservedContextElement = {
        observationRef: ref,
        runtimeSessionId: ctx.runtimeSessionId,
        modelCallSequence: ctx.modelCallSequence,
        messagePosition: ctx.messagePosition,
        blockPosition: blockIndex,
        role,
        elementKind: 'IMAGE',
        semanticHash: elementSemanticHash(['image', block.mimeType ?? '', String(block.data?.length ?? 0)])
      }
      result.push({
        element,
        attribution: OPAQUE_ATTRIBUTION([...evidence, 'elementKind=image'])
      })
    } else {
      const element: ObservedContextElement = {
        observationRef: ref,
        runtimeSessionId: ctx.runtimeSessionId,
        modelCallSequence: ctx.modelCallSequence,
        messagePosition: ctx.messagePosition,
        blockPosition: blockIndex,
        role,
        elementKind: 'OTHER_STRUCTURED',
        semanticHash: elementSemanticHash([role, block.type, JSON.stringify(block)])
      }
      result.push({
        element,
        attribution: OPAQUE_ATTRIBUTION([...evidence, `elementKind=${block.type}`])
      })
    }
    blockIndex += 1
  }

  // A message with no recognizable content blocks still yields one opaque
  // element so the observation timeline stays complete.
  if (result.length === 0) {
    const element: ObservedContextElement = {
      observationRef: observationRef(ctx.runtimeSessionId, ctx.modelCallSequence, ctx.messagePosition),
      runtimeSessionId: ctx.runtimeSessionId,
      modelCallSequence: ctx.modelCallSequence,
      messagePosition: ctx.messagePosition,
      role,
      elementKind: 'OPAQUE_BLOCK',
      semanticHash: elementSemanticHash([role, 'no-blocks'])
    }
    result.push({
      element,
      attribution: OPAQUE_ATTRIBUTION([
        `modelCall=${ctx.modelCallSequence}`,
        `messageIndex=${ctx.messagePosition}`,
        'elementKind=opaque-no-blocks'
      ])
    })
  }
  return result
}

export function decomposePiMessages(
  messages: readonly PiMessageView[],
  ctx: { runtimeSessionId: string; modelCallSequence: number }
): readonly ElementWithAttribution[] {
  return messages.flatMap((message, messagePosition) =>
    decomposePiMessage(message, { ...ctx, messagePosition })
  )
}

function toBlocks(content: unknown): readonly PiContentBlockView[] {
  if (content === undefined) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) {
    return content.filter(isBlockView)
  }
  return []
}

function isBlockView(value: unknown): value is PiContentBlockView {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { type?: unknown }).type === 'string'
}
