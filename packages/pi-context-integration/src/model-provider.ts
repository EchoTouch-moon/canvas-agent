import {
  ModelRuntime,
  type ProviderConfig,
  type ProviderModelConfig
} from '@earendil-works/pi-coding-agent'

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>
export type ProviderInput = 'text' | 'image'
export type ProviderApi = 'openai-completions'
export type ProviderSelectionSource = 'primary' | 'fallback'

export interface ModelProviderCompatibility {
  readonly supportsDeveloperRole?: boolean
  readonly supportsReasoningEffort?: boolean
}

export interface ModelProviderProfile {
  readonly providerId: string
  readonly displayName: string
  readonly baseUrl: string
  readonly modelId: string
  readonly modelName: string
  readonly credentialEnv: string
  readonly api: ProviderApi
  readonly reasoning: boolean
  readonly input: readonly ProviderInput[]
  readonly contextWindow: number
  readonly maxTokens: number
  readonly compat?: ModelProviderCompatibility
}

export interface ProviderSelection {
  readonly profile: ModelProviderProfile
  /** In-memory only. Never serialize this field into research evidence. */
  readonly apiKey: string
  readonly source: ProviderSelectionSource
  readonly fallbackReason?: 'primary_credentials_unavailable' | 'primary_model_unavailable'
}

export interface SafeProviderSelection {
  readonly providerId: string
  readonly modelId: string
  readonly modelName: string
  readonly source: ProviderSelectionSource
  readonly credentialEnv: string
  readonly fallbackReason?: ProviderSelection['fallbackReason']
}

export interface ResolveProviderOptions {
  readonly env?: ProviderEnvironment
  readonly primaryProviderId?: string
  readonly fallbackProviderId?: string | 'none'
}

export interface PrepareProviderOptions extends ResolveProviderOptions {
  /** Set only after credentials and model availability are checked before a call. */
  readonly allowFallback?: boolean
}

export interface PreparedModelProvider {
  readonly selection: ProviderSelection
  readonly model: NonNullable<ReturnType<ModelRuntime['getModel']>>
}

export class ModelProviderConfigurationError extends Error {
  readonly code:
    | 'provider_id_invalid'
    | 'credential_env_invalid'
    | 'base_url_invalid'
    | 'model_id_missing'
    | 'base_url_missing'
    | 'credential_env_missing'
    | 'context_window_invalid'
    | 'max_tokens_invalid'

  constructor(code: ModelProviderConfigurationError['code']) {
    super(code)
    this.name = 'ModelProviderConfigurationError'
    this.code = code
  }
}

export class ModelProviderUnavailableError extends Error {
  readonly code: 'credentials_unavailable' | 'model_unavailable'

  constructor(code: ModelProviderUnavailableError['code'], providerId: string, modelId: string) {
    super(`${code}:${providerId}/${modelId}`)
    this.name = 'ModelProviderUnavailableError'
    this.code = code
  }
}

const PROVIDER_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/

const OPENAI_COMPAT_DEFAULTS = {
  api: 'openai-completions' as const,
  reasoning: false,
  input: ['text'] as const,
  contextWindow: 128_000,
  maxTokens: 16_384
}

export const DEEPSEEK_PROVIDER_PROFILE: ModelProviderProfile = {
  providerId: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-v4-flash',
  modelName: 'DeepSeek V4 Flash',
  credentialEnv: 'DEEPSEEK_API_KEY',
  ...OPENAI_COMPAT_DEFAULTS
}

export const STEP_PLAN_PROVIDER_PROFILE: ModelProviderProfile = {
  providerId: 'step-plan',
  displayName: 'Step Plan',
  baseUrl: 'https://api.stepfun.com/step_plan/v1',
  modelId: 'step-3.7-flash',
  modelName: 'Step 3.7 Flash',
  credentialEnv: 'STEP_PLAN_API_KEY',
  ...OPENAI_COMPAT_DEFAULTS,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false
  }
}

const BUILTIN_PROFILES: Readonly<Record<string, ModelProviderProfile>> = {
  deepseek: DEEPSEEK_PROVIDER_PROFILE,
  'step-plan': STEP_PLAN_PROVIDER_PROFILE
}

function readEnv(env: ProviderEnvironment, name: string): string | undefined {
  const value = env[name]
  return value !== undefined && value.length > 0 ? value : undefined
}

