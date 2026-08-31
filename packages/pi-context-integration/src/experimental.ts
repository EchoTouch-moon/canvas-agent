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
  estimatePiMessagesTokenEstimate,
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
  LC1_MAPPING_QUARANTINE_REASONS,
  LC1_MAPPING_REJECTION_REASONS,
  Lc1ProductionRepositoryMapper,
  normalizeLc1RepositoryPath,
  type Lc1AcceptedRepositoryObservation,
  type Lc1AuthorityOrder,
  type Lc1ExternalObservation,
  type Lc1ExternalObservationSink,
  type Lc1MappingIssue,
  type Lc1MappingQuarantineReason,
  type Lc1MappingRejectionReason,
  type Lc1ProductionMappingResult,
  type Lc1ProductionMappingSnapshot,
  type Lc1RepositoryMappingRequest,
  type Lc1RepositoryPathResolver,
  type Lc1RepositoryRevision,
  type Lc1RepositoryScope
} from './active/lc1-production-mapping'
export {
  LC1_RUNTIME_ADMISSION_QUARANTINE_REASONS,
  LC1_RUNTIME_ADMISSION_REJECTION_REASONS,
  Lc1RuntimeRepositoryAdmissionHost,
  type Lc1RuntimeAdmissionQuarantineReason,
  type Lc1RuntimeAdmissionRejectionReason,
  type Lc1RuntimeAuthorityOrder,
  type Lc1RuntimeRepositoryAdmissionCandidate,
  type Lc1RuntimeRepositoryAdmissionHostOptions,
  type Lc1RuntimeRepositoryAdmissionHostSnapshot,
  type Lc1RuntimeRepositoryAdmissionIssue,
  type Lc1RuntimeRepositoryAdmissionResult,
  type Lc1RuntimeRepositoryAdmissionSink,
  type Lc1RuntimeRepositoryAdmissionSnapshot,
  type Lc1RuntimeRepositoryRevision,
  type Lc1RuntimeRepositoryScope
} from './active/lc1-runtime-repository-admission'
export {
  createLc1RuntimeAdmissionComposition,
  createLc1RuntimeAdmissionExtension,
  type Lc1RuntimeAdmissionComposition,
  type Lc1RuntimeAdmissionCompositionMode,
  type Lc1RuntimeAdmissionCompositionOptions
} from './active/lc1-runtime-admission-composition'
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
