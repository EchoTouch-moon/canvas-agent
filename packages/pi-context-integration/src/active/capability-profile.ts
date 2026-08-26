import { MESSAGE_CATEGORIES, type MessageCategory } from '@canvas-agent/context-runtime'
import type { PiMessageView } from '../pi-message-mapper'

// CR-004 Stage 0 — OFFLINE Active-rewrite capability profile.
//
// This module is pure library code: it describes exactly what the Active seam
// supports and answers capability questions for the rewrite composer. It never
// sends anything, holds no credentials, performs no I/O, and reads no clock.
// Per the Gate D adjudication (context-runtime-cr004-gate-d-adjudication
// -2026-08-27.md), Stage 0 composes and validates rewrites offline only;
// zero rewritten provider requests exist in this module tree.

/** The only harness the Active seam supports. Every other harness id is out of scope. */
export const PI_ACTIVE_HARNESS = 'PI'

// Real Pi AgentMessage roles observable at the `context` seam (user /
// assistant / toolResult / custom). Mirrors the role vocabulary that
// `mapPiMessage` classifies; anything else (including `system`, which does not
// exist in Pi's AgentMessage union) is outside the capability profile.
export const PI_ACTIVE_SUPPORTED_ROLES = ['user', 'assistant', 'toolResult', 'custom'] as const
export type PiActiveSupportedRole = (typeof PI_ACTIVE_SUPPORTED_ROLES)[number]

// Static description of the Pi-only Active capability. Consumed by the composer
// (via checkCapability) and safe to log/serialize; it contains no secrets.
export const PI_ACTIVE_CAPABILITY = {
  stage: 'CR-004_STAGE_0_OFFLINE',
  harness: PI_ACTIVE_HARNESS,
  supportedRoles: PI_ACTIVE_SUPPORTED_ROLES,
  supportedMessageCategories: MESSAGE_CATEGORIES,
  // The system instruction is NOT an AgentMessage in Pi: it is assembled
  // out-of-band and observed separately. The Active seam carries it as a single
  // leading, byte-identical string; it is never rewritten, never duplicated.
  systemInstructionPolicy: 'SINGLE_OUT_OF_BAND_BYTE_IDENTICAL',
  // Pi opaque blocks (thinking / redacted thinking / images / structured
  // blocks) are ALWAYS preserved verbatim and are never rewritten or dropped.
  opaquePolicy: 'PRESERVED_VERBATIM_NEVER_REWRITTEN',
  // Stage 0 composes rewrites by dropping WHOLE messages whose sources were
  // REMOVEd; it never edits content inside a kept message.
  rewriteMode: 'WHOLE_MESSAGE_DROP_ONLY',
  // Hard Stage 0 boundary: nothing in this module tree sends provider requests.
  sendsProviderRequests: false
} as const

/** Capability-level fallback reasons shared by the composer and pre-send guard. */
export type CapabilityFallbackReason = 'HARNESS_UNSUPPORTED' | 'UNSUPPORTED_MESSAGE_KIND'

export interface CapabilityCheckInput {
  readonly harness: string
  readonly messages: readonly PiMessageView[]
}

export interface CapabilityCheckResult {
  readonly supported: boolean
  readonly reason?: CapabilityFallbackReason
  readonly detail?: string
}

function roleCategory(role: string): MessageCategory {
  if (role === 'user') return 'USER'
  if (role === 'assistant') return 'ASSISTANT'
  if (role === 'toolResult') return 'TOOL_RESULT'
  return 'OTHER'
}

/**
 * Answer whether the Active seam supports this harness + native message list.
 * `system` is rejected explicitly: Pi carries the system instruction out-of-
 * band, so a system-role message inside the AgentMessage list would duplicate
 * the system carrier and is out of contract. Any other unknown role is an
 * unsupported message kind. Fail closed: anything not proven supported is
 * unsupported.
 */
export function checkCapability(input: CapabilityCheckInput): CapabilityCheckResult {
  if (input.harness !== PI_ACTIVE_HARNESS) {
    return {
      supported: false,
      reason: 'HARNESS_UNSUPPORTED',
      detail: `active rewrite supports harness '${PI_ACTIVE_HARNESS}' only, received '${input.harness}'`
    }
  }
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index]
    if (message === undefined) continue
    const role = message.role
    if (role === 'system') {
      return {
        supported: false,
        reason: 'UNSUPPORTED_MESSAGE_KIND',
        detail: `message at index ${String(index)} has role 'system'; the Pi system instruction travels out-of-band and must not appear in the AgentMessage list (duplicate system carrier)`
      }
    }
    if (!(PI_ACTIVE_SUPPORTED_ROLES as readonly string[]).includes(role)) {
      return {
        supported: false,
        reason: 'UNSUPPORTED_MESSAGE_KIND',
        detail: `message at index ${String(index)} has unsupported role '${role}'`
      }
    }
  }
  return { supported: true }
}

export { roleCategory as piActiveRoleCategory }