function requireProviderId(providerId: string): string {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new ModelProviderConfigurationError('provider_id_invalid')
  }
  return providerId
}

function requireCredentialEnv(name: string): string {
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new ModelProviderConfigurationError('credential_env_invalid')
  }
  return name
}

function parsePositiveInteger(
  value: string | undefined,
  code: 'context_window_invalid' | 'max_tokens_invalid',
  fallback: number
): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ModelProviderConfigurationError(code)
  }
  return parsed
}

function validateBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new ModelProviderConfigurationError('base_url_invalid')
  }
  const localHttpAllowed =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (!['https:', ...(localHttpAllowed ? ['http:'] : [])].includes(url.protocol)) {
    throw new ModelProviderConfigurationError('base_url_invalid')
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ModelProviderConfigurationError('base_url_invalid')
  }
  return url.toString().replace(/\/$/, '')
}

function customProfile(providerId: string, env: ProviderEnvironment): ModelProviderProfile {
  const baseUrl = readEnv(env, 'CANVAS_MODEL_BASE_URL')
  const modelId = readEnv(env, 'CANVAS_MODEL_ID')
  const credentialEnv = readEnv(env, 'CANVAS_MODEL_API_KEY_ENV')
  if (baseUrl === undefined) throw new ModelProviderConfigurationError('base_url_missing')
  if (modelId === undefined) throw new ModelProviderConfigurationError('model_id_missing')
  if (credentialEnv === undefined)
    throw new ModelProviderConfigurationError('credential_env_missing')
  const normalizedProviderId = requireProviderId(
    readEnv(env, 'CANVAS_MODEL_PROVIDER_ID') ?? providerId
  )
  return {
    providerId: normalizedProviderId,
    displayName: readEnv(env, 'CANVAS_MODEL_NAME') ?? modelId,
    baseUrl: validateBaseUrl(baseUrl),
    modelId,
    modelName: readEnv(env, 'CANVAS_MODEL_NAME') ?? modelId,
    credentialEnv: requireCredentialEnv(credentialEnv),
    ...OPENAI_COMPAT_DEFAULTS,
    contextWindow: parsePositiveInteger(
      readEnv(env, 'CANVAS_MODEL_CONTEXT_WINDOW'),
      'context_window_invalid',
      OPENAI_COMPAT_DEFAULTS.contextWindow
    ),
    maxTokens: parsePositiveInteger(
      readEnv(env, 'CANVAS_MODEL_MAX_TOKENS'),
      'max_tokens_invalid',
      OPENAI_COMPAT_DEFAULTS.maxTokens
    ),
    reasoning: readEnv(env, 'CANVAS_MODEL_REASONING') === '1',
    compat: {
      supportsDeveloperRole: readEnv(env, 'CANVAS_MODEL_SUPPORTS_DEVELOPER_ROLE') !== '0',
      supportsReasoningEffort: readEnv(env, 'CANVAS_MODEL_SUPPORTS_REASONING_EFFORT') === '1'
    }
  }
}

function profileFor(providerId: string, env: ProviderEnvironment): ModelProviderProfile {
  const builtin = BUILTIN_PROFILES[providerId]
  if (builtin !== undefined) return builtin
  return customProfile(providerId, env)
}

function selectionFor(
  profile: ModelProviderProfile,
  env: ProviderEnvironment,
  source: ProviderSelectionSource,
  fallbackReason?: ProviderSelection['fallbackReason']
): ProviderSelection | undefined {
  const apiKey = readEnv(env, profile.credentialEnv)
  if (apiKey === undefined) return undefined
  return fallbackReason === undefined
    ? { profile, apiKey, source }
    : { profile, apiKey, source, fallbackReason }
}

export function resolveProviderSelection(options: ResolveProviderOptions = {}): ProviderSelection {
  const env = options.env ?? process.env
  const primaryProviderId = requireProviderId(
    options.primaryProviderId ?? readEnv(env, 'CANVAS_MODEL_PROVIDER') ?? 'step-plan'
  )
  const primary = selectionFor(profileFor(primaryProviderId, env), env, 'primary')
  if (primary !== undefined) return primary

  const fallbackProviderId =
    options.fallbackProviderId ?? readEnv(env, 'CANVAS_MODEL_FALLBACK_PROVIDER') ?? 'deepseek'
  if (fallbackProviderId !== 'none' && fallbackProviderId !== primaryProviderId) {
    const fallback = selectionFor(
      profileFor(requireProviderId(fallbackProviderId), env),
      env,
      'fallback',
      'primary_credentials_unavailable'
    )
    if (fallback !== undefined) return fallback
  }
  throw new ModelProviderUnavailableError(
    'credentials_unavailable',
    primaryProviderId,
    profileFor(primaryProviderId, env).modelId
  )
}

