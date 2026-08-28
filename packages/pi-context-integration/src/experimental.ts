// EXPERIMENTAL public surface (CR-004 hardening, package entry
// `@canvas-agent/pi-context-integration/experimental`).
//
// Everything here is research machinery under active iteration: the Active
// rewrite seam and its removal policies (v1/v2/v3), the pre-send guard, the
// per-Run kill switch, the Pi committed-context adapter, the C0/S1/M-series
// experiment harness cores, and their helpers. Semantics may change between
// runs; consumers pin exact commits. The STABLE root entry (`.`) intentionally
// exports none of these symbols.

export {
  PI_COMMITTED_CONTEXT_CUSTOM_TYPE,
  PiCommittedContextAdapter,
  PiContextTranslationError,
  materializedRepresentationContent,
  renderedContentHash,
  type ContextRenderTrace,
  type PiCommittedContextMessage,
  type PiContextRenderOptions,
  type PiContextRenderPlan,
  type TranslationFailureCode
} from './active/pi-committed-context-adapter'
export {
  PI_ACTIVE_CAPABILITY,
  PI_ACTIVE_HARNESS,
  PI_ACTIVE_SUPPORTED_ROLES,
  checkCapability,
  piActiveRoleCategory,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type CapabilityFallbackReason,
  type PiActiveSupportedRole
} from './active/capability-profile'
export {
  createRunKillSwitch,
  type KillSwitchTripRecord,
  type RunKillSwitch,
  type RunKillSwitchOptions
} from './active/kill-switch'
export {
  analyzeNativeMessages,
  type AnalyzedNativeConversation,
  type AnalyzedNativeMessage,
  type NativeToolPair
} from './active/native-message-analysis'
export {
  ACTIVE_FALLBACK_REASONS,
  activeMessageFingerprint,
  activeMessagesHash,
  activeSystemInstructionHash,
  composeActiveRewrite,
  type ActiveFallbackReason,
  type ActiveRewriteBinding,
  type ActiveRewriteComposition,
  type ActiveRewriteContinuity,
  type ActiveRewriteFallback,
  type ActiveRewriteReady,
  type ComposeActiveRewriteInput
} from './active/rewrite-composer'
export {
  assertRewriteSafe,
  type PreSendGuardFallback,
  type PreSendGuardOk,
  type PreSendGuardResult
} from './active/pre-send-guard'
export {
  ACTIVE_DEFAULT_MAX_ATTEMPTS,
  ACTIVE_DEFAULT_MAX_INTERVENTIONS,
  ACTIVE_DEFAULT_MAX_BLOCKS_PER_INTERVENTION,
  ACTIVE_DEFAULT_VERIFY_WINDOW_EVENTS,
  ACTIVE_EDIT_TOOLS,
  ACTIVE_READ_TOOLS,
  ACTIVE_VERIFY_TOOLS,
  InMemoryActiveRewriteEvidenceCollector,
  applyCarriedRemovals,
  createActiveRewriteExtension,
  detectInterventionBoundaries,
  detectInterventionBoundary,
  idleInterventionSummary,
  isVerificationWindowOpen,
  readContentHashOf,
  readTargetHashOf,
  scanDuplicateReads,
  scanEditReadStructure,
  type ActiveRemovalPolicy,
  type ActiveRewriteEventEvidence,
  type ActiveRewriteEvidenceCollector,
  type ActiveRewriteExtensionOptions,
  type ActiveRewriteInterventionSummary,
  type CoarseSweepReadCall,
  type CoarseSweepReadEntry,
  type CoarseSweepView,
  type DuplicateReadCall,
  type DuplicateReadEntry,
  type DuplicateSweepView,
  type InterventionBoundary,
  type ReadTargetRecord
} from './extension/active-rewrite-extension'
export {
  LEG_DEADLINE_GRACE_MS,
  LEG_DEADLINE_SETTLE_GRACE_MS,
  LEG_DEADLINE_STOP_REASON,
  legDeadlineOf,
  runPromptWithDeadline,
  type LegDeadlineOutcome,
  type PromptDeadlineSession
} from './smoke/leg-deadline'
export {
  MX_EVIDENCE_ROOT_FILENAME,
  computeMxEvidenceRoot,
  findRepoRoot,
  verifyMxEvidenceRoot,
  writeMxEvidenceRoot,
  type MxEvidenceFieldCheck,
  type MxEvidenceRoot,
  type MxEvidenceRootOptions,
  type MxEvidenceVerification
} from './smoke/mx-evidence-root'
export {
  MX_EXPERIMENT_PROFILES,
  MX_LATEST_PROFILE,
  MxProfileError,
  assertMxProfileBindable,
  isValidMxProfileRunId,
  mxProfileForRunId,
  mxProvenanceWarnings,
  mxRunIdSeriesOf,
  readMxProfileContract,
  validateMxShapeAgainstProfile,
  type MxArm,
  type MxExperimentProfile,
  type MxSeriesId,
  type MxTaskSlot
} from './smoke/mx-profiles'
// Harness cores: C0 canary scenarios + executor, the Stage 1 pair runner
// core, and the matrix core (run identity is profile-bound; its mx-profiles
// re-exports are shadowed by the explicit exports above).
export * from './smoke/c0-scenarios'
export * from './smoke/s1-pair-core'
export * from './smoke/matrix-core'
