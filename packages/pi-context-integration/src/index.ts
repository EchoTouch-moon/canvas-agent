// STABLE public surface (package root entry `.`).
//
// CR-004 hardening split: this root exports only the stable integration
// surface — the shadow observers/extensions, the Pi message mapper, the
// element decomposition, the shadow planner, the request-parity pipeline, and
// the provider layer. Every research symbol (Active rewrite + removal
// policies, pre-send guard, kill switch, committed-context adapter, and the
// C0/S1/M-series experiment harness cores) lives behind the explicit
// `@canvas-agent/pi-context-integration/experimental` entry instead.

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