export function registerModelProvider(runtime: ModelRuntime, selection: ProviderSelection): void {
  const profile = selection.profile
  const model: ProviderModelConfig = {
    id: profile.modelId,
    name: profile.modelName,
    api: profile.api,
    reasoning: profile.reasoning,
    input: [...profile.input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile.contextWindow,
    maxTokens: profile.maxTokens,
    compat: profile.compat
  }
  const config: ProviderConfig = {
    name: profile.displayName,
    baseUrl: profile.baseUrl,
    api: profile.api,
    apiKey: selection.apiKey,
    authHeader: true,
    models: [model]
  }
  runtime.registerProvider(profile.providerId, config)
}

export async function prepareModelProvider(
  runtime: ModelRuntime,
  options: PrepareProviderOptions = {}
): Promise<PreparedModelProvider> {
  const env = options.env ?? process.env
  const primaryProviderId = requireProviderId(
    options.primaryProviderId ?? readEnv(env, 'CANVAS_MODEL_PROVIDER') ?? 'step-plan'
  )
  const fallbackProviderId =
    options.fallbackProviderId ?? readEnv(env, 'CANVAS_MODEL_FALLBACK_PROVIDER') ?? 'deepseek'
  const allowFallback = options.allowFallback ?? true
  const candidates: Array<{
    profile: ModelProviderProfile
    source: ProviderSelectionSource
    fallbackReason?: ProviderSelection['fallbackReason']
  }> = []

  const primaryProfile = profileFor(primaryProviderId, env)
  const primaryCredentialAvailable = selectionFor(primaryProfile, env, 'primary') !== undefined
  candidates.push({ profile: primaryProfile, source: 'primary' })
  if (allowFallback && fallbackProviderId !== 'none' && fallbackProviderId !== primaryProviderId) {
    candidates.push({
      profile: profileFor(requireProviderId(fallbackProviderId), env),
      source: 'fallback',
      fallbackReason: primaryCredentialAvailable
        ? 'primary_model_unavailable'
        : 'primary_credentials_unavailable'
    })
  }

  let lastUnavailable: ModelProviderUnavailableError | undefined
  for (const candidate of candidates) {
    const selection = selectionFor(
      candidate.profile,
      env,
      candidate.source,
      candidate.fallbackReason
    )
    if (selection === undefined) {
      lastUnavailable = new ModelProviderUnavailableError(
        'credentials_unavailable',
        candidate.profile.providerId,
        candidate.profile.modelId
      )
      continue
    }
    registerModelProvider(runtime, selection)
    const auth = await runtime.checkAuth(candidate.profile.providerId)
    const model = runtime.getModel(candidate.profile.providerId, candidate.profile.modelId)
    if (auth === undefined) {
      lastUnavailable = new ModelProviderUnavailableError(
        'credentials_unavailable',
        candidate.profile.providerId,
        candidate.profile.modelId
      )
      runtime.unregisterProvider(candidate.profile.providerId)
      continue
    }
    if (model === undefined) {
      lastUnavailable = new ModelProviderUnavailableError(
        'model_unavailable',
        candidate.profile.providerId,
        candidate.profile.modelId
      )
      runtime.unregisterProvider(candidate.profile.providerId)
      continue
    }
    return { selection, model }
  }
  throw (
    lastUnavailable ??
    new ModelProviderUnavailableError(
      'credentials_unavailable',
      primaryProviderId,
      primaryProfile.modelId
    )
  )
}

export function safeProviderSelection(selection: ProviderSelection): SafeProviderSelection {
  const safe: SafeProviderSelection = {
    providerId: selection.profile.providerId,
    modelId: selection.profile.modelId,
    modelName: selection.profile.modelName,
    source: selection.source,
    credentialEnv: selection.profile.credentialEnv
  }
  return selection.fallbackReason === undefined
    ? safe
    : { ...safe, fallbackReason: selection.fallbackReason }
}
