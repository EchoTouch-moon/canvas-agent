export {
  mapPiMessage,
  mapPiMessages,
  buildMessageFingerprint,
  stableSerializeArguments,
  type PiContentBlockView,
  type PiMessageView
} from './pi-message-mapper'
export {
  PiContextShadowObserver,
  createPiContextShadowExtension,
  type PiShadowObserverOptions,
  type PiContextShadowExtensionOptions,
  type ShadowObservationSinks
} from './extension/shadow-extension'
export {
  EnrichedPiShadowObserver,
  collectSourceObservations,
  createEnrichedPiContextShadowExtension,
  type EnrichedPiShadowObserverOptions,
  type EnrichedShadowResult
} from './extension/enriched-shadow-extension'
export {
  decomposePiMessage,
  decomposePiMessages,
  type ElementWithAttribution
} from './element-decomposition'
export {
  ShadowPlannerObserver,
  buildRepresentationNeeds,
  createShadowPlannerPiExtension,
  representUniverseEntry,
  type ShadowPlannerCallResult,
  type ShadowPlannerObserverOptions
} from './extension/shadow-planner-extension'
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
  PARITY_FAILURE_CATEGORIES,
  PARITY_MISMATCH_KINDS,
  InMemoryModelRequestCapture,
  ParityPipelineError,
  canonicalizeIntendedContext,
  canonicalizeObservedContext,
  compareContextParity,
  createPiRequestParityExtension,
  reconstructModelVisibleContext,
  type CanonicalContext,
  type CanonicalContextEntry,
  type CapturedModelRequest,
  type ContextParityResult,
  type ParityFailureCategory,
  type ParityMismatch,
  type ParityMismatchKind,
  type PiRequestParityExtensionOptions,
  type ReconstructedContextEntry,
  type ReconstructedModelVisibleContext
} from './active/request-parity'
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
  DEEPSEEK_PROVIDER_PROFILE,
  STEP_PLAN_PROVIDER_PROFILE,
  ModelProviderConfigurationError,
  ModelProviderUnavailableError,
  ProviderBindingError,
  computeProviderConfigHash,
  prepareModelProvider,
  registerModelProvider,
  resolveProviderSelection,
  safeProviderSelection,
  type ModelProviderCompatibility,
  type ModelProviderProfile,
  type PreparedModelProvider,
  type PrepareProviderOptions,
  type ProviderApi,
  type ProviderExecutionMode,
  type ProviderExperimentBinding,
  type ProviderEnvironment,
  type ProviderInput,
  type ProviderSelection,
  type ProviderSelectionSource,
  type ResolveProviderOptions,
  type SafeProviderSelection
} from './model-provider'
