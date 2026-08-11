import { sha256Hex } from '../util/hash'

// Provider/Agent-neutral observed context element taxonomy. Deliberately
// provisional: this reflects what Pi's `context` seam exposes today and may be
// refined by future harness evidence. An AgentMessage can decompose into 0..N
// elements (e.g. assistant text + a toolCall block => two elements).
export const OBSERVED_ELEMENT_KINDS = [
  'USER_TEXT',
  'ASSISTANT_TEXT',
  'ASSISTANT_THINKING',
  'TOOL_CALL',
  'TOOL_RESULT',
  'IMAGE',
  'OTHER_STRUCTURED',
  'OPAQUE_BLOCK'
] as const
export type ObservedElementKind = (typeof OBSERVED_ELEMENT_KINDS)[number]

// One semantic element observed at a model-call boundary. This is NOT a Context
// Source: it is evidence that may later support (or fail to support) a source
// identity via explicit attribution.
export interface ObservedContextElement {
  readonly observationRef: string
  readonly runtimeSessionId: string
  readonly modelCallSequence: number
  readonly messagePosition: number
  readonly blockPosition?: number
  readonly role: string
  readonly elementKind: ObservedElementKind
  readonly semanticHash: string
  readonly tokenEstimate?: number
  readonly toolCallId?: string
  readonly toolName?: string
}

// Deterministic observation reference within a runtime session:
// `<sessionId>#call-<seq>-m-<message>-b-<block>`.
export function observationRef(
  runtimeSessionId: string,
  modelCallSequence: number,
  messagePosition: number,
  blockPosition?: number
): string {
  const block = blockPosition !== undefined ? `-b-${blockPosition}` : ''
  return `${runtimeSessionId}#call-${modelCallSequence}-m-${messagePosition}${block}`
}

export function elementSemanticHash(parts: readonly string[]): string {
  return sha256Hex(`element-v1|${parts.join('\u241F')}`)
}
