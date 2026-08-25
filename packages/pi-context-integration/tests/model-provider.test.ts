import { describe, expect, it } from 'vitest'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import {
  ModelProviderConfigurationError,
  prepareModelProvider,
  registerModelProvider,
  resolveProviderSelection,
  safeProviderSelection
} from '../src'

function env(
  values: Record<string, string | undefined>
): Readonly<Record<string, string | undefined>> {
  return values
}

describe('model provider layer', () => {
  it('selects Step Plan as the new primary when its credential is present', () => {
    const selection = resolveProviderSelection({
      env: env({ STEP_PLAN_API_KEY: 'step-secret', DEEPSEEK_API_KEY: 'deepseek-secret' })
    })
    expect(selection.profile.providerId).toBe('step-plan')
    expect(selection.profile.modelId).toBe('step-3.7-flash')
    expect(selection.source).toBe('primary')
    expect(selection.profile.credentialEnv).toBe('STEP_PLAN_API_KEY')
  })

  it('selects DeepSeek before a model call when Step Plan credentials are unavailable', () => {
    const selection = resolveProviderSelection({
      env: env({ DEEPSEEK_API_KEY: 'deepseek-secret' })
    })
    expect(selection.profile.providerId).toBe('deepseek')
    expect(selection.source).toBe('fallback')
    expect(selection.fallbackReason).toBe('primary_credentials_unavailable')
  })

  it('fails closed when neither primary nor fallback credentials are available', () => {
    expect(() => resolveProviderSelection({ env: env({}) })).toThrow('credentials_unavailable')
  })

  it('builds an explicit custom OpenAI-compatible profile from environment metadata', () => {
    const selection = resolveProviderSelection({
      primaryProviderId: 'research-gateway',
      fallbackProviderId: 'none',
      env: env({
        CANVAS_MODEL_BASE_URL: 'https://gateway.example.test/v1',
        CANVAS_MODEL_ID: 'research-model-v1',
        CANVAS_MODEL_NAME: 'Research Model',
        CANVAS_MODEL_API_KEY_ENV: 'RESEARCH_GATEWAY_API_KEY',
        RESEARCH_GATEWAY_API_KEY: 'gateway-secret'
      })
    })
    expect(selection.profile.providerId).toBe('research-gateway')
    expect(selection.profile.baseUrl).toBe('https://gateway.example.test/v1')
    expect(selection.profile.modelId).toBe('research-model-v1')
    expect(selection.profile.modelName).toBe('Research Model')
    expect(selection.profile.credentialEnv).toBe('RESEARCH_GATEWAY_API_KEY')
  })

  it('rejects remote HTTP and credential-bearing URLs', () => {
    expect(() =>
      resolveProviderSelection({
        primaryProviderId: 'research-gateway',
        fallbackProviderId: 'none',
        env: env({
          CANVAS_MODEL_BASE_URL: 'http://gateway.example.test/v1',
          CANVAS_MODEL_ID: 'research-model-v1',
          CANVAS_MODEL_API_KEY_ENV: 'RESEARCH_GATEWAY_API_KEY',
          RESEARCH_GATEWAY_API_KEY: 'gateway-secret'
        })
      })
    ).toThrow(ModelProviderConfigurationError)
    expect(() =>
      resolveProviderSelection({
        primaryProviderId: 'research-gateway',
        fallbackProviderId: 'none',
        env: env({
          CANVAS_MODEL_BASE_URL: 'https://user:password@gateway.example.test/v1',
          CANVAS_MODEL_ID: 'research-model-v1',
          CANVAS_MODEL_API_KEY_ENV: 'RESEARCH_GATEWAY_API_KEY',
          RESEARCH_GATEWAY_API_KEY: 'gateway-secret'
        })
      })
    ).toThrow(ModelProviderConfigurationError)
  })

  it('keeps credentials out of the safe selection metadata', () => {
    const selection = resolveProviderSelection({
      env: env({ STEP_PLAN_API_KEY: 'step-secret-not-for-evidence' })
    })
    const safe = safeProviderSelection(selection)
    expect(JSON.stringify(safe)).not.toContain('step-secret-not-for-evidence')
    expect(safe).toEqual({
      providerId: 'step-plan',
      modelId: 'step-3.7-flash',
      modelName: 'Step 3.7 Flash',
      source: 'primary',
      credentialEnv: 'STEP_PLAN_API_KEY'
    })
  })

  it('registers a provider in memory without model catalog network access', async () => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false
    })
    const selection = resolveProviderSelection({
      env: env({ STEP_PLAN_API_KEY: 'placeholder-key' })
    })
    registerModelProvider(runtime, selection)
    const model = runtime.getModel('step-plan', 'step-3.7-flash')
    expect(model?.baseUrl).toBe('https://api.stepfun.com/step_plan/v1')
    expect(model?.api).toBe('openai-completions')
    expect(await runtime.checkAuth('step-plan')).toBeDefined()
  })

  it('prepares the primary provider before any model call', async () => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false
    })
    const prepared = await prepareModelProvider(runtime, {
      env: env({ STEP_PLAN_API_KEY: 'placeholder-key' })
    })
    expect(prepared.selection.profile.providerId).toBe('step-plan')
    expect(prepared.model.id).toBe('step-3.7-flash')
  })

  it('prepares DeepSeek as a pre-call fallback when Step Plan has no credential', async () => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false
    })
    const prepared = await prepareModelProvider(runtime, {
      env: env({ DEEPSEEK_API_KEY: 'placeholder-key' })
    })
    expect(prepared.selection.profile.providerId).toBe('deepseek')
    expect(prepared.selection.source).toBe('fallback')
    expect(prepared.model.id).toBe('deepseek-v4-flash')
  })
})
