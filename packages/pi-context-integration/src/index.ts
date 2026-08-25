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
  DEEPSEEK_PROVIDER_PROFILE,
  STEP_PLAN_PROVIDER_PROFILE,
  ModelProviderConfigurationError,
  ModelProviderUnavailableError,
  prepareModelProvider,
  registerModelProvider,
  resolveProviderSelection,
  safeProviderSelection,
  type ModelProviderCompatibility,
  type ModelProviderProfile,
  type PreparedModelProvider,
  type PrepareProviderOptions,
  type ProviderApi,
  type ProviderEnvironment,
  type ProviderInput,
  type ProviderSelection,
  type ProviderSelectionSource,
  type ResolveProviderOptions,
  type SafeProviderSelection
} from './model-provider'
