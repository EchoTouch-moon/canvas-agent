import { decomposePiMessage } from '../../src/element-decomposition'
import type { PiMessageView } from '../../src/pi-message-mapper'
import { normalizeSourcePath } from '../../../context-runtime/tests/fixtures/source-identity/candidate'
import type {
  CandidateEvidenceInput,
  IdentityRepresentationKind
} from '../../../context-runtime/tests/fixtures/source-identity/types'

interface PiReadAuthorityBase {
  readonly repositoryId: string
  readonly namespace: string
  readonly path: string
  readonly universeRevision: string
  readonly representationKind: IdentityRepresentationKind
}

export type PiReadAuthority =
  | (PiReadAuthorityBase & {
      readonly status: 'AVAILABLE'
      readonly contentHash: string
      readonly unavailableReason?: never
    })
  | (PiReadAuthorityBase & {
      readonly status: 'UNAVAILABLE'
      readonly unavailableReason: string
      readonly contentHash?: never
    })
  | (PiReadAuthorityBase & {
      readonly status: 'ABSENT'
      readonly contentHash?: never
      readonly unavailableReason?: never
    })

export interface MappedPiReadEvidence {
  readonly eventSourceKey: string
  readonly evidence: CandidateEvidenceInput
}

export type UnmappedPiReadReason =
  | 'MISSING_CALL_ID'
  | 'MISSING_PATH_HINT'
  | 'UNMATCHED_CALL_ID'
  | 'CALL_ID_REMAP'
  | 'UNSUPPORTED_TOOL'
  | 'INVALID_PATH_HINT'
  | 'NO_AUTHORITATIVE_SOURCE'
  | 'AMBIGUOUS_AUTHORITY'

export interface UnmappedPiReadEvidence {
  readonly callId: string | undefined
  readonly eventSourceKey: string | undefined
  readonly reason: UnmappedPiReadReason
}

export interface PiIdentityBridgeResult {
  readonly mapped: readonly MappedPiReadEvidence[]
  readonly unmapped: readonly UnmappedPiReadEvidence[]
}

interface ToolCallHint {
  readonly path: string
  readonly toolName: string
}

const REPOSITORY_FILE_PREFIX = 'repository/file://'

/**
 * Test-only bridge candidate. It demonstrates the minimum additional seam
 * needed to turn an exact Pi read event into LC1 evidence: the Pi event gives
 * call identity and a path hint, while an authoritative repository adapter
 * supplies repository/namespace/version/status metadata. This is deliberately
 * not production code and never promotes a path hint without authority.
 */
export function mapPiReadResultsToCandidateEvidence(
  messages: readonly PiMessageView[],
  ctx: { readonly runtimeSessionId: string; readonly modelCallSequence: number },
  authorities: readonly PiReadAuthority[]
): PiIdentityBridgeResult {
  const callsById = new Map<string, ToolCallHint>()
  const callIdsSeen = new Set<string>()
  const remappedCallIds = new Set<string>()

  messages.forEach((message, messagePosition) => {
    for (const entry of decomposePiMessage(message, { ...ctx, messagePosition })) {
      if (entry.element.elementKind !== 'TOOL_CALL') continue
      const callId = entry.element.toolCallId
      if (callId === undefined) continue
      callIdsSeen.add(callId)
      const hint = entry.attribution.resourceHints?.find((candidate) =>
        candidate.sourceKey.startsWith(REPOSITORY_FILE_PREFIX)
      )
      if (hint === undefined) continue
      const path = hint.sourceKey.slice(REPOSITORY_FILE_PREFIX.length)
      const toolName = entry.element.toolName ?? ''
      const previous = callsById.get(callId)
      if (previous !== undefined && (previous.path !== path || previous.toolName !== toolName)) {
        remappedCallIds.add(callId)
        continue
      }
      callsById.set(callId, { path, toolName })
    }
  })

  const mapped: MappedPiReadEvidence[] = []
  const unmapped: UnmappedPiReadEvidence[] = []
  messages.forEach((message, messagePosition) => {
    if (message.role !== 'toolResult') return
    const callId = message.toolCallId
    const resultEntry = decomposePiMessage(message, { ...ctx, messagePosition }).find(
      (entry) => entry.element.elementKind === 'TOOL_RESULT'
    )
    const eventSourceKey = resultEntry?.attribution.sourceKey
    if (callId === undefined) {
      unmapped.push({ callId, eventSourceKey, reason: 'MISSING_CALL_ID' })
      return
    }
    if (remappedCallIds.has(callId)) {
      unmapped.push({ callId, eventSourceKey, reason: 'CALL_ID_REMAP' })
      return
    }
    const call = callsById.get(callId)
    if (call === undefined) {
      unmapped.push({
        callId,
        eventSourceKey,
        reason: callIdsSeen.has(callId) ? 'MISSING_PATH_HINT' : 'UNMATCHED_CALL_ID'
      })
      return
    }
    if (call.toolName !== 'read') {
      unmapped.push({ callId, eventSourceKey, reason: 'UNSUPPORTED_TOOL' })
      return
    }

    let normalizedPath: string
    try {
      normalizedPath = normalizeSourcePath(call.path)
    } catch {
      unmapped.push({ callId, eventSourceKey, reason: 'INVALID_PATH_HINT' })
      return
    }
    const matches = authorities.filter((authority) => {
      try {
        return normalizeSourcePath(authority.path) === normalizedPath
      } catch {
        return false
      }
    })
    if (matches.length === 0) {
      unmapped.push({ callId, eventSourceKey, reason: 'NO_AUTHORITATIVE_SOURCE' })
      return
    }
    if (matches.length > 1) {
      unmapped.push({ callId, eventSourceKey, reason: 'AMBIGUOUS_AUTHORITY' })
      return
    }

    const authority = matches[0]!
    const namespacedCallId = `pi-evidence:v1:${ctx.runtimeSessionId}:${callId}`
    mapped.push({
      eventSourceKey: eventSourceKey ?? `run/tool-result://${callId}`,
      evidence: authorityToCandidateEvidence(authority, namespacedCallId, normalizedPath)
    })
  })

  return { mapped, unmapped }
}

function authorityToCandidateEvidence(
  authority: PiReadAuthority,
  callId: string,
  normalizedPath: string
): CandidateEvidenceInput {
  const base = {
    repositoryId: authority.repositoryId,
    namespace: authority.namespace,
    path: normalizedPath,
    callId,
    universeRevision: authority.universeRevision,
    representationKind: authority.representationKind
  }
  if (authority.status === 'AVAILABLE') {
    return { ...base, status: 'AVAILABLE', contentHash: authority.contentHash }
  }
  if (authority.status === 'UNAVAILABLE') {
    return { ...base, status: 'UNAVAILABLE', unavailableReason: authority.unavailableReason }
  }
  return { ...base, status: 'ABSENT' }
}
